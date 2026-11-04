use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, ocr::TextLine, translate::DictionaryEntry};

const MAX_HISTORY_RECORDS: usize = 500;

#[derive(Debug)]
pub struct HistoryStore {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct HistoryRecord {
    /// 数据库记录标识。
    pub id: i64,
    /// 创建时间，单位为 Unix 毫秒。
    pub created_at: i64,
    /// 原文的实际来源。
    pub source: HistorySource,
    /// 完整原文。
    pub source_text: String,
    /// 译文使用的目标语言。
    pub target_lang: String,
    /// 完整译文。
    pub translated_text: String,
    /// 与这次翻译一起持久化的词典释义。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dictionary_entries: Vec<DictionaryEntry>,
    /// OCR 行坐标和置信度；旧记录默认为空。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_lines: Vec<TextLine>,
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

    /// 保存不包含 OCR 或词典元信息的文本记录。
    pub fn insert(&self, record: NewHistoryRecord) -> Result<HistoryRecord> {
        self.insert_with_metadata(record, &[], &[])
    }

    /// 将翻译内容及对应的 OCR、词典数据一起写入同一条记录。
    pub fn insert_with_metadata(
        &self,
        record: NewHistoryRecord,
        dictionary_entries: &[DictionaryEntry],
        text_lines: &[TextLine],
    ) -> Result<HistoryRecord> {
        validate_record(&record)?;
        let dictionary_json = serde_json::to_string(dictionary_entries)
            .map_err(|err| Error::History(err.to_string()))?;
        let text_lines_json =
            serde_json::to_string(text_lines).map_err(|err| Error::History(err.to_string()))?;

        let created_at = now_ms()?;
        self.conn.execute(
            "INSERT INTO history (created_at, source, source_text, target_lang, translated_text, dictionary_json, text_lines_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                created_at,
                source_to_str(&record.source),
                record.source_text,
                record.target_lang,
                record.translated_text,
                dictionary_json,
                text_lines_json,
            ],
        )?;
        self.prune()?;

        let id = self.conn.last_insert_rowid();
        self.get(id)?
            .ok_or_else(|| Error::History("inserted history record was not found".to_owned()))
    }

    pub fn recent(&self, limit: usize) -> Result<Vec<HistoryRecord>> {
        self.search(None, None, limit)
    }

    /// Returns recent records matching an optional text and source filter.
    pub fn search(
        &self,
        query: Option<&str>,
        source: Option<&HistorySource>,
        limit: usize,
    ) -> Result<Vec<HistoryRecord>> {
        self.search_with_dates(query, source, None, None, limit)
    }

    /// Returns recent records matching text, source, and an inclusive epoch-millisecond date range.
    pub fn search_with_dates(
        &self,
        query: Option<&str>,
        source: Option<&HistorySource>,
        created_after: Option<i64>,
        created_before: Option<i64>,
        limit: usize,
    ) -> Result<Vec<HistoryRecord>> {
        let limit = limit.min(MAX_HISTORY_RECORDS);
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, source, source_text, target_lang, translated_text, dictionary_json, text_lines_json
             FROM history
             ORDER BY created_at DESC, id DESC
             LIMIT ?1",
        )?;

        let rows = stmt.query_map([MAX_HISTORY_RECORDS as i64], row_to_record)?;
        let records = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Error::from)?;
        let query = query.map(str::trim).filter(|value| !value.is_empty());

        Ok(records
            .into_iter()
            .filter(|record| {
                let matches_query = query.is_none_or(|query| {
                    record
                        .source_text
                        .to_lowercase()
                        .contains(&query.to_lowercase())
                        || record
                            .translated_text
                            .to_lowercase()
                            .contains(&query.to_lowercase())
                });
                let matches_source = source.is_none_or(|source| &record.source == source);
                let matches_after =
                    created_after.is_none_or(|created_at| record.created_at >= created_at);
                let matches_before =
                    created_before.is_none_or(|created_at| record.created_at <= created_at);
                matches_query && matches_source && matches_after && matches_before
            })
            .take(limit)
            .collect())
    }

    /// Deletes one history record; deleting an already absent id is idempotent.
    pub fn delete(&self, id: i64) -> Result<()> {
        if id <= 0 {
            return Err(Error::History("history id must be positive".to_owned()));
        }
        self.conn
            .execute("DELETE FROM history WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Removes all persisted history records.
    pub fn clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    /// 兼容升级现有历史数据库，并保留旧记录的空元信息默认值。
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
        let mut statement = self.conn.prepare("PRAGMA table_info(history)")?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for column in ["dictionary_json", "text_lines_json"] {
            if !columns.iter().any(|existing| existing == column) {
                self.conn.execute_batch(&format!(
                    "ALTER TABLE history ADD COLUMN {column} TEXT NOT NULL DEFAULT '[]'"
                ))?;
            }
        }
        Ok(())
    }

    fn get(&self, id: i64) -> Result<Option<HistoryRecord>> {
        self.conn
            .query_row(
                "SELECT id, created_at, source, source_text, target_lang, translated_text, dictionary_json, text_lines_json
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

/// 将数据库行及 JSON 元信息还原为完整历史记录。
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
        dictionary_entries: parse_metadata(row, 6)?,
        text_lines: parse_metadata(row, 7)?,
    })
}

/// 将元信息解析错误关联到实际数据库列，避免静默丢弃坏数据。
fn parse_metadata<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let json: String = row.get(index)?;
    serde_json::from_str(&json).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(err))
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

    /// Verifies text and source filters are applied before the result limit.
    #[test]
    fn search_filters_text_and_source() {
        let store = HistoryStore::in_memory().expect("history store");
        store
            .insert(NewHistoryRecord {
                source: HistorySource::Selection,
                source_text: "Hello from selection".to_owned(),
                target_lang: "zh_cn".to_owned(),
                translated_text: "来自划词".to_owned(),
            })
            .expect("selection record");
        store
            .insert(NewHistoryRecord {
                source: HistorySource::Image,
                source_text: "Hello from image".to_owned(),
                target_lang: "zh_cn".to_owned(),
                translated_text: "来自图片".to_owned(),
            })
            .expect("image record");

        let records = store
            .search(Some("IMAGE"), Some(&HistorySource::Image), 10)
            .expect("filtered history");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].source, HistorySource::Image);
    }

    /// Verifies that the optional date range is inclusive and does not alter the default search API.
    #[test]
    fn search_with_dates_filters_created_at_range() {
        let store = HistoryStore::in_memory().expect("history store");
        insert_raw_record_with_timestamp(&store, 1, 100);
        insert_raw_record_with_timestamp(&store, 2, 200);
        insert_raw_record_with_timestamp(&store, 3, 300);

        let records = store
            .search_with_dates(None, None, Some(100), Some(200), 10)
            .expect("dated history");

        assert_eq!(
            records
                .iter()
                .map(|record| record.created_at)
                .collect::<Vec<_>>(),
            [200, 100]
        );
    }

    /// Verifies deleting a record leaves unrelated history intact.
    #[test]
    fn delete_removes_only_requested_record() {
        let store = HistoryStore::in_memory().expect("history store");
        let first = store.insert(record(1)).expect("first record");
        let second = store.insert(record(2)).expect("second record");

        store.delete(first.id).expect("delete first record");

        let records = store.recent(10).expect("remaining history");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, second.id);
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
    /// 原有数据库升级后仍可读取旧记录，新记录的元信息跨重新打开保存。
    #[test]
    fn legacy_history_migrates_and_metadata_survives_reopen() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let path = temp.path().join("history.sqlite");
        let connection = Connection::open(&path).expect("legacy connection");
        connection
            .execute_batch(
                "CREATE TABLE history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
            source TEXT NOT NULL, source_text TEXT NOT NULL,
            target_lang TEXT NOT NULL, translated_text TEXT NOT NULL);
            INSERT INTO history VALUES (1, 1, 'text', 'old', 'en', 'legacy');",
            )
            .expect("legacy schema");
        drop(connection);
        let store = HistoryStore::open(&path).expect("migrate history");
        let legacy = store.recent(1).expect("legacy history");
        assert!(legacy[0].text_lines.is_empty());
        assert!(legacy[0].dictionary_entries.is_empty());
        let line = TextLine {
            text: "scanned".into(),
            bbox: crate::ocr::BBox {
                x: 2,
                y: 3,
                width: 70,
                height: 12,
            },
            confidence: 0.72,
        };
        let entry = DictionaryEntry {
            headword: "scanned".into(),
            phonetic: None,
            audio_url: None,
            part_of_speech: "verb".into(),
            translations: vec!["扫描".into()],
            definitions: vec![],
            source: "test".into(),
        };
        let inserted = store
            .insert_with_metadata(
                record(2),
                std::slice::from_ref(&entry),
                std::slice::from_ref(&line),
            )
            .expect("metadata insert");
        drop(store);
        let reopened = HistoryStore::open(&path).expect("reopen history");
        let restored = reopened.recent(1).expect("restored history");
        assert_eq!(restored[0].id, inserted.id);
        assert_eq!(restored[0].text_lines, vec![line]);
        assert_eq!(restored[0].dictionary_entries, vec![entry]);
    }
}
