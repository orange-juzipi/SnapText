import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import type * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ClipboardCopy,
  Download,
  FileText,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
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
  const [fromDate, setFromDate] = useState(todayDateInputValue);
  const [toDate, setToDate] = useState(todayDateInputValue);
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
            <div className="history-date-field">
              <HistoryDatePicker
                invalid={hasInvalidFromDate || hasInvalidDateRange}
                label={labels.historyFromDate}
                labels={labels}
                uiLanguage={configQuery.data?.ui.language}
                value={fromDate}
                onChange={setFromDate}
              />
            </div>
            <div className="history-date-field">
              <HistoryDatePicker
                invalid={hasInvalidToDate || hasInvalidDateRange}
                label={labels.historyToDate}
                labels={labels}
                uiLanguage={configQuery.data?.ui.language}
                value={toDate}
                onChange={setToDate}
              />
            </div>
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

/** Describes one day cell in the history date picker's six-week grid. */
type CalendarCell = {
  /** Stable YYYY-MM-DD value passed back to the history filter. */
  value: string;
  /** Day number rendered in the cell. */
  day: number;
  /** Whether this day belongs to the visible month. */
  isCurrentMonth: boolean;
  /** Whether this day is the user's local current date. */
  isToday: boolean;
};

/** Defines the controlled API for one compact history date picker. */
type HistoryDatePickerProps = {
  /** Accessible label shared with the surrounding date field. */
  label: string;
  /** Current YYYY-MM-DD filter value, or an empty string. */
  value: string;
  /** Reports a newly selected valid local-calendar date. */
  onChange: (value: string) => void;
  /** Marks the trigger when the date or range validation fails. */
  invalid: boolean;
  /** Localized labels used by calendar controls. */
  labels: ReturnType<typeof labelsForLanguage>;
  /** UI language used for the month heading and accessible date text. */
  uiLanguage?: string;
};

/** Renders a themed calendar popover instead of the browser-specific date input. */
function HistoryDatePicker({ label, value, onChange, invalid, labels, uiLanguage }: HistoryDatePickerProps) {
  const selectedDate = parseCalendarDate(value);
  const [open, setOpen] = useState(false);
  const initialDate = selectedDate ?? todayCalendarDate();
  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);
  const locale = uiLanguage === "en" ? "en-US" : "zh-CN";
  const cells = buildCalendarCells(viewYear, viewMonth);
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
    calendarNativeDate(viewYear, viewMonth, 1),
  );

  useEffect(() => {
    if (!open) return;
    const nextDate = parseCalendarDate(value) ?? todayCalendarDate();
    setViewYear(nextDate.year);
    setViewMonth(nextDate.month);
  }, [open, value]);

  /** Moves the visible month while keeping the calendar year within supported input bounds. */
  function moveMonth(delta: number) {
    const next = shiftCalendarMonth(viewYear, viewMonth, delta);
    if (next.year < 1 || next.year > 9999) return;
    setViewYear(next.year);
    setViewMonth(next.month);
  }

  /** Applies a day cell and closes the popover after a valid selection. */
  function selectCalendarDate(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
  }

  /** Selects the current local date and returns the view to its month. */
  function selectToday() {
    const today = todayCalendarDate();
    setViewYear(today.year);
    setViewMonth(today.month);
    onChange(formatCalendarDate(today.year, today.month, today.day));
    setOpen(false);
  }

  /** Clears this individual date filter without affecting the other date field. */
  function clearDate() {
    onChange("");
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          const nextDate = parseCalendarDate(value) ?? todayCalendarDate();
          setViewYear(nextDate.year);
          setViewMonth(nextDate.month);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={invalid ? "history-date-trigger is-invalid" : "history-date-trigger"}
          aria-label={label}
          aria-invalid={invalid}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays size={15} aria-hidden="true" />
          <span>{formatCalendarDisplay(value) || labels.calendarSelectDate}</span>
          <ChevronDown className="history-date-trigger-chevron" size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="history-calendar-popover">
          <div className="history-calendar-header">
            <button
              type="button"
              className="history-calendar-nav"
              aria-label={labels.calendarPreviousMonth}
              title={labels.calendarPreviousMonth}
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              className="history-calendar-nav"
              aria-label={labels.calendarNextMonth}
              title={labels.calendarNextMonth}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="history-calendar-weekdays" aria-hidden="true">
            {(uiLanguage === "en" ? ["S", "M", "T", "W", "T", "F", "S"] : ["日", "一", "二", "三", "四", "五", "六"]).map(
              (weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>,
            )}
          </div>
          <div className="history-calendar-grid" role="grid" aria-label={monthLabel}>
            {cells.map((cell) => {
              const isSelected = cell.value === value;
              const className = [
                "history-calendar-day",
                cell.isCurrentMonth ? "" : "is-outside",
                cell.isToday ? "is-today" : "",
                isSelected ? "is-selected" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={cell.value}
                  type="button"
                  role="gridcell"
                  className={className}
                  aria-label={`${labels.calendarSelectDate}: ${formatCalendarDisplay(cell.value)}`}
                  aria-current={cell.isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  onClick={() => selectCalendarDate(cell.value)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          <div className="history-calendar-footer">
            <button type="button" className="history-calendar-footer-button" onClick={selectToday}>
              <CalendarDays size={14} aria-hidden="true" />
              {labels.calendarToday}
            </button>
            {value ? (
              <button type="button" className="history-calendar-footer-button is-muted" onClick={clearDate}>
                {labels.calendarClear}
              </button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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

/** Holds a validated Gregorian calendar date without timezone information. */
type CalendarDate = {
  /** Four-digit calendar year. */
  year: number;
  /** One-based calendar month. */
  month: number;
  /** One-based day of the month. */
  day: number;
};

/** Parses the controlled date value and rejects impossible Gregorian dates. */
function parseCalendarDate(value: string): CalendarDate | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  return { year, month, day };
}

/** Formats a calendar date as the stable value consumed by the history query. */
function formatCalendarDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Formats a stored date for the compact trigger display. */
function formatCalendarDisplay(value: string) {
  const parsed = parseCalendarDate(value);
  return parsed ? `${String(parsed.year).padStart(4, "0")}/${String(parsed.month).padStart(2, "0")}/${String(parsed.day).padStart(2, "0")}` : "";
}

/** Creates a local date at noon so calendar navigation is not affected by DST midnight transitions. */
function calendarNativeDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

/** Returns today's local calendar date for the date picker's quick action. */
function todayCalendarDate(): CalendarDate {
  const date = new Date();
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** Returns today's local date in the YYYY-MM-DD format used by the history query. */
function todayDateInputValue() {
  const today = todayCalendarDate();
  return formatCalendarDate(today.year, today.month, today.day);
}

/** Moves a month by a signed offset while preserving a one-based month value. */
function shiftCalendarMonth(year: number, month: number, delta: number): CalendarDate {
  const totalMonths = year * 12 + month - 1 + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth, day: 1 };
}

/** Builds a stable six-week grid including adjacent-month days for predictable popover height. */
function buildCalendarCells(year: number, month: number): CalendarCell[] {
  const firstDayOffset = calendarNativeDate(year, month, 1).getDay();
  const today = todayCalendarDate();
  const todayValue = formatCalendarDate(today.year, today.month, today.day);
  return Array.from({ length: 42 }, (_, index) => {
    const date = calendarNativeDate(year, month, index - firstDayOffset + 1);
    const cellValue = formatCalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return {
      value: cellValue,
      day: date.getDate(),
      isCurrentMonth: date.getFullYear() === year && date.getMonth() + 1 === month,
      isToday: cellValue === todayValue,
    };
  });
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
