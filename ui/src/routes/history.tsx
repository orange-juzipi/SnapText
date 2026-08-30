import { useEffect, useState } from "react";
import type * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardCopy, Download, FileText, RefreshCw, Trash2, X } from "lucide-react";
import { historyItemMeta, sourceLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import {
  useClearHistoryMutation,
  useConfigQuery,
  useDeleteHistoryMutation,
  useSearchHistoryQuery,
} from "@/lib/queries";
import { copyText } from "@/lib/tauri";
import { useWorkspaceState } from "@/app/workspace-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HistoryRecord } from "@/lib/types";

const HISTORY_LIMIT = 50;
const HISTORY_SOURCES = ["", "text", "screenshot", "selection", "image"] as const;

export function HistoryPage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const fromDateEpoch = dateInputToEpoch(fromDate, false);
  const toDateEpoch = dateInputToEpoch(toDate, true);
  const hasInvalidFromDate = Boolean(fromDate && fromDateEpoch === undefined);
  const hasInvalidToDate = Boolean(toDate && toDateEpoch === undefined);
  const hasInvalidDateRange = Boolean(
    fromDateEpoch !== undefined && toDateEpoch !== undefined && fromDateEpoch > toDateEpoch,
  );
  const dateFilterError = hasInvalidFromDate || hasInvalidToDate
    ? labels.invalidDate
    : hasInvalidDateRange
      ? labels.invalidDateRange
      : "";
  const historyQuery = useSearchHistoryQuery(
    debouncedQuery,
    sourceFilter,
    fromDateEpoch,
    toDateEpoch,
    HISTORY_LIMIT,
    !dateFilterError,
  );
  const clearMutation = useClearHistoryMutation();
  const deleteMutation = useDeleteHistoryMutation();
  const items = historyQuery.data ?? [];
  const isFiltered = Boolean(queryText.trim() || sourceFilter || fromDate || toDate);
  const isClearDisabled = items.length === 0 || clearMutation.isPending;

  useEffect(() => {
    // A short debounce keeps typing in the search box from issuing one native call per key.
    const timeout = window.setTimeout(() => setDebouncedQuery(queryText.trim()), 220);
    return () => window.clearTimeout(timeout);
  }, [queryText]);

  /** Copies one history field or both fields and reports the result in the workspace toast. */
  async function handleCopy(text: string) {
    if (!text.trim()) {
      workspace.showError(labels.noHistoryToCopy);
      return;
    }
    try {
      await copyText(text);
      workspace.setStatus(labels.historyCopied);
      workspace.showToast(labels.historyCopied, undefined, "success");
    } catch (error) {
      workspace.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Deletes exactly one record and leaves the remaining filtered list intact. */
  async function handleDelete(item: HistoryRecord) {
    try {
      await deleteMutation.mutateAsync(item.id);
      workspace.setStatus(labels.historyItemDeleted);
    } catch (error) {
      workspace.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Clears all local history only after the user confirms the destructive action. */
  async function handleClear() {
    if (isClearDisabled) return;
    if (typeof window !== "undefined" && !window.confirm(labels.confirmClearHistory)) return;
    try {
      await clearMutation.mutateAsync();
      workspace.setStatus(labels.historyCleared);
    } catch (error) {
      workspace.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /** Exports the currently visible filtered records as Markdown or JSON. */
  function handleExport(format: "markdown" | "json") {
    if (items.length === 0) {
      workspace.showError(labels.exportHistoryEmpty);
      return;
    }
    const extension = format === "markdown" ? "md" : "json";
    const content = format === "markdown"
      ? formatHistoryMarkdown(items, labels)
      : JSON.stringify(items, null, 2);
    downloadTextFile(`snaptext-history-${new Date().toISOString().slice(0, 10)}.${extension}`, content, format);
    workspace.setStatus(labels.historyExported);
    workspace.showToast(labels.historyExported, undefined, "success");
  }

  return (
    <Card className="history-card">
      <CardHeader className="history-header">
        <div className="history-title-copy">
          <CardTitle>{labels.history}</CardTitle>
          <span className="history-count" aria-live="polite">
            {historyQuery.isFetching ? labels.historyLoading : `${items.length}/${HISTORY_LIMIT}`}
          </span>
        </div>
        <div className="history-header-actions">
          <HistoryIconButton
            disabled={historyQuery.isFetching || Boolean(dateFilterError)}
            label={labels.refresh}
            onClick={() => void historyQuery.refetch()}
          >
            <RefreshCw size={16} className={historyQuery.isFetching ? "history-refresh-spinning" : undefined} />
          </HistoryIconButton>
          <Button onClick={() => void handleClear()} variant="destructive" disabled={isClearDisabled}>
            <Trash2 size={16} />
            {labels.clear}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="history-content">
          <div className="history-filter-stack">
          <div className="history-toolbar" role="search">
            <Input
              aria-label={labels.searchHistory}
              className="history-search-input"
              placeholder={labels.searchHistory}
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <Select
              aria-label={labels.sourceType}
              className="history-source-select"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
            >
              {HISTORY_SOURCES.map((source) => (
                <option key={source || "all"} value={source}>
                  {source ? sourceLabel(source, labels) : labels.allSources}
                </option>
              ))}
            </Select>
            <label className="history-date-field">
              <span>{labels.historyFromDate}</span>
              <Input
                aria-label={labels.historyFromDate}
                aria-invalid={hasInvalidFromDate || hasInvalidDateRange}
                className="history-date-input"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label className="history-date-field">
              <span>{labels.historyToDate}</span>
              <Input
                aria-label={labels.historyToDate}
                aria-invalid={hasInvalidToDate || hasInvalidDateRange}
                className="history-date-input"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            {fromDate || toDate ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={labels.clearDateFilters}
                    className="history-date-clear"
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setFromDate("");
                      setToDate("");
                    }}
                  >
                    <X size={15} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{labels.clearDateFilters}</TooltipContent>
              </Tooltip>
            ) : null}
            <div className="history-export-actions">
              <Button
                disabled={items.length === 0 || Boolean(dateFilterError)}
                size="sm"
                type="button"
                onClick={() => handleExport("markdown")}
              >
                <Download size={15} />
                {labels.exportMarkdown}
              </Button>
              <Button
                disabled={items.length === 0 || Boolean(dateFilterError)}
                size="sm"
                type="button"
                onClick={() => handleExport("json")}
              >
                <Download size={15} />
                {labels.exportJson}
              </Button>
            </div>
          </div>

          {dateFilterError ? (
            <div className="history-filter-error" role="alert">
              {dateFilterError}
            </div>
          ) : null}
        </div>

        {historyQuery.isError ? (
          <div className="history-empty-state" role="alert">
            <FileText className="mx-auto mb-3 text-destructive" size={28} />
            <strong className="text-sm">{labels.historyLoading}</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              {historyQuery.error instanceof Error ? historyQuery.error.message : String(historyQuery.error)}
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="history-empty-state">
            <FileText className="mx-auto mb-3 text-muted-foreground" size={28} />
            <strong className="text-sm">{isFiltered ? labels.historySearchEmpty : labels.noHistoryTitle}</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFiltered ? labels.historySearchEmpty : labels.noHistoryDescription}
            </p>
          </div>
        ) : (
          <ol className="history-record-list">
            {items.map((item) => (
              <li key={item.id} className="history-record">
                <div className="history-record-header">
                  <div className="history-record-meta">
                    <Badge variant="primary">{historyItemMeta(item, labels)}</Badge>
                    <time dateTime={safeIsoDate(item.created_at)}>
                      {formatHistoryDate(item.created_at, configQuery.data?.ui.language) || labels.invalidHistoryDate}
                    </time>
                  </div>
                  <div className="history-record-actions">
                    <HistoryIconButton
                      label={labels.copySource}
                      onClick={() => void handleCopy(item.source_text)}
                    >
                      <ClipboardCopy size={15} />
                    </HistoryIconButton>
                    <HistoryIconButton
                      label={labels.copyTranslation}
                      onClick={() => void handleCopy(item.translated_text)}
                    >
                      <ClipboardCopy size={15} />
                    </HistoryIconButton>
                    <HistoryIconButton
                      label={labels.copyBoth}
                      onClick={() => void handleCopy(`${item.source_text}\n\n${item.translated_text}`)}
                    >
                      <FileText size={15} />
                    </HistoryIconButton>
                    <HistoryIconButton
                      disabled={deleteMutation.isPending}
                      label={labels.deleteHistoryItem}
                      onClick={() => void handleDelete(item)}
                      variant="destructive"
                    >
                      <Trash2 size={15} />
                    </HistoryIconButton>
                    <Button
                      size="sm"
                      type="button"
                      onClick={() => {
                        workspace.setResultFromHistory(item);
                        workspace.setStatus(`${labels.historyItemOpened}: ${item.source_text}`);
                        void navigate({ to: "/" });
                      }}
                    >
                      {labels.open}
                    </Button>
                  </div>
                </div>
                <div className="history-record-columns">
                  <div className="history-record-column">
                    <span>{labels.sourceText}</span>
                    <p>{item.source_text}</p>
                  </div>
                  <div className="history-record-column">
                    <span>{labels.translationText}</span>
                    <p>{item.translated_text}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Renders a history item in a portable Markdown format while preserving line breaks. */
function formatHistoryMarkdown(items: HistoryRecord[], labels: ReturnType<typeof labelsForLanguage>) {
  return items
    .map((item) => {
      const meta = historyItemMeta(item, labels);
      return `## ${meta}\n\n**${labels.sourceText}**\n\n${item.source_text}\n\n**${labels.translationText}**\n\n${item.translated_text}`;
    })
    .join("\n\n---\n\n");
}

/** Downloads plain text through the browser runtime used by the Tauri webview. */
function downloadTextFile(
  filename: string,
  content: string,
  format: "markdown" | "json",
) {
  const mimeType = format === "markdown" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8";
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Formats persisted epoch milliseconds in a stable, local-calendar format. */
function formatHistoryDate(timestamp: number, language?: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const calendarDate = `${value.year}-${value.month}-${value.day}`;
  const clockTime = `${value.hour}:${value.minute}`;
  return language === "en" ? `${calendarDate} ${clockTime}` : `${value.year}年${value.month}月${value.day}日 ${clockTime}`;
}

/** Returns an ISO timestamp for semantic time markup without throwing on legacy data. */
function safeIsoDate(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Converts a validated local calendar date into an inclusive epoch-millisecond search bound. */
function dateInputToEpoch(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  const date = new Date(0);
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime()
    : undefined;
}

/** Returns the number of days in a Gregorian calendar month. */
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Wraps compact history actions with an accessible label and hover tooltip. */
function HistoryIconButton({
  children,
  disabled,
  label,
  onClick,
  variant = "secondary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: "secondary" | "destructive";
}) {
  const button = (
    <Button
      aria-label={label}
      disabled={disabled}
      size="icon"
      type="button"
      variant={variant}
      onClick={onClick}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex cursor-not-allowed">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
