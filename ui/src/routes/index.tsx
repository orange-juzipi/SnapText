import { useEffect, useState } from "react";
import type * as React from "react";
import { Copy, Languages, LoaderCircle, Pin, ScanText, Volume2 } from "lucide-react";
import { startScreenshotOverlay, unpinResultWindow } from "@/lib/api";
import { translatorProviderDetailLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { AUTO_TARGET_LANG, resolveSourceSpeechLang, resolveTargetLang } from "@/lib/language";
import { errorMessage } from "@/lib/errors";
import { isSpeechSupported, speakText, stopSpeech } from "@/lib/speech";
import {
  useConfigQuery,
  usePinResultMutation,
  useTranslateTextMutation,
} from "@/lib/queries";
import { copyText } from "@/lib/tauri";
import type { HistoryRecord } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SpeechAccent = "american" | "british";

export function WorkspacePage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();

  const translateTextMutation = useTranslateTextMutation();
  const pinMutation = usePinResultMutation();
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const speechReady =
    Boolean(configQuery.data) && isSpeechSupported(configQuery.data?.speech);

  useEffect(() => {
    if (speechReady || !activeSpeechKey) return;
    // 语音配置关闭后立即停止当前朗读，避免系统朗读继续播放。
    stopSpeech();
    setActiveSpeechKey(null);
  }, [activeSpeechKey, speechReady]);

  async function handleTranslateText() {
    if (!workspace.textInput.trim()) {
      workspace.showError(labels.textInputRequired);
      return;
    }
    const targetLang = resolveTargetLang(workspace.textInput, workspace.targetLang);
    try {
      workspace.setTranslating(true);
      const record = await translateTextMutation.mutateAsync({
        sourceText: workspace.textInput,
        targetLang,
      });
      setTextResult(record);
      workspace.setStatus(labels.textTranslated);
    } catch (error) {
      workspace.showError(errorMessage(error));
    } finally {
      workspace.setTranslating(false);
    }
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
    const disabled = !speechReady;
    const tooltipLabel = configQuery.data?.speech.enabled === false
      ? labels.speechEnableToPlay
      : !speechReady
        ? labels.speechUnsupported
        : label;
    if (lang === "en") {
      return (
        <>
          <SpeechButton
            active={activeSpeechKey === `${scope}:american`}
            accentLabel="美"
            ariaLabel={disabled ? tooltipLabel : `${label}：美式发音`}
            disabled={disabled}
            tooltipLabel={disabled ? tooltipLabel : undefined}
            onClick={() => handleSpeak(text, lang, `${scope}:american`, "american")}
          />
          <SpeechButton
            active={activeSpeechKey === `${scope}:british`}
            accentLabel="英"
            ariaLabel={disabled ? tooltipLabel : `${label}：英式发音`}
            disabled={disabled}
            tooltipLabel={disabled ? tooltipLabel : undefined}
            onClick={() => handleSpeak(text, lang, `${scope}:british`, "british")}
          />
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
    <section className="workspace-grid">
      <section className="workspace-panel">
        <div className="workspace-panel-toolbar">
          <div className="workspace-badge-row">
            <Badge variant="primary">Source</Badge>
            <IconTooltipButton
              disabled={pinMutation.isPending}
              label={workspace.pinned ? labels.unpin : labels.pin}
              onClick={handleTogglePin}
              variant={workspace.pinned ? "primary" : "secondary"}
            >
              <Pin size={16} />
            </IconTooltipButton>
          </div>
          <div className="workspace-actions">
            {renderSpeechButtons(
              workspace.textInput,
              resolveSourceSpeechLang(workspace.textInput),
              "source",
              labels.playSource,
            )}
            <IconTooltipButton label={labels.startOverlay} onClick={handleStartOverlay}>
              <ScanText size={16} />
            </IconTooltipButton>
            <IconTooltipButton label={labels.translateText} onClick={handleTranslateText} variant="primary">
              <Languages size={16} />
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

      <section className="workspace-panel">
        <div className="workspace-panel-toolbar">
          <div className="workspace-badge-row">
            <Badge variant="success">Translation</Badge>
            <span className="workspace-provider-label">
              {translatorProviderDetailLabel(
                configQuery.data?.translator.provider,
                configQuery.data?.translator.snaptext_cloud.endpoint,
              )}
            </span>
            <Select
              className="workspace-target-select"
              value={workspace.targetLang}
              onChange={(event) => workspace.setTargetLang(event.target.value)}
              aria-label={labels.targetLanguage}
            >
              <option value={AUTO_TARGET_LANG}>{labels.autoDetectLanguage}</option>
              <option value="en">English</option>
              <option value="zh_cn">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
              <option value="ru">Русский</option>
            </Select>
          </div>
          <div className="workspace-actions">
            {renderSpeechButtons(
              workspace.snapshot.result,
              workspace.snapshot.targetLang || workspace.targetLang,
              "translation",
              labels.playTranslation,
            )}
            <IconTooltipButton label={labels.copy} onClick={handleCopyResult} variant="primary">
              <Copy size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div className="workspace-textarea-shell" aria-busy={workspace.translating}>
          <Textarea
            className={
              workspace.translating
                ? "workspace-textarea workspace-textarea-busy bg-background text-[15px]"
                : "workspace-textarea bg-background text-[15px]"
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
      size={accentLabel ? "sm" : "icon"}
      disabled={disabled}
    >
      <Volume2 size={16} />
      {accentLabel ? <span>{accentLabel}</span> : null}
    </IconTooltipButton>
  );
}

function IconTooltipButton({
  children,
  disabled,
  label,
  onClick,
  size = "icon",
  variant = "secondary",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const button = (
    <Button
      aria-label={label}
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
