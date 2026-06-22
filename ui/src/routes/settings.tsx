import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Keyboard, MonitorCog, ServerCog, Volume2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { labelsForLanguage } from "@/lib/labels";
import { useConfigQuery, useUpdateConfigMutation } from "@/lib/queries";
import type { AppConfig } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

type SettingsTab = "interface" | "hotkeys" | "speech" | "provider";
type QueuedSave = {
  draft: AppConfig;
  version: number;
};

export function SettingsPage() {
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const workspace = useWorkspaceState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("interface");
  const userEditedRef = useRef(false);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef<QueuedSave | null>(null);
  const editVersionRef = useRef(0);
  const scrollPanelRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<SettingsTab, HTMLElement | null>>>({});
  const speechEnabled = draft?.speech.enabled ?? false;
  const labels = labelsForLanguage(
    draft?.ui.language ?? configQuery.data?.ui.language,
  );

  useEffect(() => {
    if (!configQuery.data || userEditedRef.current) return;
    setDraft(ensureSpeechDefaults(configQuery.data));
  }, [configQuery.data]);

  useEffect(() => {
    if (!draft || !configQuery.data || !userEditedRef.current) return;
    const timeout = window.setTimeout(() => {
      void saveConfig(draft, editVersionRef.current);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [configQuery.data, draft]);

  const providerConfig = useMemo(
    () => visibleProvider(draft?.translator.provider),
    [draft],
  );
  const sectionOrder: SettingsTab[] = ["interface", "hotkeys", "provider", "speech"];

  if (!draft) {
    return (
      <Card>
        <CardContent>{labels.loadingSettings}</CardContent>
      </Card>
    );
  }

  async function saveConfig(nextDraft: AppConfig, version: number) {
    if (savingRef.current) {
      queuedSaveRef.current = { draft: nextDraft, version };
      return;
    }
    savingRef.current = true;
    try {
      const saved = await updateConfig.mutateAsync(
        sanitizeConfig(nextDraft),
      );
      if (!queuedSaveRef.current && editVersionRef.current === version) {
        userEditedRef.current = false;
        setDraft(ensureSpeechDefaults(saved));
      }
    } catch (error) {
      applyDocumentTheme(configQuery.data?.ui.theme);
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      savingRef.current = false;
      const queuedSave = queuedSaveRef.current;
      queuedSaveRef.current = null;
      if (queuedSave) {
        await saveConfig(queuedSave.draft, queuedSave.version);
      }
    }
  }

  function scrollToSettingsSection(tab: SettingsTab) {
    setActiveTab(tab);
    sectionRefs.current[tab]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSettingsScroll() {
    const container = scrollPanelRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    let currentSection = sectionOrder[0];
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const section of sectionOrder) {
      const node = sectionRefs.current[section];
      if (!node) continue;
      const distance = Math.abs(node.getBoundingClientRect().top - containerTop);
      if (distance < closestDistance) {
        currentSection = section;
        closestDistance = distance;
      }
    }

    setActiveTab((current) => (current === currentSection ? current : currentSection));
  }

  return (
    <Card className="settings-card">
      <CardHeader className="settings-header">
        <div className="settings-title-row">
          <Button asChild variant="ghost" size="icon" aria-label={labels.backHome}>
            <Link to="/">
              <ArrowLeft size={17} />
            </Link>
          </Button>
          <CardTitle>{labels.settings}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="settings-shell">
        <nav className="settings-tab-list" aria-label={labels.settings}>
          <SettingsTabButton
            active={activeTab === "interface"}
            icon={<MonitorCog size={16} />}
            label={labels.settingsInterface}
            onClick={() => scrollToSettingsSection("interface")}
          />
          <SettingsTabButton
            active={activeTab === "hotkeys"}
            icon={<Keyboard size={16} />}
            label={labels.settingsHotkeys}
            onClick={() => scrollToSettingsSection("hotkeys")}
          />
          <SettingsTabButton
            active={activeTab === "provider"}
            icon={<ServerCog size={16} />}
            label={labels.provider}
            onClick={() => scrollToSettingsSection("provider")}
          />
          <SettingsTabButton
            active={activeTab === "speech"}
            icon={<Volume2 size={16} />}
            label={labels.speech}
            onClick={() => scrollToSettingsSection("speech")}
          />
        </nav>

        <div className="settings-tab-panel" ref={scrollPanelRef} onScroll={handleSettingsScroll}>
          <section
            className="settings-block"
            ref={(node) => {
              sectionRefs.current.interface = node;
            }}
          >
          <div className="settings-section-heading">
            <h2>{labels.settingsInterface}</h2>
          </div>
          <div className="settings-interface-stack">
            <Field>
              <FieldLabel>{labels.theme}</FieldLabel>
              <ThemeChoiceGroup
                value={draft.ui.theme}
                labels={labels}
                onChange={(value) => {
                  applyDocumentTheme(value);
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.ui.theme = value),
                  );
                }}
              />
            </Field>
            <Field>
              <FieldLabel>{labels.interfaceLanguage}</FieldLabel>
              <LanguageChoiceGroup
                value={draft.ui.language}
                labels={labels}
                onChange={(value) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.ui.language = value),
                  )
                }
              />
            </Field>
          </div>
          </section>

          <section
            className="settings-block"
            ref={(node) => {
              sectionRefs.current.hotkeys = node;
            }}
          >
          <div className="settings-section-heading">
            <h2>{labels.settingsHotkeys}</h2>
          </div>
          <div className="settings-grid">
            <Field>
              <FieldLabel>{labels.screenshotHotkey}</FieldLabel>
              <HotkeyInput
                labels={labels}
                value={draft.hotkeys.screenshot}
                onChange={(value) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.hotkeys.screenshot = value),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel>{labels.selectionHotkey}</FieldLabel>
              <HotkeyInput
                labels={labels}
                value={draft.hotkeys.selection}
                onChange={(value) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.hotkeys.selection = value),
                  )
                }
              />
            </Field>
          </div>
          </section>

          <section
            className="settings-block"
            ref={(node) => {
              sectionRefs.current.provider = node;
            }}
          >
          <div className="settings-section-heading">
            <h2>{labels.provider}</h2>
          </div>
          <Field>
            <FieldLabel>{labels.provider}</FieldLabel>
            <Select
              value={providerConfig}
              onChange={(event) =>
                updateDraft(
                  setDraft,
                  userEditedRef,
                  editVersionRef,
                  (next) => (next.translator.provider = event.target.value),
                )
              }
            >
              <option value="snaptext_cloud">{labels.snaptextCloudProvider}</option>
              <option value="deepl">DeepL</option>
              <option value="google">Google</option>
            </Select>
          </Field>
          <ProviderFields
            draft={draft}
            setDraft={setDraft}
            userEditedRef={userEditedRef}
            editVersionRef={editVersionRef}
            provider={providerConfig}
          />
          </section>

          <section
            className="settings-block"
            ref={(node) => {
              sectionRefs.current.speech = node;
            }}
          >
          <div className="settings-section-heading">
            <h2>{labels.speech}</h2>
          </div>
          <div className="settings-grid settings-speech-grid">
            <label className="settings-toggle-row">
              <Switch
                checked={draft.speech.enabled}
                onCheckedChange={(checked) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.speech.enabled = checked),
                  )
                }
              />
              {labels.speechEnabled}
            </label>
            <Field>
              <FieldLabel>{labels.englishAccent}</FieldLabel>
              <Select
                disabled={!speechEnabled}
                value={draft.speech.english_accent}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.speech.english_accent = event.target.value),
                  )
                }
              >
                <option value="american">{labels.englishAccentAmerican}</option>
                <option value="british">{labels.englishAccentBritish}</option>
              </Select>
            </Field>
            <SpeechSliderField
              disabled={!speechEnabled}
              label={labels.speechRate}
              min={0.1}
              max={3}
              step={0.1}
              value={draft.speech.rate}
              formatValue={(value) => `${value.toFixed(1)}x`}
              onChange={(value) =>
                updateDraft(
                  setDraft,
                  userEditedRef,
                  editVersionRef,
                  (next) => (next.speech.rate = value),
                )
              }
            />
            <SpeechSliderField
              disabled={!speechEnabled}
              label={labels.speechVolume}
              min={0}
              max={1}
              step={0.05}
              value={draft.speech.volume}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) =>
                updateDraft(
                  setDraft,
                  userEditedRef,
                  editVersionRef,
                  (next) => (next.speech.volume = value),
                )
              }
            />
          </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderFields({
  draft,
  setDraft,
  userEditedRef,
  editVersionRef,
  provider,
}: {
  draft: AppConfig;
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  userEditedRef: React.MutableRefObject<boolean>;
  editVersionRef: React.MutableRefObject<number>;
  provider: string;
}) {
  if (provider === "snaptext_cloud") {
    return null;
  }
  if (provider === "deepl") {
    return (
      <div className="settings-grid">
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          userEditedRef={userEditedRef}
          editVersionRef={editVersionRef}
          path="deepl_base_url"
          label="DeepL base URL"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          userEditedRef={userEditedRef}
          editVersionRef={editVersionRef}
          path="deepl_api_key"
          label="DeepL API key"
        />
      </div>
    );
  }
  if (provider === "google") {
    return (
      <div className="settings-grid">
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          userEditedRef={userEditedRef}
          editVersionRef={editVersionRef}
          path="google_base_url"
          label="Google base URL"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          userEditedRef={userEditedRef}
          editVersionRef={editVersionRef}
          path="google_api_key"
          label="Google API key"
        />
      </div>
    );
  }
  return null;
}

function SpeechSliderField({
  disabled,
  formatValue,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  disabled: boolean;
  formatValue: (value: number) => string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <Field>
      <div className="settings-slider-label-row">
        <FieldLabel>{label}</FieldLabel>
        <span className="settings-slider-value">{formatValue(value)}</span>
      </div>
      <input
        className="settings-slider"
        disabled={disabled}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function LanguageChoiceGroup({
  value,
  labels,
  onChange,
}: {
  value: string;
  labels: ReturnType<typeof labelsForLanguage>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="zh_cn">{labels.languageChinese}</option>
      <option value="en">{labels.languageEnglish}</option>
    </Select>
  );
}

function ThemeChoiceGroup({
  labels,
  value,
  onChange,
}: {
  labels: ReturnType<typeof labelsForLanguage>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-theme-options" role="radiogroup" aria-label={labels.theme}>
      <label className="settings-system-theme-row">
        <Checkbox
          checked={value === "system"}
          onCheckedChange={(checked) => onChange(checked ? "system" : "light")}
        />
        <span className="settings-system-theme-copy">
          <span>{labels.themeSystem}</span>
          <span className="settings-system-theme-description">
            {labels.themeSystemDescription}
          </span>
        </span>
      </label>
      <div className="settings-choice-grid">
        <SettingsChoiceCard
          checked={value === "light"}
          label={labels.themeLight}
          preview={<ThemePreview tone="light" />}
          onClick={() => onChange("light")}
        />
        <SettingsChoiceCard
          checked={value === "dark"}
          label={labels.themeDark}
          preview={<ThemePreview tone="dark" />}
          onClick={() => onChange("dark")}
        />
      </div>
    </div>
  );
}

function ThemePreview({ tone }: { tone: "light" | "dark" }) {
  return (
    <span className={`settings-theme-preview settings-theme-preview-${tone}`}>
      <span />
      <span />
      <span />
    </span>
  );
}

function SettingsChoiceCard({
  checked,
  label,
  onClick,
  preview,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
  preview: React.ReactNode;
}) {
  return (
    <button
      className={checked ? "settings-choice-card is-selected" : "settings-choice-card"}
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
    >
      <span className="settings-choice-preview" aria-hidden="true">
        {preview}
      </span>
      <span className="settings-choice-footer">
        <span className="settings-choice-radio" aria-hidden="true" />
        <span>{label}</span>
      </span>
    </button>
  );
}

type ProviderInputPath =
  | "deepl_base_url"
  | "deepl_api_key"
  | "google_base_url"
  | "google_api_key";

function ProviderInput({
  draft,
  setDraft,
  userEditedRef,
  editVersionRef,
  path,
  label,
}: {
  draft: AppConfig;
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  userEditedRef: React.MutableRefObject<boolean>;
  editVersionRef: React.MutableRefObject<number>;
  path: ProviderInputPath;
  label: string;
}) {
  const value = providerValue(draft, path);
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        value={value}
        onChange={(event) =>
          updateDraft(setDraft, userEditedRef, editVersionRef, (next) =>
            setProviderValue(next, path, event.target.value),
          )
        }
      />
    </Field>
  );
}

function providerValue(config: AppConfig, path: ProviderInputPath) {
  switch (path) {
    case "deepl_base_url":
      return config.translator.deepl.base_url;
    case "deepl_api_key":
      return config.translator.deepl.api_key ?? "";
    case "google_base_url":
      return config.translator.google.base_url;
    case "google_api_key":
      return config.translator.google.api_key ?? "";
  }
}

function setProviderValue(
  config: AppConfig,
  path: ProviderInputPath,
  value: string,
) {
  switch (path) {
    case "deepl_base_url":
      config.translator.deepl.base_url = value;
      break;
    case "deepl_api_key":
      config.translator.deepl.api_key = value;
      break;
    case "google_base_url":
      config.translator.google.base_url = value;
      break;
    case "google_api_key":
      config.translator.google.api_key = value;
      break;
  }
}

function SettingsTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "settings-tab is-active" : "settings-tab"}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function HotkeyInput({
  labels,
  value,
  onChange,
}: {
  labels: ReturnType<typeof labelsForLanguage>;
  value: string;
  onChange: (value: string) => void;
}) {
  const shortcutPlatform = useMemo(detectShortcutPlatform, []);

  return (
    <Input
      value={formatShortcutForPlatform(value, shortcutPlatform)}
      onChange={(event) =>
        onChange(normalizeShortcutForConfig(event.target.value))
      }
      onKeyDown={(event) => {
        event.preventDefault();
        const shortcut = shortcutFromKeyboardEvent(event, shortcutPlatform);
        if (shortcut) onChange(shortcut);
      }}
      placeholder={labels.hotkeyInputPlaceholder}
    />
  );
}

type ShortcutPlatform = "macos" | "windows" | "linux";

function detectShortcutPlatform(): ShortcutPlatform {
  if (typeof navigator === "undefined") return "linux";
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  return "linux";
}

function shortcutFromKeyboardEvent(
  event: React.KeyboardEvent<HTMLInputElement>,
  platform: ShortcutPlatform,
) {
  const key = normalizeShortcutKey(event.key, event.code);
  const modifiers = shortcutModifiersFromKeyboardEvent(event, platform);

  if (!key || isShortcutModifierKey(key)) {
    return "";
  }
  return [...modifiers, key].join("+");
}

function shortcutModifiersFromKeyboardEvent(
  event: React.KeyboardEvent<HTMLInputElement>,
  platform: ShortcutPlatform,
) {
  const modifiers = [];
  if (event.metaKey) modifiers.push(platform === "macos" ? "Cmd" : "Super");
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return modifiers;
}

function normalizeShortcutKey(key: string, code: string) {
  const physicalKey = normalizeShortcutCode(code);
  if (physicalKey) return physicalKey;
  if (!key || key === "Dead" || key === "Process" || key === "Unidentified") {
    return "";
  }
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function normalizeShortcutCode(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  const specialKeys: Record<string, string> = {
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    Backquote: "`",
    Backspace: "Backspace",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Delete: "Delete",
    End: "End",
    Equal: "=",
    Enter: "Enter",
    Escape: "Escape",
    Home: "Home",
    Insert: "Insert",
    Minus: "-",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab",
  };
  return specialKeys[code] ?? "";
}

function isShortcutModifierKey(key: string) {
  return ["Alt", "Control", "Meta", "OS", "Shift", "Super"].includes(key);
}

// 配置仍保存后端可解析的快捷键名，输入框只按当前系统翻译显示名称。
function formatShortcutForPlatform(value: string, platform: ShortcutPlatform) {
  return value
    .split("+")
    .map((token) => formatShortcutTokenForPlatform(token, platform))
    .join("+");
}

function formatShortcutTokenForPlatform(
  token: string,
  platform: ShortcutPlatform,
) {
  const trimmed = token.trim();
  const normalized = shortcutTokenLookupKey(trimmed);
  const modifier = formatShortcutModifierForPlatform(normalized, platform);
  if (modifier) return modifier;
  const key = formatShortcutKeyForPlatform(normalized, platform);
  if (key) return key;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

function formatShortcutModifierForPlatform(
  token: string,
  platform: ShortcutPlatform,
) {
  switch (token) {
    case "alt":
    case "option":
      return platform === "macos" ? "Option" : "Alt";
    case "cmd":
    case "command":
    case "meta":
    case "super":
      if (platform === "macos") return "Command";
      return platform === "windows" ? "Win" : "Super";
    case "cmdorctrl":
    case "commandorcontrol":
    case "commandorctrl":
    case "cmdorcontrol":
      return platform === "macos" ? "Command" : "Ctrl";
    case "control":
    case "ctrl":
      return platform === "macos" ? "Control" : "Ctrl";
    case "shift":
      return "Shift";
    default:
      return "";
  }
}

function formatShortcutKeyForPlatform(
  token: string,
  platform: ShortcutPlatform,
) {
  switch (token) {
    case "arrowdown":
    case "down":
      return "Down";
    case "arrowleft":
    case "left":
      return "Left";
    case "arrowright":
    case "right":
      return "Right";
    case "arrowup":
    case "up":
      return "Up";
    case "backspace":
      return platform === "macos" ? "Delete" : "Backspace";
    case "delete":
      return platform === "macos" ? "Forward Delete" : "Delete";
    case "enter":
    case "return":
      return platform === "macos" ? "Return" : "Enter";
    case "esc":
    case "escape":
      return "Esc";
    case "pagedown":
      return "Page Down";
    case "pageup":
      return "Page Up";
    case "space":
      return "Space";
    default:
      return "";
  }
}

function normalizeShortcutForConfig(value: string) {
  return value
    .split("+")
    .map(normalizeShortcutTokenForConfig)
    .join("+");
}

function normalizeShortcutTokenForConfig(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return "";
  const normalized = shortcutTokenLookupKey(trimmed);
  const configName = SHORTCUT_CONFIG_TOKEN_NAMES[normalized];
  if (configName) return configName;
  if (/^f\d{1,2}$/.test(normalized)) return normalized.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

function shortcutTokenLookupKey(token: string) {
  return token.toLowerCase().replace(/\s+/g, "");
}

const SHORTCUT_CONFIG_TOKEN_NAMES: Record<string, string> = {
  alt: "Alt",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  backspace: "Backspace",
  cmd: "Cmd",
  cmdorcontrol: "CmdOrCtrl",
  cmdorctrl: "CmdOrCtrl",
  command: "Cmd",
  commandorcontrol: "CmdOrCtrl",
  commandorctrl: "CmdOrCtrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  delete: "Delete",
  down: "Down",
  end: "End",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  forwarddelete: "Delete",
  home: "Home",
  insert: "Insert",
  left: "Left",
  meta: "Super",
  option: "Alt",
  pagedown: "PageDown",
  pageup: "PageUp",
  return: "Enter",
  right: "Right",
  shift: "Shift",
  space: "Space",
  super: "Super",
  tab: "Tab",
  up: "Up",
  win: "Super",
  windows: "Super",
};

function visibleProvider(provider?: string) {
  return provider === "deepl" || provider === "google" || provider === "snaptext_cloud"
    ? provider
    : "snaptext_cloud";
}

function applyDocumentTheme(theme?: string) {
  document.documentElement.dataset.theme = theme?.trim() || "system";
}

function updateDraft(
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>,
  userEditedRef: React.MutableRefObject<boolean>,
  editVersionRef: React.MutableRefObject<number>,
  updater: (draft: AppConfig) => void,
) {
  userEditedRef.current = true;
  editVersionRef.current += 1;
  setDraft((current) => {
    if (!current) return current;
    const next = structuredClone(current);
    updater(next);
    return next;
  });
}

function sanitizeConfig(config: AppConfig): AppConfig {
  const next = ensureSpeechDefaults(config);
  next.target_lang = next.target_lang.trim();
  next.ui.theme = next.ui.theme.trim();
  next.ui.language = next.ui.language.trim();
  next.hotkeys.screenshot = normalizeShortcutForConfig(next.hotkeys.screenshot);
  next.hotkeys.selection = normalizeShortcutForConfig(next.hotkeys.selection);
  next.translator.provider = visibleProvider(next.translator.provider.trim());
  next.translator.snaptext_cloud.endpoint = clientSnapTextCloudEndpoint();
  // 选择并保存某个翻译服务即表示启用该服务，UI 不再提供额外开关。
  next.translator.snaptext_cloud.enabled =
    next.translator.provider === "snaptext_cloud";
  next.translator.snaptext_cloud.device_id =
    next.translator.snaptext_cloud.device_id.trim();
  next.translator.openai_compatible.base_url =
    next.translator.openai_compatible.base_url.trim();
  next.translator.openai_compatible.api_key = optionalTrim(
    next.translator.openai_compatible.api_key,
  );
  next.translator.openai_compatible.model =
    next.translator.openai_compatible.model.trim();
  next.translator.deepl.base_url = next.translator.deepl.base_url.trim();
  next.translator.deepl.api_key = optionalTrim(next.translator.deepl.api_key);
  next.translator.google.base_url = next.translator.google.base_url.trim();
  next.translator.google.api_key = optionalTrim(next.translator.google.api_key);
  next.translator.local_http.endpoint =
    next.translator.local_http.endpoint.trim();
  next.speech.english_accent =
    next.speech.english_accent === "british" ? "british" : "american";
  next.speech.rate = clampNumber(next.speech.rate, 0.1, 3);
  next.speech.volume = clampNumber(next.speech.volume, 0, 1);
  return next;
}

function optionalTrim(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function ensureSpeechDefaults(config: AppConfig): AppConfig {
  const next = structuredClone(config);
  next.speech = {
    ...defaultSpeechConfig(),
    ...(next.speech ?? {}),
  };
  return next;
}

function defaultSpeechConfig() {
  return {
    enabled: true,
    english_accent: "american",
    rate: 1,
    volume: 1,
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
