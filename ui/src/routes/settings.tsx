import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Keyboard, MonitorCog, Save, ServerCog, Volume2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { labelsForLanguage } from "@/lib/labels";
import {
  useConfigQuery,
  useUpdateConfigMutation,
} from "@/lib/queries";
import type { AppConfig } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type SettingsTab = "interface" | "hotkeys" | "speech" | "provider";

export function SettingsPage() {
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const workspace = useWorkspaceState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("interface");
  const speechEnabled = draft?.speech.enabled ?? false;
  const labels = labelsForLanguage(
    draft?.ui.language ?? configQuery.data?.ui.language,
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !configQuery.data) return false;
    return hasTabUnsavedChanges(activeTab, ensureSpeechDefaults(draft), ensureSpeechDefaults(configQuery.data));
  }, [activeTab, configQuery.data, draft]);

  useEffect(() => {
    if (configQuery.data) setDraft(ensureSpeechDefaults(configQuery.data));
  }, [configQuery.data]);

  const providerConfig = useMemo(
    () => visibleProvider(draft?.translator.provider),
    [draft],
  );

  if (!draft) {
    return (
      <Card>
        <CardContent>Loading settings...</CardContent>
      </Card>
    );
  }

  async function handleSave(tab: SettingsTab) {
    if (!draft) return;
    try {
      const saved = await updateConfig.mutateAsync(
        sanitizeConfig(mergeConfigForTab(tab, configQuery.data ?? draft, draft)),
      );
      setDraft(saved);
      workspace.setStatus(labels.configSaved);
    } catch (error) {
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return (
    <Card className="settings-card">
      <CardHeader className="settings-header">
        <div className="settings-title-row">
          <Button asChild variant="ghost" size="icon" aria-label="返回主页">
            <Link to="/">
              <ArrowLeft size={17} />
            </Link>
          </Button>
          <CardTitle>{labels.settings}</CardTitle>
        </div>
        <Badge variant={hasUnsavedChanges ? "primary" : "default"}>
          {hasUnsavedChanges ? labels.unsavedChanges : labels.saved}
        </Badge>
      </CardHeader>
      <CardContent className="settings-shell">
        <nav className="settings-tab-list" aria-label={labels.settings}>
          <SettingsTabButton
            active={activeTab === "interface"}
            icon={<MonitorCog size={16} />}
            label="界面"
            onClick={() => setActiveTab("interface")}
          />
          <SettingsTabButton
            active={activeTab === "hotkeys"}
            icon={<Keyboard size={16} />}
            label="快捷键"
            onClick={() => setActiveTab("hotkeys")}
          />
          <SettingsTabButton
            active={activeTab === "provider"}
            icon={<ServerCog size={16} />}
            label={labels.provider}
            onClick={() => setActiveTab("provider")}
          />
          <SettingsTabButton
            active={activeTab === "speech"}
            icon={<Volume2 size={16} />}
            label={labels.speech}
            onClick={() => setActiveTab("speech")}
          />
        </nav>

        <div className="settings-tab-panel">
        {activeTab === "interface" ? (
          <section className="settings-block">
          <div className="settings-grid">
            <Field>
              <FieldLabel>{labels.interfaceLanguage}</FieldLabel>
              <Select
                value={draft.ui.language}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.ui.language = event.target.value),
                  )
                }
              >
                <option value="zh_cn">中文</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{labels.theme}</FieldLabel>
              <Select
                value={draft.ui.theme}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.ui.theme = event.target.value),
                  )
                }
              >
                <option value="system">{labels.themeSystem}</option>
                <option value="light">{labels.themeLight}</option>
                <option value="dark">{labels.themeDark}</option>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{labels.resultDock}</FieldLabel>
              <Select
                value={draft.ui.result_panel_dock}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.ui.result_panel_dock = event.target.value),
                  )
                }
              >
                <option value="cursor">{labels.dockCursor}</option>
                <option value="fixed">{labels.dockFixed}</option>
              </Select>
            </Field>
          </div>
          <SettingsSaveRow
            disabled={!hasUnsavedChanges || updateConfig.isPending}
            labels={labels}
            loading={updateConfig.isPending}
            onSave={() => handleSave("interface")}
          />
          </section>
        ) : null}

        {activeTab === "hotkeys" ? (
          <section className="settings-block">
          <div className="settings-grid">
            <Field>
              <FieldLabel>{labels.screenshotHotkey}</FieldLabel>
              <HotkeyInput
                value={draft.hotkeys.screenshot}
                onChange={(value) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.hotkeys.screenshot = value),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel>{labels.selectionHotkey}</FieldLabel>
              <HotkeyInput
                value={draft.hotkeys.selection}
                onChange={(value) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.hotkeys.selection = value),
                  )
                }
              />
            </Field>
          </div>
          <SettingsSaveRow
            disabled={!hasUnsavedChanges || updateConfig.isPending}
            labels={labels}
            loading={updateConfig.isPending}
            onSave={() => handleSave("hotkeys")}
          />
          </section>
        ) : null}

        {activeTab === "provider" ? (
          <section className="settings-block">
          <Field>
            <FieldLabel>{labels.provider}</FieldLabel>
            <Select
              value={providerConfig}
              onChange={(event) =>
                updateDraft(
                  setDraft,
                  (next) => (next.translator.provider = event.target.value),
                )
              }
            >
              <option value="snaptext_cloud">SnapText 官方源</option>
              <option value="deepl">DeepL</option>
              <option value="google">Google</option>
            </Select>
          </Field>
          <ProviderFields
            draft={draft}
            setDraft={setDraft}
            provider={providerConfig}
          />
          {hasUnsavedChanges ? (
            <Badge variant="primary">{labels.unsavedChanges}</Badge>
          ) : null}
          <SettingsSaveRow
            disabled={!hasUnsavedChanges || updateConfig.isPending}
            labels={labels}
            loading={updateConfig.isPending}
            onSave={() => handleSave("provider")}
          />
          </section>
        ) : null}

        {activeTab === "speech" ? (
          <section className="settings-block">
          <div className="settings-grid settings-speech-grid">
            <label className="settings-toggle-row">
              <Switch
                checked={draft.speech.enabled}
                onCheckedChange={(checked) =>
                  updateDraft(
                    setDraft,
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
                    (next) => (next.speech.english_accent = event.target.value),
                  )
                }
              >
                <option value="american">{labels.englishAccentAmerican}</option>
                <option value="british">{labels.englishAccentBritish}</option>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{labels.speechRate}</FieldLabel>
              <Input
                disabled={!speechEnabled}
                type="number"
                min="0.1"
                max="3"
                step="0.1"
                value={draft.speech.rate}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.speech.rate = Number(event.target.value)),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel>{labels.speechVolume}</FieldLabel>
              <Input
                disabled={!speechEnabled}
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={draft.speech.volume}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.speech.volume = Number(event.target.value)),
                  )
                }
              />
            </Field>
          </div>
          <SettingsSaveRow
            disabled={!hasUnsavedChanges || updateConfig.isPending}
            labels={labels}
            loading={updateConfig.isPending}
            onSave={() => handleSave("speech")}
          />
          </section>
        ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderFields({
  draft,
  setDraft,
  provider,
}: {
  draft: AppConfig;
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  provider: string;
}) {
  if (provider === "snaptext_cloud") {
    return (
      <div className="settings-grid">
        <Field>
          <FieldLabel>SnapText device ID</FieldLabel>
          <Input
            value={draft.translator.snaptext_cloud.device_id}
            onChange={(event) =>
              updateDraft(
                setDraft,
                (next) =>
                  (next.translator.snaptext_cloud.device_id =
                    event.target.value),
              )
            }
          />
        </Field>
      </div>
    );
  }
  if (provider === "deepl") {
    return (
      <div className="settings-grid">
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          path="deepl_base_url"
          label="DeepL base URL"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
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
          path="google_base_url"
          label="Google base URL"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          path="google_api_key"
          label="Google API key"
        />
      </div>
    );
  }
  return null;
}

type ProviderInputPath =
  | "deepl_base_url"
  | "deepl_api_key"
  | "google_base_url"
  | "google_api_key";

function ProviderInput({
  draft,
  setDraft,
  path,
  label,
}: {
  draft: AppConfig;
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>;
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
          updateDraft(setDraft, (next) =>
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

function SettingsSaveRow({
  disabled,
  labels,
  loading,
  onSave,
}: {
  disabled: boolean;
  labels: ReturnType<typeof labelsForLanguage>;
  loading: boolean;
  onSave: () => void;
}) {
  return (
    <section className="settings-save-row settings-save-bar">
      <Button onClick={onSave} variant="primary" disabled={disabled}>
        <Save size={16} />
        {loading ? labels.saving : labels.save}
      </Button>
    </section>
  );
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
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        event.preventDefault();
        const shortcut = shortcutFromKeyboardEvent(event);
        if (shortcut) onChange(shortcut);
      }}
      placeholder="按下快捷键"
    />
  );
}

function shortcutFromKeyboardEvent(event: React.KeyboardEvent<HTMLInputElement>) {
  const key = normalizeShortcutKey(event.key, event.code);
  const modifiers = [
    event.metaKey || event.ctrlKey ? "CmdOrCtrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean);

  if (!key || key === "Control" || key === "Meta" || key === "Alt" || key === "Shift") {
    return "";
  }
  return [...modifiers, key].join("+");
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
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Equal: "=",
    Minus: "-",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
  };
  return specialKeys[code] ?? "";
}

function visibleProvider(provider?: string) {
  return provider === "deepl" || provider === "google" || provider === "snaptext_cloud"
    ? provider
    : "snaptext_cloud";
}

function hasTabUnsavedChanges(tab: SettingsTab, draft: AppConfig, saved: AppConfig) {
  const next = sanitizeConfig(mergeConfigForTab(tab, saved, draft));
  const current = sanitizeConfig(saved);
  return JSON.stringify(next) !== JSON.stringify(current);
}

function mergeConfigForTab(tab: SettingsTab, base: AppConfig, draft: AppConfig) {
  const next = structuredClone(base);
  switch (tab) {
    case "interface":
      next.ui = structuredClone(draft.ui);
      break;
    case "hotkeys":
      next.hotkeys = structuredClone(draft.hotkeys);
      break;
    case "provider":
      next.translator = structuredClone(draft.translator);
      break;
    case "speech":
      next.speech = structuredClone(draft.speech);
      break;
  }
  return next;
}

function updateDraft(
  setDraft: React.Dispatch<React.SetStateAction<AppConfig | null>>,
  updater: (draft: AppConfig) => void,
) {
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
  next.ui.result_panel_dock = next.ui.result_panel_dock.trim();
  next.hotkeys.screenshot = next.hotkeys.screenshot.trim();
  next.hotkeys.selection = next.hotkeys.selection.trim();
  next.translator.provider = visibleProvider(next.translator.provider.trim());
  // SnapText 官方源地址由客户端构建配置决定，设置页不展示地址选择。
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
