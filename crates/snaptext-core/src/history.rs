use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, translate::DictionaryEntry};

const MAX_HISTORY_RECORDS: usize = 500;

#[derive(Debug)]
pub struct HistoryStore {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct HistoryRecord {
    pub id: i64,
    pub created_at: i64,
    pub source: HistorySource,
    pub source_text: String,
    pub target_lang: String,
    pub translated_text: String,
    // 词典增强只随当次翻译结果展示，历史表暂不持久化，避免引入迁移。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dictionary_entries: Vec<DictionaryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistorySource {
    Text,
    Screenshot,
    Selection,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewHistoryRecord {
    pub source: HistorySource,
    pub source_text: String,
    pub target_lang: String,
    pub translated_text: String,
}

impl HistoryStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn insert(&self, record: NewHistoryRecord) -> Result<HistoryRecord> {
        validate_record(&record)?;

        let created_at = now_ms()?;
        self.conn.execute(
            "INSERT INTO history (created_at, source, source_text, target_lang, translated_text)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                created_at,
                source_to_str(&record.source),
                record.source_text,
                record.target_lang,
                record.translated_text,
            ],
        )?;
        self.prune()?;

        let id = self.conn.last_insert_rowid();
        self.get(id)?
            .ok_or_else(|| Error::History("inserted history record was not found".to_owned()))
    }

    pub fn recent(&self, limit: usize) -> Result<Vec<HistoryRecord>> {
        let limit = limit.min(MAX_HISTORY_RECORDS) as i64;
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, source, source_text, target_lang, translated_text
             FROM history
             ORDER BY created_at DESC, id DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map([limit], row_to_record)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at      INTEGER NOT NULL,
                source          TEXT NOT NULL,
                source_text     TEXT NOT NULL,
                target_lang     TEXT NOT NULL,
                translated_text TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);",
        )?;
        Ok(())
    }

    fn get(&self, id: i64) -> Result<Option<HistoryRecord>> {
        self.conn
            .query_row(
                "SELECT id, created_at, source, source_text, target_lang, translated_text
                 FROM history
                 WHERE id = ?1",
                [id],
                row_to_record,
            )
            .optional()
            .map_err(Into::into)
    }

    fn prune(&self) -> Result<()> {
        // SQLite keeps the newest records and removes anything beyond the v1 cap.
        self.conn.execute(
            "DELETE FROM history
             WHERE id NOT IN (
                SELECT id FROM history ORDER BY created_at DESC, id DESC LIMIT ?1
             )",
            [MAX_HISTORY_RECORDS as i64],
        )?;
        Ok(())
    }
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRecord> {
    let source: String = row.get(2)?;
    Ok(HistoryRecord {
        id: row.get(0)?,
        created_at: row.get(1)?,
        source: str_to_source(&source).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(err))
        })?,
        source_text: row.get(3)?,
        target_lang: row.get(4)?,
        translated_text: row.get(5)?,
        dictionary_entries: Vec::new(),
    })
}

fn validate_record(record: &NewHistoryRecord) -> Result<()> {
    if record.source_text.trim().is_empty() {
        return Err(Error::History("source text cannot be empty".to_owned()));
    }
    if record.target_lang.trim().is_empty() {
        return Err(Error::History("target language cannot be empty".to_owned()));
    }
    if record.translated_text.trim().is_empty() {
        return Err(Error::History("translated text cannot be empty".to_owned()));
    }
    Ok(())
}

fn now_ms() -> Result<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| Error::History(err.to_string()))?;
    Ok(duration.as_millis() as i64)
}

fn source_to_str(source: &HistorySource) -> &'static str {
    match source {
        HistorySource::Text => "text",
        HistorySource::Screenshot => "screenshot",
        HistorySource::Selection => "selection",
        HistorySource::Image => "image",
    }
}

fn str_to_source(source: &str) -> std::result::Result<HistorySource, InvalidHistorySource> {
    match source {
        "text" => Ok(HistorySource::Text),
        "screenshot" => Ok(HistorySource::Screenshot),
        "selection" => Ok(HistorySource::Selection),
        "image" => Ok(HistorySource::Image),
        _ => Err(InvalidHistorySource(source.to_owned())),
    }
}

#[derive(Debug, thiserror::Error)]
#[error("invalid history source: {0}")]
struct InvalidHistorySource(String);

#[cfg(test)]
mod tests {
    use super::*;

    fn record(index: usize) -> NewHistoryRecord {
        NewHistoryRecord {
            source: HistorySource::Selection,
            source_text: format!("source {index}"),
            target_lang: "en".to_owned(),
            translated_text: format!("translated {index}"),
        }
    }

    fn insert_raw_record_with_timestamp(store: &HistoryStore, index: usize, created_at: i64) {
        store
            .conn
            .execute(
                "INSERT INTO history (created_at, source, source_text, target_lang, translated_text)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    created_at,
                    source_to_str(&HistorySource::Selection),
                    format!("source {index}"),
                    "en",
                    format!("translated {index}"),
                ],
            )
            .expect("insert timestamped record");
    }

    #[test]
    fn inserts_and_reads_recent_records() {
        let store = HistoryStore::in_memory().expect("history store");
        store.insert(record(1)).expect("insert record 1");
        store.insert(record(2)).expect("insert record 2");

        let recent = store.recent(10).expect("recent history");

        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].source_text, "source 2");
        assert_eq!(recent[1].source_text, "source 1");
    }

    #[test]
    fn recent_uses_row_id_as_tiebreaker_when_timestamps_match() {
        let store = HistoryStore::in_memory().expect("history store");
        for index in 1..=3 {
            insert_raw_record_with_timestamp(&store, index, 42);
        }

        let recent = store.recent(10).expect("recent history");

        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].source_text, "source 3");
        assert_eq!(recent[1].source_text, "source 2");
        assert_eq!(recent[2].source_text, "source 1");
    }

    #[test]
    fn clear_removes_all_records() {
        let store = HistoryStore::in_memory().expect("history store");
        store.insert(record(1)).expect("insert record");
        store.clear().expect("clear history");

        assert!(store.recent(10).expect("recent history").is_empty());
    }

    #[test]
    fn keeps_only_latest_five_hundred_records() {
        let store = HistoryStore::in_memory().expect("history store");
        for index in 0..(MAX_HISTORY_RECORDS + 25) {
            store.insert(record(index)).expect("insert record");
        }

        let recent = store
            .recent(MAX_HISTORY_RECORDS + 25)
            .expect("recent history");

        assert_eq!(recent.len(), MAX_HISTORY_RECORDS);
        assert_eq!(recent.first().expect("newest").source_text, "source 524");
        assert_eq!(recent.last().expect("oldest kept").source_text, "source 25");
        assert!(
            recent
                .iter()
                .all(|record| record.source_text != "source 24")
        );
    }

    #[test]
    fn prune_keeps_newest_row_ids_when_timestamps_match() {
        let store = HistoryStore::in_memory().expect("history store");
        for index in 0..(MAX_HISTORY_RECORDS + 10) {
            insert_raw_record_with_timestamp(&store, index, 42);
        }

        store.prune().expect("prune history");
        let recent = store
            .recent(MAX_HISTORY_RECORDS + 10)
            .expect("recent history");

        assert_eq!(recent.len(), MAX_HISTORY_RECORDS);
        assert_eq!(
            recent.first().expect("newest").source_text,
            format!("source {}", MAX_HISTORY_RECORDS + 9)
        );
        assert_eq!(recent.last().expect("oldest kept").source_text, "source 10");
        assert!(recent.iter().all(|record| record.source_text != "source 9"));
    }

    #[test]
    fn recent_limit_is_capped_to_history_retention_size() {
        let store = HistoryStore::in_memory().expect("history store");
        for index in 0..(MAX_HISTORY_RECORDS + 1) {
            store.insert(record(index)).expect("insert record");
        }

        let recent = store
            .recent(MAX_HISTORY_RECORDS * 2)
            .expect("recent history");

        assert_eq!(recent.len(), MAX_HISTORY_RECORDS);
        assert_eq!(recent.first().expect("newest").source_text, "source 500");
        assert_eq!(recent.last().expect("oldest kept").source_text, "source 1");
    }

    #[test]
    fn insert_rejects_empty_translated_text() {
        let store = HistoryStore::in_memory().expect("history store");
        let mut record = record(1);
        record.translated_text = " \n\t".to_owned();

        let err = store.insert(record).expect_err("empty translated text");

        assert!(err.to_string().contains("translated text cannot be empty"));
        assert!(store.recent(10).expect("recent history").is_empty());
    }

    #[test]
    fn insert_rejects_empty_source_text() {
        let store = HistoryStore::in_memory().expect("history store");
        let mut record = record(1);
        record.source_text = " \n\t".to_owned();

        let err = store.insert(record).expect_err("empty source text");

        assert!(err.to_string().contains("source text cannot be empty"));
        assert!(store.recent(10).expect("recent history").is_empty());
    }

    #[test]
    fn insert_rejects_empty_target_language() {
        let store = HistoryStore::in_memory().expect("history store");
        let mut record = record(1);
        record.target_lang = " \n\t".to_owned();

        let err = store.insert(record).expect_err("empty target language");

        assert!(err.to_string().contains("target language cannot be empty"));
        assert!(store.recent(10).expect("recent history").is_empty());
    }

    #[test]
    fn recent_zero_returns_no_records() {
        let store = HistoryStore::in_memory().expect("history store");
        store.insert(record(1)).expect("insert record");

        let recent = store.recent(0).expect("recent history");

        assert!(recent.is_empty());
    }

    #[test]
    fn recent_rejects_invalid_source_values_from_storage() {
        let store = HistoryStore::in_memory().expect("history store");
        store
            .conn
            .execute(
                "INSERT INTO history (created_at, source, source_text, target_lang, translated_text)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![1_i64, "clipboard", "hello", "fr", "bonjour"],
            )
            .expect("insert malformed record");

        let err = store.recent(10).expect_err("invalid history source");

        assert!(err.to_string().contains("invalid history source"));
    }
}
