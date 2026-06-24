import { Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { DictionaryEntry } from "@/lib/types";
import type { Labels } from "@/lib/labels";

type DictionaryPanelProps = {
  entries?: DictionaryEntry[];
  labels: Labels;
  compact?: boolean;
  activeSpeechKey?: string | null;
  onSpeakEntry?: (entry: DictionaryEntry, key: string) => void;
};

type NormalizedDictionaryEntry = Omit<DictionaryEntry, "translations" | "definitions"> & {
  translations: string[];
  definitions: string[];
};

export function DictionaryPanel({
  entries,
  labels,
  compact = false,
  activeSpeechKey,
  onSpeakEntry,
}: DictionaryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const normalizedEntries = useMemo(() => normalizeDictionaryEntries(entries), [entries]);
  const visibleLimit = compact ? 2 : 2;
  const visibleEntries = expanded ? normalizedEntries : normalizedEntries.slice(0, visibleLimit);
  const firstEntry = normalizedEntries[0];
  const hasHiddenEntries = normalizedEntries.length > visibleLimit;

  // 词典数据缺失时不渲染，保持旧翻译结果页面的紧凑布局。
  if (!normalizedEntries.length) return null;

  return (
    <section
      className={[
        "dictionary-panel",
        compact ? "dictionary-panel-compact" : "",
        expanded ? "dictionary-panel-expanded" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="dictionary-panel-header">
        <div className="dictionary-panel-title-wrap">
          <span className="dictionary-panel-title">{labels.dictionary}</span>
          {firstEntry.phonetic ? (
            <span className="dictionary-panel-query">
              {firstEntry.headword} / {firstEntry.phonetic} /
            </span>
          ) : (
            <span className="dictionary-panel-query">{firstEntry.headword}</span>
          )}
        </div>
        {hasHiddenEntries ? (
          <button
            type="button"
            className="dictionary-panel-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? labels.collapse : `${labels.viewAll} ${normalizedEntries.length}`}
          </button>
        ) : null}
      </div>
      <div className="dictionary-entry-list">
        {visibleEntries.map((entry, index) => (
          <DictionaryEntryRow
            entry={entry}
            activeSpeechKey={activeSpeechKey}
            key={`${entry.source}:${entry.headword}:${entry.part_of_speech}:${index}`}
            labels={labels}
            onSpeakEntry={onSpeakEntry}
          />
        ))}
      </div>
    </section>
  );
}

function DictionaryEntryRow({
  activeSpeechKey,
  entry,
  labels,
  onSpeakEntry,
}: {
  activeSpeechKey?: string | null;
  entry: NormalizedDictionaryEntry;
  labels: Labels;
  onSpeakEntry?: (entry: DictionaryEntry, key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const definitions = entry.definitions.slice(0, open ? undefined : 12);
  const hasMoreDefinitions = entry.definitions.length > definitions.length;
  const speechKey = `dictionary:${entry.source}:${entry.headword}`;
  const isSpeaking = activeSpeechKey === speechKey;

  return (
    <article className={open ? "dictionary-entry dictionary-entry-open" : "dictionary-entry"}>
      <div className="dictionary-entry-topline">
        <button
          type="button"
          className="dictionary-entry-word-button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          <span className="dictionary-entry-word">{entry.headword}</span>
        </button>
        {entry.phonetic ? <span className="dictionary-entry-phonetic">/{entry.phonetic}/</span> : null}
        {onSpeakEntry ? (
          <button
            type="button"
            className={isSpeaking ? "dictionary-entry-speak dictionary-entry-speak-active" : "dictionary-entry-speak"}
            onClick={() => onSpeakEntry(entry, speechKey)}
            aria-label={`${entry.headword} ${labels.playTranslation}`}
          >
            <Volume2 size={15} />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="dictionary-entry-definition"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="dictionary-entry-pos">{partOfSpeechLabel(entry.part_of_speech)}</span>
        <span className="dictionary-entry-meanings">
          {definitions.map((definition) => (
            <span className="dictionary-entry-meaning" key={definition}>
              {definition}
            </span>
          ))}
          {hasMoreDefinitions ? <span className="dictionary-entry-more">...</span> : null}
        </span>
      </button>
    </article>
  );
}

function normalizeDictionaryEntries(entries?: DictionaryEntry[]): NormalizedDictionaryEntry[] {
  return (entries ?? [])
    .map((entry) => ({
      ...entry,
      headword: entry.headword.trim(),
      phonetic: entry.phonetic?.trim() || null,
      audio_url: entry.audio_url?.trim() || null,
      part_of_speech: entry.part_of_speech.trim(),
      translations: normalizeStringList(entry.translations),
      definitions: normalizeStringList(entry.definitions),
      source: entry.source.trim(),
    }))
    .filter((entry) => entry.headword && entry.part_of_speech && entry.definitions.length);
}

function normalizeStringList(items?: string[]) {
  return (Array.isArray(items) ? items : [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function partOfSpeechLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  // 词典区域服务中英互译，词性标签优先展示中文，避免和英文候选词混在一起。
  if (normalized === "adj." || normalized === "adj" || normalized === "adjective") return "形容词";
  if (normalized === "n." || normalized === "n" || normalized === "noun") return "名词";
  if (normalized === "v." || normalized === "v" || normalized === "verb") return "动词";
  if (normalized === "adv." || normalized === "adv" || normalized === "adverb") return "副词";
  return value;
}
