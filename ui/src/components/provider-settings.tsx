import { useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { labelsForLanguage } from "@/lib/labels";
import { translatorProviderLabel } from "@/lib/format";
import { PROVIDER_IDS, providerRequiresApiKey, visibleProvider, type ProviderId } from "@/lib/translation-provider";
import type { AppConfig } from "@/lib/types";
import deeplProviderIcon from "@/assets/provider-icons/deepl.svg";
import googleTranslateProviderIcon from "@/assets/provider-icons/google-translate.ico";
import snaptextProviderIcon from "@/assets/provider-icons/snaptext.svg";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ProviderInputPath =
  | "deepl_base_url"
  | "deepl_api_key"
  | "google_base_url"
  | "google_api_key";

/** 展示当前翻译服务，并提供与主页一致的配置入口。 */
export function ProviderSummary({
  labels,
  onConfigure,
  provider,
}: {
  /** 当前界面语言的文案。 */
  labels: ReturnType<typeof labelsForLanguage>;
  /** 打开服务草稿对话框。 */
  onConfigure: () => void;
  /** 当前保存的服务标识。 */
  provider: string;
}) {
  const providerId = visibleProvider(provider);
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

/** Keeps unsaved provider credentials stable while background configuration updates complete. */
export function ProviderDialog({
  config,
  error,
  labels,
  onOpenChange,
  onSave,
  open,
  saving,
}: {
  /** Configuration copied when the dialog opens. */
  config: AppConfig;
  /** Persistence failure displayed alongside the provider fields. */
  error: string;
  /** Localized dialog labels. */
  labels: ReturnType<typeof labelsForLanguage>;
  /** Changes the visibility after editing finishes. */
  onOpenChange: (open: boolean) => void;
  /** Persists the provider draft before closing. */
  onSave: (config: AppConfig) => Promise<void>;
  /** Whether the dialog is visible. */
  open: boolean;
  /** Prevents edits while a save is pending. */
  saving: boolean;
}) {
  const [localConfig, setLocalConfig] = useState<AppConfig>(() => structuredClone(config));
  const [showApiKey, setShowApiKey] = useState(false);
  const wasOpenRef = useRef(false);
  const selectedProvider = visibleProvider(localConfig.translator.provider);
  const selectedMeta = providerMeta(selectedProvider, labels);
  const requiresApiKey = providerRequiresApiKey(selectedProvider);
  const apiKey = selectedProvider === "deepl"
    ? localConfig.translator.deepl.api_key ?? ""
    : selectedProvider === "google"
      ? localConfig.translator.google.api_key ?? ""
      : "";
  const canSave = !saving && (!requiresApiKey || apiKey.trim().length > 0);

  /** 仅在打开瞬间克隆配置，后台保存不能覆盖正在编辑的草稿。 */
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setLocalConfig(structuredClone(config));
      setShowApiKey(false);
    }
    wasOpenRef.current = open;
  }, [config, open]);

  /** Updates an isolated provider draft without touching the cached settings. */
  function updateLocal(updater: (next: AppConfig) => void) {
    setLocalConfig((current) => {
      const next = structuredClone(current);
      updater(next);
      return next;
    });
  }

  /** Selects the active provider and synchronizes the official service flag. */
  function selectProvider(provider: ProviderId) {
    updateLocal((next) => {
      next.translator.provider = provider;
      next.translator.snaptext_cloud.enabled = provider === "snaptext_cloud";
    });
  }

  /** Writes the selected provider field into the dialog draft. */
  function setProviderInput(path: ProviderInputPath, value: string) {
    updateLocal((next) => setProviderValue(next, path, value));
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen); }}>
      <DialogContent className="settings-provider-dialog" aria-describedby={undefined}>
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
                  disabled={saving}
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
                {selectedProvider !== "google_web" ? <p>{selectedMeta.description}</p> : null}
              </div>
            </div>

            {selectedProvider === "google_web" ? (
              <div className="settings-provider-empty-config">
                <strong>{labels.noApiKeyRequired}</strong>
                <span>{selectedMeta.description}</span>
              </div>
            ) : selectedProvider === "snaptext_cloud" ? (
              <div className="settings-provider-form">
                <label className="settings-provider-privacy-toggle">
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={localConfig.translator.snaptext_cloud.privacy_sensitive}
                    onChange={(event) =>
                      updateLocal((next) => {
                        next.translator.snaptext_cloud.privacy_sensitive = event.target.checked;
                      })
                    }
                  />
                  <span>{labels.snaptextCloudPrivacyMode}</span>
                </label>
              </div>
            ) : (
              <div className="settings-provider-form">
                <Field>
                  <FieldLabel>{selectedMeta.name} Base URL</FieldLabel>
                  <Input
                    disabled={saving}
                    aria-label={`${selectedMeta.name} Base URL`}
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
                      disabled={saving}
                      aria-label={`${selectedMeta.name} API Key`}
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
                      disabled={saving}
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
          <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
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

type ProviderMetadata = {
  /** 服务对应的本地图标。 */
  icon: string;
  /** 区分官方 API 与网页直连的本地化服务名称。 */
  name: string;
  /** 当前服务的密钥要求、连接方式和使用限制。 */
  description: string;
};

/** 将服务标识转换为统一名称、说明与品牌图标。 */
function providerMeta(provider: ProviderId, labels: ReturnType<typeof labelsForLanguage>): ProviderMetadata {
  const name = translatorProviderLabel(provider, labels);
  switch (provider) {
    case "snaptext_cloud":
      return { icon: snaptextProviderIcon, name, description: labels.snaptextCloudDescription };
    case "deepl":
      return { icon: deeplProviderIcon, name, description: labels.deeplProviderDescription };
    case "google":
      return { icon: googleTranslateProviderIcon, name, description: labels.googleProviderDescription };
    case "google_web":
      return { icon: googleTranslateProviderIcon, name, description: labels.googleWebProviderDescription };
  }
}

/** 将凭据或地址写入对应的官方 API 配置，网页直连不接收这些输入。 */
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
