import { useEffect, useMemo, useState } from "react";
import { formatCapabilitiesForClipboard } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { getDesktopCapabilities } from "@/lib/api";
import {
  useCheckOcrWorkerMutation,
  useConfigQuery,
  useUpdateConfigMutation,
} from "@/lib/queries";
import { copyText } from "@/lib/tauri";
import type { AppConfig, DesktopCapabilityStatus } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function SettingsPage() {
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const checkOcrWorker = useCheckOcrWorkerMutation();
  const workspace = useWorkspaceState();
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [modelStatus, setModelStatus] = useState("尚未检查 OCR Worker");
  const [capabilities, setCapabilities] = useState<DesktopCapabilityStatus[]>(
    [],
  );
  const labels = labelsForLanguage(
    draft?.ui.language ?? configQuery.data?.ui.language,
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !configQuery.data) return false;
    return (
      JSON.stringify(sanitizeConfig(draft)) !==
      JSON.stringify(sanitizeConfig(configQuery.data))
    );
  }, [configQuery.data, draft]);

  useEffect(() => {
    if (configQuery.data) setDraft(configQuery.data);
  }, [configQuery.data]);

  const providerConfig = useMemo(
    () => draft?.translator.provider ?? "openai_compatible",
    [draft],
  );

  if (!draft) {
    return (
      <Card>
        <CardContent>Loading settings...</CardContent>
      </Card>
    );
  }

  async function handleSave() {
    if (!draft) return;
    try {
      const saved = await updateConfig.mutateAsync(sanitizeConfig(draft));
      setDraft(saved);
      workspace.setStatus(labels.configSaved);
    } catch (error) {
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function handleCheckWorker() {
    try {
      const report = await checkOcrWorker.mutateAsync();
      setModelStatus(
        `python: ${report.python_available}, paddleocr: ${report.paddleocr_available}, worker: ${report.worker_ready}. ${report.message}`,
      );
      workspace.setStatus(
        report.worker_ready
          ? labels.ocrModelsValidated
          : labels.ocrModelFilesMissing,
      );
    } catch (error) {
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function handleCapabilities() {
    try {
      const items = await getDesktopCapabilities();
      setCapabilities(items);
      workspace.setStatus(labels.desktopCapabilitiesChecked);
    } catch (error) {
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function handleCopyCapabilities() {
    const text = formatCapabilitiesForClipboard(capabilities);
    if (!text) {
      workspace.showError(labels.noDesktopCapabilitiesToCopy);
      return;
    }
    try {
      await copyText(text);
      workspace.setStatus(labels.desktopCapabilitiesCopied);
    } catch (error) {
      workspace.showError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.settings}</CardTitle>
        <CardDescription>
          调整界面、快捷键、OCR Worker 和翻译服务。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <section className="settings-block">
          <SectionTitle title="界面" detail={labels.targetLanguage} />
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
              <FieldLabel>{labels.targetLanguage}</FieldLabel>
              <Input
                value={draft.target_lang}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.target_lang = event.target.value),
                  )
                }
              />
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
        </section>

        <section className="settings-block">
          <SectionTitle title="快捷键" detail={labels.screenshotHotkey} />
          <div className="settings-grid">
            <Field>
              <FieldLabel>{labels.screenshotHotkey}</FieldLabel>
              <Input
                value={draft.hotkeys.screenshot}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.hotkeys.screenshot = event.target.value),
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel>{labels.selectionHotkey}</FieldLabel>
              <Input
                value={draft.hotkeys.selection}
                onChange={(event) =>
                  updateDraft(
                    setDraft,
                    (next) => (next.hotkeys.selection = event.target.value),
                  )
                }
              />
            </Field>
          </div>
        </section>

        <section className="settings-block">
          <SectionTitle
            title={labels.saveSettings}
            detail={hasUnsavedChanges ? labels.unsavedChanges : labels.saved}
          />
          <div className="settings-save-row">
            <p className="text-sm text-muted-foreground">
              {labels.saveSettingsHint}
            </p>
            <Button
              onClick={handleSave}
              variant="primary"
              disabled={!hasUnsavedChanges || updateConfig.isPending}
            >
              {updateConfig.isPending ? labels.saving : labels.save}
            </Button>
          </div>
        </section>

        <section className="settings-block">
          <SectionTitle title={labels.diagnostics} detail="Tools" />
          <div className="settings-actions">
            <Button onClick={handleCheckWorker}>{labels.validateModels}</Button>
            <Button onClick={handleCapabilities}>
              {labels.checkPermissions}
            </Button>
            <Button onClick={handleCopyCapabilities}>
              {labels.copyDiagnostics}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{modelStatus}</p>
          <ul className="grid gap-2">
            {capabilities.map((item) => (
              <li
                key={item.capability}
                className="rounded-md border border-border bg-card p-2 text-sm"
              >
                <strong>{item.capability}</strong>
                <p className="text-muted-foreground">
                  {item.status} - {item.action}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="settings-block">
          <SectionTitle title={labels.provider} detail="Provider" />
          <p className="text-sm text-muted-foreground">
            {labels.providerSaveHint}
          </p>
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
              <option value="snaptext_cloud">SnapText 免费源</option>
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="deepl">DeepL</option>
              <option value="google">Google</option>
              <option value="local_http">Local HTTP</option>
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
        </section>
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
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Switch
            checked={draft.translator.snaptext_cloud.enabled}
            onCheckedChange={(checked) =>
              updateDraft(
                setDraft,
                (next) => (next.translator.snaptext_cloud.enabled = checked),
              )
            }
          />
          启用 SnapText 免费源
        </label>
      </div>
    );
  }
  if (provider === "openai_compatible") {
    return (
      <div className="settings-grid">
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          path="openai_base_url"
          label="OpenAI base URL"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          path="openai_api_key"
          label="OpenAI API key"
        />
        <ProviderInput
          draft={draft}
          setDraft={setDraft}
          path="openai_model"
          label="OpenAI model"
        />
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
  return (
    <Field>
      <FieldLabel>Local HTTP endpoint</FieldLabel>
      <Input
        value={draft.translator.local_http.endpoint}
        onChange={(event) =>
          updateDraft(
            setDraft,
            (next) =>
              (next.translator.local_http.endpoint = event.target.value),
          )
        }
      />
    </Field>
  );
}

type ProviderInputPath =
  | "openai_base_url"
  | "openai_api_key"
  | "openai_model"
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
    case "openai_base_url":
      return config.translator.openai_compatible.base_url;
    case "openai_api_key":
      return config.translator.openai_compatible.api_key ?? "";
    case "openai_model":
      return config.translator.openai_compatible.model;
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
    case "openai_base_url":
      config.translator.openai_compatible.base_url = value;
      break;
    case "openai_api_key":
      config.translator.openai_compatible.api_key = value;
      break;
    case "openai_model":
      config.translator.openai_compatible.model = value;
      break;
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

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <strong>{title}</strong>
      <Badge>{detail}</Badge>
    </div>
  );
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
  const next = structuredClone(config);
  next.target_lang = next.target_lang.trim();
  next.ui.theme = next.ui.theme.trim();
  next.ui.language = next.ui.language.trim();
  next.ui.result_panel_dock = next.ui.result_panel_dock.trim();
  next.hotkeys.screenshot = next.hotkeys.screenshot.trim();
  next.hotkeys.selection = next.hotkeys.selection.trim();
  next.translator.provider = next.translator.provider.trim();
  // SnapText 免费源地址由客户端构建配置决定，设置页不展示地址选择。
  next.translator.snaptext_cloud.endpoint = clientSnapTextCloudEndpoint();
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
  return next;
}

function optionalTrim(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
