import { useEffect, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { labelsForLanguage } from "@/lib/labels";
import { clientSnapTextCloudEndpoint } from "@/lib/snaptext-cloud";
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

export type ProviderId = "snaptext_cloud" | "deepl" | "google";

type ProviderInputPath =
  | "deepl_base_url"
  | "deepl_api_key"
  | "google_base_url"
  | "google_api_key";

const PROVIDER_IDS: ProviderId[] = ["snaptext_cloud", "deepl", "google"];

export function ProviderSummary({
  labels,
  onConfigure,
  provider,
}: {
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

export function ProviderDialog({
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

            {selectedProvider === "snaptext_cloud" ? null : (
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

export function visibleProvider(provider?: string) {
  return provider === "deepl" || provider === "google" || provider === "snaptext_cloud"
    ? provider
    : "snaptext_cloud";
}

export function mergeProviderConfig(current: AppConfig, providerDraft: AppConfig): AppConfig {
  const next = structuredClone(current);
  next.translator.provider = providerDraft.translator.provider;
  next.translator.snaptext_cloud = structuredClone(providerDraft.translator.snaptext_cloud);
  next.translator.deepl = structuredClone(providerDraft.translator.deepl);
  next.translator.google = structuredClone(providerDraft.translator.google);
  return next;
}

export function sanitizeProviderConfig(config: AppConfig): AppConfig {
  const next = structuredClone(config);
  next.translator.provider = visibleProvider(next.translator.provider.trim());
  next.translator.snaptext_cloud.endpoint = clientSnapTextCloudEndpoint();
  // 选择并保存某个翻译服务即表示启用该服务，UI 不再提供额外开关。
  next.translator.snaptext_cloud.enabled =
    next.translator.provider === "snaptext_cloud";
  next.translator.snaptext_cloud.device_id =
    next.translator.snaptext_cloud.device_id.trim();
  next.translator.deepl.base_url = next.translator.deepl.base_url.trim();
  next.translator.deepl.api_key = optionalTrim(next.translator.deepl.api_key);
  next.translator.google.base_url = next.translator.google.base_url.trim();
  next.translator.google.api_key = optionalTrim(next.translator.google.api_key);
  return next;
}

export function providerMeta(provider: ProviderId, labels: ReturnType<typeof labelsForLanguage>) {
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

function optionalTrim(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
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
