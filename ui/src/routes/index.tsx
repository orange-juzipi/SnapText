import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { ArrowLeftRight, ChevronDown, Copy, LoaderCircle, Pin, ScanText, Trash2, Volume2 } from "lucide-react";
import { startScreenshotOverlay, unpinResultWindow } from "@/lib/api";
import { translatorProviderDetailLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import {
  AUTO_SOURCE_LANG,
  DEFAULT_TARGET_LANG,
  detectSourceLang,
  languageDisplayName,
  normalizeTargetLang,
  resolveSourceLang,
  resolveSourceSpeechLang,
} from "@/lib/language";
import { errorMessage } from "@/lib/errors";
import { isSpeechSupported, speakText, stopSpeech } from "@/lib/speech";
import {
  useConfigQuery,
  usePinResultMutation,
  useTranslateTextMutation,
  useUpdateConfigMutation,
} from "@/lib/queries";
import { copyText } from "@/lib/tauri";
import type { HistoryRecord } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import {
  mergeProviderConfig,
  ProviderDialog,
  sanitizeProviderConfig,
} from "@/components/provider-settings";
import { LanguageCombobox } from "@/components/language-combobox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SpeechAccent = "american" | "british";
const AUTO_TRANSLATE_DEBOUNCE_MS = 800;

export function WorkspacePage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();

  const translateTextMutation = useTranslateTextMutation();
  const updateConfigMutation = useUpdateConfigMutation();
  const pinMutation = usePinResultMutation();
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
  const autoTranslatingRef = useRef(false);
  const autoTranslatePendingRef = useRef<{ sourceText: string; sourceLang: string; targetLang: string } | null>(null);
  const lastAutoTranslatedKeyRef = useRef("");
  const detectedSourceLang = detectSourceLang(workspace.textInput);
  const sourceSpeechLang = resolveSourceSpeechLang(workspace.textInput, workspace.sourceLang);
  const detectedSourceLabel =
    detectedSourceLang === AUTO_SOURCE_LANG
      ? labels.detectedLanguageAuto
      : languageDisplayName(detectedSourceLang, configQuery.data?.ui.language);
  const speechReady =
    Boolean(configQuery.data) && isSpeechSupported(configQuery.data?.speech);
  const hasWorkspaceText = Boolean(
    workspace.textInput.trim() ||
      workspace.snapshot.sourceText.trim() ||
      workspace.snapshot.result.trim(),
  );
  const canSwapTranslation = Boolean(
    workspace.textInput.trim() &&
      workspace.snapshot.result.trim() &&
      !workspace.ocrLoading &&
      !workspace.translating &&
      !translateTextMutation.isPending,
  );

  useEffect(() => {
    if (speechReady || !activeSpeechKey) return;
    // 语音配置关闭后立即停止当前朗读，避免系统朗读继续播放。
    stopSpeech();
    setActiveSpeechKey(null);
  }, [activeSpeechKey, speechReady]);

  useEffect(() => {
    if (workspace.ocrLoading) return;
    const sourceText = workspace.textInput.trim();
    if (!sourceText) {
      autoTranslatePendingRef.current = null;
      lastAutoTranslatedKeyRef.current = "";
      workspace.clearTranslation();
      return;
    }
    if (
      sourceText === workspace.snapshot.sourceText.trim() &&
      (workspace.snapshot.sourceKind === "screenshot" || workspace.snapshot.sourceKind === "selection")
    ) {
      return;
    }
    const sourceLang = workspace.sourceLang;
    const targetLang = normalizeTargetLang(workspace.targetLang);
    const requestKey = autoTranslateKey(sourceText, sourceLang, targetLang);
    if (requestKey === lastAutoTranslatedKeyRef.current) return;

    const timeout = window.setTimeout(() => {
      void runAutoTranslate(sourceText, sourceLang, targetLang);
    }, AUTO_TRANSLATE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [workspace.ocrLoading, workspace.sourceLang, workspace.targetLang, workspace.textInput]);

  useEffect(() => {
    if (workspace.translating) return;
    const pending = autoTranslatePendingRef.current;
    if (!pending) return;
    autoTranslatePendingRef.current = null;
    void runAutoTranslate(pending.sourceText, pending.sourceLang, pending.targetLang);
  }, [workspace.translating]);

  useEffect(() => {
    const sourceText = workspace.snapshot.sourceText.trim();
    if (!workspace.snapshot.result.trim() || sourceText !== workspace.textInput.trim()) return;
    const sourceLang = workspace.sourceLang;
    const targetLang = normalizeTargetLang(workspace.snapshot.targetLang || workspace.targetLang);
    lastAutoTranslatedKeyRef.current = autoTranslateKey(sourceText, sourceLang, targetLang);
  }, [
    workspace.snapshot.result,
    workspace.snapshot.sourceText,
    workspace.snapshot.targetLang,
    workspace.sourceLang,
    workspace.targetLang,
    workspace.textInput,
  ]);

  async function runTranslateText(sourceText: string, sourceLang: string, targetLang: string, mode: "manual" | "auto") {
    try {
      workspace.setTranslating(true);
      const record = await translateTextMutation.mutateAsync({
        sourceText,
        sourceLang,
        targetLang,
      });
      setTextResult(record);
      workspace.setStatus(labels.textTranslated);
    } catch (error) {
      if (mode === "manual") {
        workspace.showError(errorMessage(error));
      } else {
        workspace.setStatus(errorMessage(error));
      }
    } finally {
      workspace.setTranslating(false);
    }
  }

  async function runAutoTranslate(sourceText: string, sourceLang: string, targetLang: string) {
    const requestKey = autoTranslateKey(sourceText, sourceLang, targetLang);
    if (requestKey === lastAutoTranslatedKeyRef.current) return;
    if (autoTranslatingRef.current || workspace.translating || translateTextMutation.isPending) {
      autoTranslatePendingRef.current = { sourceText, sourceLang, targetLang };
      return;
    }

    autoTranslatingRef.current = true;
    autoTranslatePendingRef.current = null;
    await runTranslateText(sourceText, sourceLang, targetLang, "auto");
    autoTranslatingRef.current = false;
  }

  async function handleTranslateText() {
    const sourceText = workspace.textInput.trim();
    if (!sourceText) {
      workspace.showError(labels.textInputRequired);
      return;
    }
    const sourceLang = workspace.sourceLang;
    const targetLang = normalizeTargetLang(workspace.targetLang);
    autoTranslatePendingRef.current = null;
    await runTranslateText(sourceText, sourceLang, targetLang, "manual");
  }

  async function handleStartOverlay() {
    try {
      await startScreenshotOverlay();
      workspace.setStatus(labels.startOverlay);
    } catch (error) {
      if (isScreenshotSelectionCancelled(error)) {
        workspace.setStatus(labels.ready);
        return;
      }
      workspace.showError(errorMessage(error));
    }
  }

  async function handleCopyResult() {
    if (!workspace.snapshot.result.trim()) {
      workspace.showError(labels.noResultToCopy);
      return;
    }
    try {
      await copyText(workspace.snapshot.result);
      workspace.setStatus(labels.resultCopied);
      workspace.showToast(labels.resultCopied, undefined, "success");
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
  }

  function handleClearTextPanels() {
    stopSpeech();
    setActiveSpeechKey(null);
    workspace.clearTextPanels();
    workspace.setStatus(labels.workspaceTextCleared);
  }

  function handleSwapTranslation() {
    const nextTextInput = workspace.snapshot.result.trim();
    if (!nextTextInput || !canSwapTranslation) return;
    const previousSourceText = workspace.snapshot.sourceText.trim() || workspace.textInput;
    const nextSourceLang = normalizeTargetLang(workspace.snapshot.targetLang || workspace.targetLang);
    const nextTargetLang = resolveSourceLang(previousSourceText, workspace.sourceLang) ?? DEFAULT_TARGET_LANG;
    stopSpeech();
    setActiveSpeechKey(null);
    autoTranslatePendingRef.current = null;
    lastAutoTranslatedKeyRef.current = "";
    workspace.setTextInput(nextTextInput);
    workspace.setSourceLang(nextSourceLang);
    workspace.setTargetLang(nextTargetLang);
    workspace.clearTranslation();
  }

  function handleConfigureProvider() {
    if (!configQuery.data) return;
    setProviderSaveError("");
    setProviderDialogOpen(true);
  }

  async function saveProviderConfig(nextConfig: NonNullable<typeof configQuery.data>) {
    if (!configQuery.data) return;
    try {
      setProviderSaveError("");
      const mergedConfig = mergeProviderConfig(configQuery.data, nextConfig);
      await updateConfigMutation.mutateAsync(sanitizeProviderConfig(mergedConfig));
      setProviderDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderSaveError(message);
      workspace.showError(message);
    }
  }

  async function handleSpeak(text: string, lang: string, key: string, accent?: SpeechAccent) {
    if (!text.trim()) {
      workspace.showError(labels.noSpeechText);
      return;
    }
    if (!speechReady) {
      workspace.showError(
        configQuery.data?.speech.enabled === false
          ? labels.speechDisabled
          : labels.speechUnsupported,
      );
      return;
    }
    if (activeSpeechKey === key) {
      stopSpeech();
      setActiveSpeechKey(null);
      return;
    }
    try {
      setActiveSpeechKey(key);
      await speakText({
        text,
        lang,
        config: configQuery.data?.speech,
        englishAccent: accent,
        onEnd: () => setActiveSpeechKey((current) => (current === key ? null : current)),
        onError: () => setActiveSpeechKey((current) => (current === key ? null : current)),
      });
      workspace.setStatus(labels.speechStarted);
    } catch (error) {
      setActiveSpeechKey((current) => (current === key ? null : current));
      workspace.showError(errorMessage(error));
    }
  }

  function renderSpeechButtons(text: string, lang: string, scope: "source" | "translation", label: string) {
    const speechText = text.trim();
    // 空态不展示播放入口，避免把占位提示误认为可朗读内容。
    if (!speechText) return null;
    if (!speechReady) return null;
    const disabled = !speechReady;
    const tooltipLabel = configQuery.data?.speech.enabled === false
      ? labels.speechEnableToPlay
      : !speechReady
        ? labels.speechUnsupported
        : label;
    if (lang === "en") {
      const englishAccents = visibleEnglishAccents(configQuery.data?.speech.english_accents);
      return (
        <>
          {englishAccents.includes("american") ? (
            <SpeechButton
              active={activeSpeechKey === `${scope}:american`}
              accentLabel="美"
              ariaLabel={disabled ? tooltipLabel : `${label}：美式发音`}
              disabled={disabled}
              tooltipLabel={disabled ? tooltipLabel : undefined}
              onClick={() => handleSpeak(text, lang, `${scope}:american`, "american")}
            />
          ) : null}
          {englishAccents.includes("british") ? (
            <SpeechButton
              active={activeSpeechKey === `${scope}:british`}
              accentLabel="英"
              ariaLabel={disabled ? tooltipLabel : `${label}：英式发音`}
              disabled={disabled}
              tooltipLabel={disabled ? tooltipLabel : undefined}
              onClick={() => handleSpeak(text, lang, `${scope}:british`, "british")}
            />
          ) : null}
        </>
      );
    }
    return (
      <SpeechButton
        active={activeSpeechKey === `${scope}:default`}
        ariaLabel={tooltipLabel}
        disabled={disabled}
        onClick={() => handleSpeak(text, lang, `${scope}:default`)}
      />
    );
  }

  async function handleTogglePin() {
    if (workspace.pinned) {
      try {
        await unpinResultWindow();
        workspace.setPinned(false);
        workspace.setStatus(labels.resultUnpinned);
      } catch (error) {
        workspace.showError(errorMessage(error));
      }
      return;
    }
    try {
      await pinMutation.mutateAsync();
      workspace.setPinned(true);
      workspace.setStatus(labels.resultPinned);
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
  }

  return (
    <>
    <section className="workspace-grid">
      <section className="workspace-panel workspace-panel-source">
        <div className="workspace-panel-toolbar">
          <div className="workspace-badge-row workspace-language-row">
            <span className="workspace-detected-language">
              {labels.detectedLanguage}: {detectedSourceLabel}
            </span>
            <LanguageCombobox
              ariaLabel={labels.sourceLanguage}
              className="workspace-language-select"
              includeAuto
              labels={labels}
              uiLanguage={configQuery.data?.ui.language}
              value={workspace.sourceLang}
              onChange={workspace.setSourceLang}
            />
          </div>
          <div className="workspace-actions">
            {renderSpeechButtons(
              workspace.textInput,
              sourceSpeechLang,
              "source",
              labels.playSource,
            )}
            <IconTooltipButton
              disabled={!hasWorkspaceText || workspace.ocrLoading || workspace.translating}
              label={labels.clearWorkspaceText}
              onClick={handleClearTextPanels}
            >
              <Trash2 size={16} />
            </IconTooltipButton>
            <IconTooltipButton label={labels.startOverlay} onClick={handleStartOverlay}>
              <ScanText size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div className="workspace-textarea-shell" aria-busy={workspace.ocrLoading}>
          <Textarea
            className={
              workspace.ocrLoading
                ? "workspace-textarea workspace-textarea-busy bg-control"
                : "workspace-textarea bg-control"
            }
            value={workspace.ocrLoading ? "" : workspace.textInput}
            onChange={(event) => workspace.setTextInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              if (!workspace.translating && !translateTextMutation.isPending) {
                void handleTranslateText();
              }
            }}
            placeholder={workspace.ocrLoading ? labels.ocrSelectedRegion : labels.textInputPlaceholder}
            disabled={workspace.ocrLoading}
          />
          {workspace.ocrLoading ? (
            // OCR happens outside the main window, so the source input needs its own busy state.
            <div className="workspace-textarea-loading" aria-live="polite">
              <div className="workspace-loading-message">
                <LoaderCircle size={18} aria-hidden="true" />
                <span>{labels.ocrSelectedRegion}</span>
              </div>
              <div className="workspace-loading-bar" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </section>

      <div className="workspace-swap-button-wrap">
        <IconTooltipButton
          className="workspace-swap-button"
          disabled={!canSwapTranslation}
          label={labels.swapSourceTranslation}
          onClick={handleSwapTranslation}
        >
          <ArrowLeftRight size={16} />
        </IconTooltipButton>
      </div>

      <section className="workspace-panel">
        <div className="workspace-panel-toolbar">
          <div className="workspace-badge-row">
            <button
              type="button"
              className="workspace-provider-label"
              disabled={!configQuery.data}
              onClick={handleConfigureProvider}
              aria-label={`${labels.configureProvider}: ${translatorProviderDetailLabel(
                configQuery.data?.translator.provider,
                configQuery.data?.translator.snaptext_cloud.endpoint,
              )}`}
            >
              <span>
                {translatorProviderDetailLabel(
                  configQuery.data?.translator.provider,
                  configQuery.data?.translator.snaptext_cloud.endpoint,
                )}
              </span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <LanguageCombobox
              ariaLabel={labels.targetLanguage}
              className="workspace-language-select"
              labels={labels}
              uiLanguage={configQuery.data?.ui.language}
              value={workspace.targetLang}
              onChange={workspace.setTargetLang}
            />
          </div>
          <div className="workspace-actions">
            {renderSpeechButtons(
              workspace.snapshot.result,
              workspace.snapshot.targetLang || workspace.targetLang,
              "translation",
              labels.playTranslation,
            )}
            <IconTooltipButton label={labels.copy} onClick={handleCopyResult}>
              <Copy size={16} />
            </IconTooltipButton>
            <IconTooltipButton
              disabled={pinMutation.isPending}
              label={workspace.pinned ? labels.unpin : labels.pin}
              onClick={handleTogglePin}
              variant={workspace.pinned ? "primary" : "secondary"}
            >
              <Pin size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div className="workspace-textarea-shell" aria-busy={workspace.translating}>
          <Textarea
            className={
              workspace.translating
                ? "workspace-textarea workspace-result-textarea workspace-textarea-busy bg-background text-[15px]"
                : "workspace-textarea workspace-result-textarea bg-background text-[15px]"
            }
            value={workspace.translating ? "" : workspace.snapshot.result}
            readOnly
            placeholder={workspace.translating ? labels.translating : labels.translationPlaceholder}
          />
          {workspace.translating ? (
            // Translation can follow OCR immediately, so the result box mirrors the same busy treatment.
            <div className="workspace-textarea-loading" aria-live="polite">
              <div className="workspace-loading-message">
                <LoaderCircle size={18} aria-hidden="true" />
                <span>{labels.translating}</span>
              </div>
              <div className="workspace-loading-bar" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </section>
    </section>
    {configQuery.data ? (
      <ProviderDialog
        config={configQuery.data}
        error={providerSaveError}
        labels={labels}
        open={providerDialogOpen}
        saving={updateConfigMutation.isPending}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) setProviderSaveError("");
        }}
        onSave={saveProviderConfig}
      />
    ) : null}
    </>
  );

  function setTextResult(record: HistoryRecord) {
    workspace.setResultFromHistory(record);
  }
}

function SpeechButton({
  active,
  accentLabel,
  ariaLabel,
  disabled,
  onClick,
  tooltipLabel,
}: {
  active: boolean;
  accentLabel?: string;
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  tooltipLabel?: string;
}) {
  return (
    <IconTooltipButton
      onClick={onClick}
      label={tooltipLabel ?? ariaLabel}
      variant={active ? "primary" : "secondary"}
      size={accentLabel ? "md" : "icon"}
      disabled={disabled}
    >
      <Volume2 size={16} />
      {accentLabel ? <span>{accentLabel}</span> : null}
    </IconTooltipButton>
  );
}

function IconTooltipButton({
  children,
  className,
  disabled,
  label,
  onClick,
  size = "icon",
  variant = "secondary",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const button = (
    <Button
      aria-label={label}
      className={className}
      disabled={disabled}
      onClick={onClick}
      size={size}
      variant={variant}
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

function isScreenshotSelectionCancelled(error: unknown) {
  return errorMessage(error).includes("screenshot selection produced no image; status=0");
}

function autoTranslateKey(sourceText: string, sourceLang: string, targetLang: string) {
  return `${sourceLang}\n${targetLang}\n${sourceText.trim()}`;
}

function visibleEnglishAccents(accents?: string[]): SpeechAccent[] {
  if (!accents) return ["american", "british"];
  return accents.filter((accent): accent is SpeechAccent => accent === "american" || accent === "british");
}
