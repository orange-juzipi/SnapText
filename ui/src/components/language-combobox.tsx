import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Labels } from "@/lib/labels";
import {
  AUTO_SOURCE_LANG,
  GOOGLE_TRANSLATE_LANGUAGES,
  languageByCode,
  languageDisplayName,
  languageMatchesSearch,
  normalizeLanguageSearchText,
  normalizeLangCode,
} from "@/lib/language";
import { cn } from "@/lib/cn";

type LanguageComboboxProps = {
  /** Selected provider-independent language code. */
  value: string;
  /** Localized strings used by the picker. */
  labels: Labels;
  /** Locale used to display language names. */
  uiLanguage?: string;
  /** Whether automatic language detection can be selected. */
  includeAuto?: boolean;
  /** Optional trigger styling. */
  className?: string;
  /** Accessible name for the language selector. */
  ariaLabel: string;
  /** Receives the chosen language code. */
  onChange: (value: string) => void;
};

/** Presents searchable languages with keyboard navigation and an accessible search field. */
export function LanguageCombobox({
  value,
  labels,
  uiLanguage,
  includeAuto = false,
  className,
  ariaLabel,
  onChange,
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const normalizedValue = normalizeLangCode(value);
  const selectedLanguage = languageByCode(normalizedValue);
  const selectedLabel =
    includeAuto && normalizedValue === AUTO_SOURCE_LANG
      ? labels.autoDetectLanguage
      : selectedLanguage
        ? languageDisplayName(selectedLanguage.code, uiLanguage)
        : normalizedValue || labels.noTarget;
  const filteredLanguages = useMemo(() => {
    const normalizedQuery = normalizeLanguageSearchText(query);
    if (!normalizedQuery) return GOOGLE_TRANSLATE_LANGUAGES;
    if (normalizedQuery === "zh") {
      // "zh" is a language family prefix, so keep both Simplified and Traditional Chinese visible.
      return GOOGLE_TRANSLATE_LANGUAGES.filter((language) => normalizeLangCode(language.code).startsWith("zh_"));
    }
    const normalizedCodeQuery = normalizeLangCode(query);
    const exactCodeMatches = GOOGLE_TRANSLATE_LANGUAGES.filter(
      (language) => normalizeLangCode(language.code) === normalizedCodeQuery,
    );
    if (exactCodeMatches.length) return exactCodeMatches;
    return GOOGLE_TRANSLATE_LANGUAGES.filter((language) => languageMatchesSearch(language, normalizedQuery));
  }, [query]);

  /** Commits the selection and resets the filter for the next visit. */
  function selectValue(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setQuery("");
  }

  /** Moves focus between filtered options while allowing Escape to dismiss the picker. */
  function handleListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-language-option]") ?? []);
    const active = document.activeElement;
    const currentIndex = buttons.findIndex((button) => button === active);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(currentIndex + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[currentIndex < 0 ? buttons.length - 1 : Math.max(currentIndex - 1, 0)]?.focus();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <Button
          type="button"
          className={cn("language-combobox-trigger", className)}
          variant="secondary"
          aria-label={ariaLabel}
        >
          <span>{selectedLabel}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="language-combobox-content"
          onOpenAutoFocus={(event) => {
            // Keep focus inside the search box so users can type immediately.
            event.preventDefault();
          }}
        >
          <div className="language-combobox-search">
            <Search size={15} aria-hidden="true" />
            <Input
              aria-label={labels.searchLanguage}
              autoFocus
              className="language-combobox-search-input"
              value={query}
              placeholder={labels.searchLanguage}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  listRef.current?.querySelector<HTMLButtonElement>("button[data-language-option]")?.focus();
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>
          <div
            ref={listRef}
            className="language-combobox-list"
            role="listbox"
            aria-label={ariaLabel}
            onKeyDown={handleListKeyDown}
          >
            {includeAuto ? (
              <LanguageOption
                active={normalizedValue === AUTO_SOURCE_LANG}
                code={AUTO_SOURCE_LANG}
                label={labels.autoDetectLanguage}
                nativeName={labels.detectedLanguageAuto}
                onSelect={() => selectValue(AUTO_SOURCE_LANG)}
              />
            ) : null}
            {filteredLanguages.length ? (
              filteredLanguages.map((language) => {
                const normalizedCode = normalizeLangCode(language.code);
                return (
                  <LanguageOption
                    key={language.code}
                    active={normalizedValue === normalizedCode}
                    code={language.code}
                    label={languageDisplayName(language.code, uiLanguage)}
                    nativeName={language.nativeName}
                    onSelect={() => selectValue(language.code)}
                  />
                );
              })
            ) : (
              <div className="language-combobox-empty">{labels.noLanguageMatches}</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Renders one selectable language with its selected state exposed to assistive technology. */
function LanguageOption({
  active,
  code,
  label,
  nativeName,
  onSelect,
}: {
  /** Whether this option is currently selected. */
  active: boolean;
  /** Stable language identifier shown alongside the name. */
  code: string;
  /** Localized display name. */
  label: string;
  /** Native-language display name. */
  nativeName: string;
  /** Commits this option. */
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="language-combobox-option"
      data-language-option
      role="option"
      aria-selected={active}
      onClick={onSelect}
    >
      <span className="language-combobox-option-main">
        <span>{label}</span>
        <span>{nativeName}</span>
      </span>
      <span className="language-combobox-option-code">{code}</span>
      {active ? <Check size={15} aria-hidden="true" /> : null}
    </button>
  );
}
