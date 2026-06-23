import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { ArrowLeftRight, ChevronDown, Copy, LoaderCircle, Mic, Pin, ScanText, Volume2, X } from "lucide-react";
import { pinyin } from "pinyin-pro";
import {
  startScreenshotOverlay,
  startVoiceInput as startNativeVoiceInput,
  stopVoiceInput as stopNativeVoiceInput,
  unpinResultWindow,
  voiceInputSupported,
  events,
} from "@/lib/api";
import { translatorProviderDetailLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import {
  AUTO_SOURCE_LANG,
  DEFAULT_TARGET_LANG,
  detectSourceLang,
  languageDisplayName,
  looksLikeChinese,
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
import { copyText, tauriListen } from "@/lib/tauri";
import type { HistoryRecord, VoiceInputPartialPayload } from "@/lib/types";
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
const AUTO_TRANSLATE_DEBOUNCE_MS = 500;

export function WorkspacePage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();

  const translateTextMutation = useTranslateTextMutation();
  const updateConfigMutation = useUpdateConfigMutation();
  const pinMutation = usePinResultMutation();
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceInputStopping, setVoiceInputStopping] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
  const voiceInputActiveRef = useRef(false);
  const voiceInputBaseTextRef = useRef("");
  const voiceInputDraftRef = useRef("");
  const textInputRef = useRef(workspace.textInput);
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
  const hasSourceText = Boolean(workspace.textInput.trim());
  const hasTranslationText = Boolean(workspace.snapshot.result.trim());
  const sourceCharacterCount = useMemo(
    () => Array.from(workspace.textInput.replace(/\s/g, "")).length,
    [workspace.textInput],
  );
  const sourcePinyin = useMemo(() => {
    const sourceText = workspace.textInput.trim();
    if (!sourceText || !looksLikeChinese(sourceText)) return "";
    // Limit the helper line so a long OCR block cannot cover the textarea controls.
    const pinyinText = pinyin(sourceText, {
      nonZh: "removed",
      toneType: "symbol",
    }).replace(/\s+/g, " ").trim();
    return pinyinText.length > 180 ? `${pinyinText.slice(0, 180)}...` : pinyinText;
  }, [workspace.textInput]);
  const canSwapTranslation = Boolean(
    workspace.textInput.trim() &&
      workspace.snapshot.result.trim() &&
      !workspace.ocrLoading &&
      !workspace.translating &&
      !translateTextMutation.isPending,
  );

  useEffect(() => {
    textInputRef.current = workspace.textInput;
  }, [workspace.textInput]);

  useEffect(() => {
    let mounted = true;
    voiceInputSupported()
      .then((supported) => {
        if (mounted) setVoiceInputAvailable(supported);
      })
      .catch(() => {
        if (mounted) setVoiceInputAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    voiceInputActiveRef.current = voiceInputActive;
  }, [voiceInputActive]);

  useEffect(() => {
    return () => {
      if (voiceInputActiveRef.current) {
        void stopNativeVoiceInput().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tauriListen<VoiceInputPartialPayload>(events.voiceInputPartial, (event) => {
      if (!voiceInputActiveRef.current) return;
      applyVoiceInputPartial(event.payload.text);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
    const sourceLang = resolveSourceLang(sourceText, workspace.sourceLang) ?? AUTO_SOURCE_LANG;
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
    const sourceLang = resolveSourceLang(sourceText, workspace.sourceLang) ?? AUTO_SOURCE_LANG;
    const targetLang = normalizeTargetLang(workspace.snapshot.targetLang);
    lastAutoTranslatedKeyRef.current = autoTranslateKey(sourceText, sourceLang, targetLang);
  }, [
    workspace.snapshot.result,
    workspace.snapshot.sourceText,
    workspace.snapshot.targetLang,
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
      lastAutoTranslatedKeyRef.current = autoTranslateKey(sourceText, sourceLang, targetLang);
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
    const sourceLang = resolveSourceLang(sourceText, workspace.sourceLang) ?? AUTO_SOURCE_LANG;
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

  function handleClearSourceText() {
    stopSpeech();
    setActiveSpeechKey(null);
    void stopVoiceInput(false);
    workspace.clearTextPanels();
    workspace.setStatus(labels.sourceTextCleared);
  }

  function handleSwapTranslation() {
    const nextTextInput = workspace.snapshot.result.trim();
    if (!nextTextInput || !canSwapTranslation) return;
    const previousSourceText = workspace.snapshot.sourceText.trim() || workspace.textInput;
    const nextSourceLang = normalizeTargetLang(workspace.snapshot.targetLang || workspace.targetLang);
    const nextTargetLang = resolveSourceLang(previousSourceText, workspace.sourceLang) ?? DEFAULT_TARGET_LANG;
    const nextSourceRequestLang = resolveSourceLang(nextTextInput, nextSourceLang) ?? AUTO_SOURCE_LANG;
    stopSpeech();
    setActiveSpeechKey(null);
    void stopVoiceInput(false);
    autoTranslatePendingRef.current = null;
    lastAutoTranslatedKeyRef.current = autoTranslateKey(nextTextInput, nextSourceRequestLang, nextTargetLang);
    workspace.setSourceLang(nextSourceLang);
    workspace.setTargetLang(nextTargetLang);
    workspace.swapTextPanels({
      sourceText: nextTextInput,
      translatedText: previousSourceText,
      targetLang: nextTargetLang,
    });
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

  async function handleToggleVoiceInput() {
    if (voiceInputActive) {
      await stopVoiceInput(true);
      return;
    }
    if (!voiceInputAvailable) {
      workspace.showError(labels.voiceInputUnsupported);
      return;
    }

    stopSpeech();
    setActiveSpeechKey(null);
    voiceInputBaseTextRef.current = textInputRef.current;
    voiceInputDraftRef.current = "";

    try {
      await startNativeVoiceInput(nativeVoiceInputLocaleForLanguage(
        workspace.sourceLang,
        workspace.textInput,
        configQuery.data?.ui.language,
      ));
      setVoiceInputActive(true);
      workspace.setStatus(labels.voiceInputListening);
    } catch (error) {
      setVoiceInputActive(false);
      workspace.showError(errorMessage(error));
    }
  }

  async function stopVoiceInput(appendResult: boolean) {
    if (!voiceInputActiveRef.current) {
      setVoiceInputActive(false);
      return;
    }
    try {
      setVoiceInputStopping(true);
      if (appendResult) workspace.setStatus(labels.voiceInputRecognizing);
      const result = await stopNativeVoiceInput();
      if (appendResult && result.text.trim() && !voiceInputDraftRef.current.trim()) {
        applyVoiceInputPartial(result.text);
      }
      if (appendResult && textInputRef.current.trim()) {
        workspace.setStatus(labels.voiceInputCompleted);
      } else {
        workspace.setStatus(labels.ready);
      }
    } catch (error) {
      if (appendResult) workspace.showError(errorMessage(error));
    } finally {
      setVoiceInputActive(false);
      voiceInputActiveRef.current = false;
      voiceInputBaseTextRef.current = "";
      voiceInputDraftRef.current = "";
      setVoiceInputStopping(false);
    }
  }

  function applyVoiceInputPartial(transcript: string) {
    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript) return;
    voiceInputDraftRef.current = normalizedTranscript;
    const nextText = appendRecognizedText(voiceInputBaseTextRef.current, normalizedTranscript);
    textInputRef.current = nextText;
    workspace.setTextInput(nextText);
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
              accentLabel={labels.englishAccentAmericanShort}
              ariaLabel={disabled ? tooltipLabel : `${label}: ${labels.englishAccentAmerican}`}
              disabled={disabled}
              tooltipLabel={disabled ? tooltipLabel : undefined}
              onClick={() => handleSpeak(text, lang, `${scope}:american`, "american")}
            />
          ) : null}
          {englishAccents.includes("british") ? (
            <SpeechButton
              active={activeSpeechKey === `${scope}:british`}
              accentLabel={labels.englishAccentBritishShort}
              ariaLabel={disabled ? tooltipLabel : `${label}: ${labels.englishAccentBritish}`}
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
            <IconTooltipButton label={labels.startOverlay} onClick={handleStartOverlay}>
              <ScanText size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div className="workspace-textarea-shell" aria-busy={workspace.ocrLoading}>
          <Textarea
            className={
              workspace.ocrLoading
                ? "workspace-textarea workspace-source-textarea workspace-textarea-busy bg-control"
                : "workspace-textarea workspace-source-textarea bg-control"
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
          {!workspace.ocrLoading ? (
            <div className="workspace-textarea-controls">
              <div className="workspace-textarea-controls-left">
                {voiceInputAvailable ? (
                  <IconTooltipButton
                    className={voiceInputActive ? "workspace-voice-input-active" : undefined}
                    disabled={workspace.translating || voiceInputStopping}
                    label={voiceInputActive ? labels.stopVoiceInput : labels.startVoiceInput}
                    onClick={handleToggleVoiceInput}
                    variant={voiceInputActive ? "primary" : "secondary"}
                  >
                    <Mic size={16} />
                  </IconTooltipButton>
                ) : null}
                {renderSpeechButtons(
                  workspace.textInput,
                  sourceSpeechLang,
                  "source",
                  labels.playSource,
                )}
              </div>
            </div>
          ) : null}
          {!workspace.ocrLoading && sourcePinyin ? (
            <div className="workspace-source-pinyin" aria-label={labels.sourcePinyin}>
              {sourcePinyin}
            </div>
          ) : null}
          {!workspace.ocrLoading && hasSourceText ? (
            <div className="workspace-source-count" aria-label={labels.sourceCharacterCount}>
              {sourceCharacterCount}
            </div>
          ) : null}
          {!workspace.ocrLoading && hasSourceText ? (
            <div className="workspace-source-clear-control">
              <IconTooltipButton
                className="workspace-textarea-control-button"
                disabled={workspace.translating}
                label={labels.clearSourceText}
                onClick={handleClearSourceText}
              >
                <X size={16} />
              </IconTooltipButton>
            </div>
          ) : null}
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
                labels,
              )}`}
            >
              <span>
                {translatorProviderDetailLabel(
                  configQuery.data?.translator.provider,
                  configQuery.data?.translator.snaptext_cloud.endpoint,
                  labels,
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
          {!workspace.translating ? (
            <div className="workspace-textarea-controls">
              <div className="workspace-textarea-controls-left">
                {renderSpeechButtons(
                  workspace.snapshot.result,
                  workspace.snapshot.targetLang || workspace.targetLang,
                  "translation",
                  labels.playTranslation,
                )}
              </div>
            </div>
          ) : null}
          {!workspace.translating && hasTranslationText ? (
            <div className="workspace-result-copy-control">
              <IconTooltipButton
                className="workspace-textarea-control-button"
                label={labels.copy}
                onClick={handleCopyResult}
              >
                <Copy size={16} />
              </IconTooltipButton>
            </div>
          ) : null}
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
      className={active ? "workspace-speech-button-active" : undefined}
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

function appendRecognizedText(currentText: string, transcript: string) {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) return currentText;
  const normalizedCurrent = currentText.trimEnd();
  if (!normalizedCurrent) return normalizedTranscript;
  // Keep voice dictation append-only so it does not overwrite typed or OCR source text.
  return `${normalizedCurrent}${sourceTextJoiner(normalizedCurrent, normalizedTranscript)}${normalizedTranscript}`;
}

function sourceTextJoiner(currentText: string, transcript: string) {
  const currentLast = Array.from(currentText).at(-1) ?? "";
  const transcriptFirst = Array.from(transcript).at(0) ?? "";
  if (isCjkCharacter(currentLast) && isCjkCharacter(transcriptFirst)) return "";
  if (/[\s([{（《「『]$/u.test(currentLast) || /^[,，.。!?！？;；:：)\]}）〉」』]/u.test(transcriptFirst)) return "";
  return " ";
}

function isCjkCharacter(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function nativeVoiceInputLocaleForLanguage(sourceLang: string, sourceText: string, uiLanguage?: string) {
  const resolvedLang = resolveSourceLang(sourceText, sourceLang) ?? sourceLang;
  switch (resolvedLang) {
    case "zh_cn":
      return "zh-CN";
    case "zh_tw":
      return "zh-TW";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "en":
      return "en-US";
    case "fr":
      return "fr-FR";
    case "de":
      return "de-DE";
    case "es":
      return "es-ES";
    case "it":
      return "it-IT";
    case "pt":
      return "pt-PT";
    case "ru":
      return "ru-RU";
    default:
      return uiLanguage === "en" ? "en-US" : "zh-CN";
  }
}
