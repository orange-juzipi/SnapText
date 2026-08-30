import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Keyboard,
  MonitorCog,
  ServerCog,
  ShieldCheck,
  Stethoscope,
  Volume2,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { labelsForLanguage } from "@/lib/labels";
import {
  useConfigQuery,
  useUpdateConfigMutation,
} from "@/lib/queries";
import type { AppConfig, HotkeyConfig } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
import { openSystemSettings } from "@/lib/api";
import deeplProviderIcon from "@/assets/provider-icons/deepl.svg";
import googleTranslateProviderIcon from "@/assets/provider-icons/google-translate.ico";
import snaptextProviderIcon from "@/assets/provider-icons/snaptext.svg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

type SettingsTab = "interface" | "hotkeys" | "speech" | "provider" | "diagnostics";
type QueuedSave = {
  draft: AppConfig;
  version: number;
};

const DEFAULT_HOTKEYS: HotkeyConfig = {
  screenshot: "Alt+W",
  selection: "Alt+E",
};

export function SettingsPage() {
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const workspace = useWorkspaceState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("interface");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
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
  const sectionOrder: SettingsTab[] = ["interface", "hotkeys", "provider", "speech", "diagnostics"];

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

  async function saveProviderConfig(nextDraft: AppConfig) {
    if (!draft) return;
    try {
      setProviderSaveError("");
      const mergedDraft = mergeProviderConfig(draft, nextDraft);
      const saved = await updateConfig.mutateAsync(sanitizeConfig(mergedDraft));
      userEditedRef.current = false;
      queuedSaveRef.current = null;
      setDraft(ensureSpeechDefaults(saved));
      setProviderDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderSaveError(message);
      workspace.showError(message);
    }
  }

  /** Opens one of the macOS privacy panes and reports unsupported platforms as a normal app error. */
  async function handleOpenSystemSettings(section: "screen_recording" | "accessibility" | "microphone") {
    try {
      await openSystemSettings(section);
    } catch (error) {
      workspace.showError(error instanceof Error ? error.message : String(error));
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
          <SettingsTabButton
            active={activeTab === "diagnostics"}
            icon={<Stethoscope size={16} />}
            label={labels.diagnostics}
            onClick={() => scrollToSettingsSection("diagnostics")}
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
            <label className="settings-switch-row">
              <Switch
                checked={draft.ui.auto_translate}
                onCheckedChange={(checked) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.ui.auto_translate = checked),
                  )
                }
              />
              <span>
                <strong>{labels.autoTranslate}</strong>
                <small className="settings-inline-description">{labels.autoTranslateDescription}</small>
              </span>
            </label>
            <Field>
              <FieldLabel>{labels.resultDock}</FieldLabel>
              <Select
                value={draft.ui.result_panel_dock}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    userEditedRef,
                    editVersionRef,
                    (next) => (next.ui.result_panel_dock = event.target.value),
                  )
                }
              >
                <option value="cursor">{labels.dockCursor}</option>
                <option value="fixed">{labels.dockFixed}</option>
              </Select>
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
            <HotkeySettingField
              labels={labels}
              label={labels.screenshotHotkey}
              value={draft.hotkeys.screenshot}
              defaultValue={DEFAULT_HOTKEYS.screenshot}
              onChange={(value) =>
                updateDraft(
                  setDraft,
                  userEditedRef,
                  editVersionRef,
                  (next) => (next.hotkeys.screenshot = value),
                )
              }
            />
            <HotkeySettingField
              labels={labels}
              label={labels.selectionHotkey}
              value={draft.hotkeys.selection}
              defaultValue={DEFAULT_HOTKEYS.selection}
              onChange={(value) =>
                updateDraft(
                  setDraft,
                  userEditedRef,
                  editVersionRef,
                  (next) => (next.hotkeys.selection = value),
                )
              }
            />
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
          <ProviderSummary
            config={draft}
            labels={labels}
            provider={providerConfig}
            onConfigure={() => {
              setProviderSaveError("");
              setProviderDialogOpen(true);
            }}
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
            <label className="settings-switch-row">
              <Switch
                checked={speechEnabled}
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
              <FieldLabel>{labels.speechAccents}</FieldLabel>
              <div className="settings-checkbox-stack">
                <label className="settings-checkbox-row">
                  <Checkbox
                    checked={draft.speech.english_accents.includes("american")}
                    disabled={!speechEnabled}
                    onCheckedChange={(checked) =>
                      updateDraft(
                        setDraft,
                        userEditedRef,
                        editVersionRef,
                        (next) => {
                          next.speech.english_accents = toggleSpeechAccent(
                            next.speech.english_accents,
                            "american",
                            checked === true,
                          );
                          next.speech.english_accent = preferredSpeechAccent(
                            next.speech.english_accents,
                          );
                        },
                      )
                    }
                  />
                  <span>{labels.englishAccentAmerican}</span>
                </label>
                <label className="settings-checkbox-row">
                  <Checkbox
                    checked={draft.speech.english_accents.includes("british")}
                    disabled={!speechEnabled}
                    onCheckedChange={(checked) =>
                      updateDraft(
                        setDraft,
                        userEditedRef,
                        editVersionRef,
                        (next) => {
                          next.speech.english_accents = toggleSpeechAccent(
                            next.speech.english_accents,
                            "british",
                            checked === true,
                          );
                          next.speech.english_accent = preferredSpeechAccent(
                            next.speech.english_accents,
                          );
                        },
                      )
                    }
                  />
                  <span>{labels.englishAccentBritish}</span>
                </label>
              </div>
            </Field>
            <SpeechSliderField
              disabled={!speechEnabled}
              label={labels.speechRate}
              max={3}
              min={0.1}
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
              max={1}
              min={0}
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

          <section
            className="settings-block settings-diagnostics-block"
            ref={(node) => {
              sectionRefs.current.diagnostics = node;
            }}
          >
            <div className="settings-section-heading">
              <h2>{labels.diagnostics}</h2>
            </div>
            <div className="settings-diagnostics-grid">
              <DiagnosticCard
                icon={<ShieldCheck size={17} />}
                label={labels.permissionStatus}
              >
                <PermissionSettingRow
                  label={labels.diagnosticsScreenRecording}
                  onOpen={() => void handleOpenSystemSettings("screen_recording")}
                  openLabel={labels.openSystemSettings}
                />
                <PermissionSettingRow
                  label={labels.diagnosticsAccessibility}
                  onOpen={() => void handleOpenSystemSettings("accessibility")}
                  openLabel={labels.openSystemSettings}
                />
                <PermissionSettingRow
                  label={labels.diagnosticsMicrophone}
                  onOpen={() => void handleOpenSystemSettings("microphone")}
                  openLabel={labels.openSystemSettings}
                />
              </DiagnosticCard>
            </div>
          </section>
        </div>
      </CardContent>
      <ProviderDialog
        config={draft}
        error={providerSaveError}
        labels={labels}
        open={providerDialogOpen}
        saving={updateConfig.isPending}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) setProviderSaveError("");
        }}
        onSave={saveProviderConfig}
      />
    </Card>
  );
}

/** Presents one diagnostic category with a compact status and supporting details. */
function DiagnosticCard({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <article className="settings-diagnostic-card">
      <div className="settings-diagnostic-card-heading">
        <span className="settings-diagnostic-icon" aria-hidden="true">{icon}</span>
        <strong>{label}</strong>
      </div>
      <div className="settings-diagnostic-details">{children}</div>
    </article>
  );
}

/** Renders a permission label together with the system-settings shortcut for that permission. */
function PermissionSettingRow({
  label,
  onOpen,
  openLabel,
}: {
  label: string;
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <div className="settings-permission-row">
      <span>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`${openLabel}: ${label}`}
        onClick={onOpen}
      >
        <ExternalLink size={14} />
        {openLabel}
      </Button>
    </div>
  );
}

function HotkeySettingField({
  defaultValue,
  label,
  labels,
  onChange,
  value,
}: {
  defaultValue: string;
  label: string;
  labels: ReturnType<typeof labelsForLanguage>;
  onChange: (value: string) => void;
  value: string;
}) {
  const normalizedValue = normalizeShortcutForConfig(value);
  const normalizedDefaultValue = normalizeShortcutForConfig(defaultValue);

  return (
    <div className="settings-hotkey-field">
      <FieldLabel>{label}</FieldLabel>
      <div className="settings-hotkey-row">
        <HotkeyInput
          labels={labels}
          value={value}
          onChange={onChange}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={normalizedValue === normalizedDefaultValue}
          onClick={() => onChange(defaultValue)}
        >
          {labels.resetHotkey}
        </Button>
      </div>
    </div>
  );
}

type ProviderId = "snaptext_cloud" | "deepl" | "google";

function ProviderSummary({
  config,
  labels,
  onConfigure,
  provider,
}: {
  config: AppConfig;
  labels: ReturnType<typeof labelsForLanguage>;
  onConfigure: () => void;
  provider: string;
}) {
  const providerId = visibleProvider(provider) as ProviderId;
  const meta = providerMeta(providerId, labels);
  return (
    <div className="settings-provider-summary">
      <div className="settings-provider-summary-main">
        <span className={`settings-provider-logo settings-provider-logo-${providerId}`}>
          <img src={meta.icon} alt="" aria-hidden="true" />
        </span>
        <div className="settings-provider-summary-copy">
          <span className="settings-provider-eyebrow">{labels.currentProvider}</span>
          <strong>{meta.name}</strong>
        </div>
      </div>
      <Button type="button" onClick={onConfigure}>
        {labels.configureProvider}
      </Button>
    </div>
  );
}

function ProviderDialog({
  config,
  error,
  labels,
  onOpenChange,
  onSave,
  open,
  saving,
}: {
  config: AppConfig;
  error: string;
  labels: ReturnType<typeof labelsForLanguage>;
  onOpenChange: (open: boolean) => void;
  onSave: (config: AppConfig) => Promise<void>;
  open: boolean;
  saving: boolean;
}) {
  const [localConfig, setLocalConfig] = useState<AppConfig>(() => structuredClone(config));
  const [showApiKey, setShowApiKey] = useState(false);
  const selectedProvider = visibleProvider(localConfig.translator.provider) as ProviderId;
  const selectedMeta = providerMeta(selectedProvider, labels);
  const requiresApiKey = selectedProvider === "deepl" || selectedProvider === "google";
  const apiKey = selectedProvider === "deepl"
    ? localConfig.translator.deepl.api_key ?? ""
    : selectedProvider === "google"
      ? localConfig.translator.google.api_key ?? ""
      : "";
  const canSave = !saving && (!requiresApiKey || apiKey.trim().length > 0);

  useEffect(() => {
    if (!open) return;
    setLocalConfig(structuredClone(config));
    setShowApiKey(false);
  }, [config, open]);

  function updateLocal(updater: (next: AppConfig) => void) {
    setLocalConfig((current) => {
      const next = structuredClone(current);
      updater(next);
      return next;
    });
  }

  function selectProvider(provider: ProviderId) {
    updateLocal((next) => {
      next.translator.provider = provider;
      next.translator.snaptext_cloud.enabled = provider === "snaptext_cloud";
    });
  }

  function setProviderInput(path: ProviderInputPath, value: string) {
    updateLocal((next) => setProviderValue(next, path, value));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-provider-dialog">
        <DialogHeader>
          <DialogTitle>{labels.providerDialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="settings-provider-dialog-body">
          <div className="settings-provider-list" role="radiogroup" aria-label={labels.provider}>
            {PROVIDER_IDS.map((provider) => {
              const meta = providerMeta(provider, labels);
              const selected = provider === selectedProvider;
              return (
                <button
                  key={provider}
                  type="button"
                  className={selected ? "settings-provider-card is-selected" : "settings-provider-card"}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectProvider(provider)}
                >
                  <span className={`settings-provider-logo settings-provider-logo-${provider}`}>
                    <img src={meta.icon} alt="" aria-hidden="true" />
                  </span>
                  <span className="settings-provider-card-copy">
                    <strong>{meta.name}</strong>
                  </span>
                  {selected ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="settings-provider-config-panel">
            <div className="settings-provider-config-heading">
              <span className={`settings-provider-logo settings-provider-logo-${selectedProvider}`}>
                <img src={selectedMeta.icon} alt="" aria-hidden="true" />
              </span>
              <div>
                <h3>{selectedMeta.name}</h3>
              </div>
            </div>

            {selectedProvider === "snaptext_cloud" ? (
              null
            ) : (
              <div className="settings-provider-form">
                <Field>
                  <FieldLabel>{selectedMeta.name} Base URL</FieldLabel>
                  <Input
                    value={
                      selectedProvider === "deepl"
                        ? localConfig.translator.deepl.base_url
                        : localConfig.translator.google.base_url
                    }
                    onChange={(event) =>
                      setProviderInput(
                        selectedProvider === "deepl" ? "deepl_base_url" : "google_base_url",
                        event.target.value,
                      )
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel>{selectedMeta.name} API Key</FieldLabel>
                  <div className="settings-secret-input-row">
                    <Input
                      value={apiKey}
                      type={showApiKey ? "text" : "password"}
                      placeholder={labels.providerApiKeyPlaceholder}
                      onChange={(event) =>
                        setProviderInput(
                          selectedProvider === "deepl" ? "deepl_api_key" : "google_api_key",
                          event.target.value,
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={showApiKey ? labels.hideApiKey : labels.showApiKey}
                      onClick={() => setShowApiKey((current) => !current)}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                </Field>
              </div>
            )}

            {requiresApiKey && !apiKey.trim() ? (
              <p className="settings-provider-error">{labels.providerApiKeyRequired}</p>
            ) : null}
            {error ? <p className="settings-provider-error">{error}</p> : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSave}
            onClick={() => onSave(localConfig)}
          >
            {saving ? labels.saving : labels.saveAndEnableProvider}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  disabled?: boolean;
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
      <Input
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
  labels,
  onChange,
  value,
}: {
  labels: ReturnType<typeof labelsForLanguage>;
  onChange: (value: string) => void;
  value: string;
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
  onChange,
  value,
}: {
  labels: ReturnType<typeof labelsForLanguage>;
  onChange: (value: string) => void;
  value: string;
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

const PROVIDER_IDS: ProviderId[] = ["snaptext_cloud", "deepl", "google"];

function providerMeta(provider: ProviderId, labels: ReturnType<typeof labelsForLanguage>) {
  switch (provider) {
    case "snaptext_cloud":
      return {
        icon: snaptextProviderIcon,
        name: labels.snaptextCloudProvider,
      };
    case "deepl":
      return {
        icon: deeplProviderIcon,
        name: "DeepL",
      };
    case "google":
      return {
        icon: googleTranslateProviderIcon,
        name: "Google Translate",
      };
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

function mergeProviderConfig(current: AppConfig, providerDraft: AppConfig): AppConfig {
  const next = structuredClone(current);
  next.translator.provider = providerDraft.translator.provider;
  next.translator.snaptext_cloud = structuredClone(providerDraft.translator.snaptext_cloud);
  next.translator.deepl = structuredClone(providerDraft.translator.deepl);
  next.translator.google = structuredClone(providerDraft.translator.google);
  return next;
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
  next.speech.english_accents = normalizeSpeechAccents(next.speech.english_accents);
  next.speech.english_accent = preferredSpeechAccent(next.speech.english_accents);
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
  next.speech.english_accents = normalizeSpeechAccents(next.speech.english_accents);
  next.speech.english_accent = preferredSpeechAccent(next.speech.english_accents);
  return next;
}

function defaultSpeechConfig() {
  return {
    enabled: true,
    english_accent: "american",
    english_accents: ["american", "british"],
    rate: 1,
    volume: 1,
  };
}

function toggleSpeechAccent(accents: string[], accent: string, enabled: boolean) {
  const current = normalizeSpeechAccents(accents);
  if (!enabled) return current.filter((value) => value !== accent);
  return normalizeSpeechAccents([...current, accent]);
}

function preferredSpeechAccent(accents: string[]) {
  return accents.includes("british") && !accents.includes("american")
    ? "british"
    : "american";
}

function normalizeSpeechAccents(accents: string[] | undefined) {
  const normalized: string[] = [];
  for (const accent of accents ?? []) {
    if ((accent === "american" || accent === "british") && !normalized.includes(accent)) {
      normalized.push(accent);
    }
  }
  return normalized;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
