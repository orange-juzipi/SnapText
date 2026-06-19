import { ArrowRight, Copy, Languages, Pin, RefreshCw, ScanText, Square, Volume2 } from "lucide-react";
import { startScreenshotOverlay, unpinResultWindow } from "@/lib/api";
import { sourceLabel, translatorProviderDetailLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { AUTO_TARGET_LANG, resolveSourceSpeechLang, resolveTargetLang } from "@/lib/language";
import { errorMessage } from "@/lib/errors";
import { speakText, stopSpeech } from "@/lib/speech";
import {
  useConfigQuery,
  usePinResultMutation,
  useRetranslateMutation,
  useTranslateTextMutation,
} from "@/lib/queries";
import { copyText } from "@/lib/tauri";
import type { HistoryRecord } from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function WorkspacePage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();

  const translateTextMutation = useTranslateTextMutation();
  const retranslateMutation = useRetranslateMutation();
  const pinMutation = usePinResultMutation();

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

  async function handleRetranslate() {
    if (!workspace.lastRequest) {
      workspace.showError(labels.noSourceTextForRetranslation);
      return;
    }
    try {
      workspace.setTranslating(true);
      const record = await retranslateMutation.mutateAsync({
        ...workspace.lastRequest,
        target_lang: resolveTargetLang(workspace.lastRequest.source_text, workspace.targetLang),
      });
      workspace.setResultSnapshot(record);
      workspace.setStatus(labels.resultRetranslated);
    } catch (error) {
      workspace.showError(errorMessage(error));
    } finally {
      workspace.setTranslating(false);
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

  async function handleSpeak(text: string, lang: string) {
    if (!text.trim()) {
      workspace.showError(labels.noSpeechText);
      return;
    }
    try {
      await speakText({ text, lang, config: configQuery.data?.speech });
      workspace.setStatus(labels.speechStarted);
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
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
          <Badge variant="primary">Source</Badge>
          <div className="workspace-actions">
            <Button
              onClick={() => handleSpeak(workspace.textInput, resolveSourceSpeechLang(workspace.textInput))}
              variant="secondary"
              aria-label={labels.playSource}
            >
              <Volume2 size={16} />
              {labels.playSource}
            </Button>
            <Button onClick={stopSpeech} variant="secondary" aria-label={labels.stopSpeech}>
              <Square size={16} />
            </Button>
            <Button onClick={handleStartOverlay} variant="secondary">
              <ScanText size={16} />
              {labels.startOverlay}
            </Button>
            <Button onClick={handleTranslateText} variant="primary">
              <Languages size={16} />
              {labels.translateText}
              <ArrowRight size={15} />
            </Button>
          </div>
        </div>
        <Textarea
          className="workspace-textarea bg-control"
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
      </section>

      <section className="workspace-panel">
        <div className="workspace-panel-toolbar">
          <div className="workspace-badge-row">
            <Badge variant="success">Translation</Badge>
            <span className="workspace-source-label">
              {sourceLabel(workspace.snapshot.sourceKind, labels)} ·{" "}
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
            <Button
              onClick={() => handleSpeak(workspace.snapshot.result, workspace.snapshot.targetLang || workspace.targetLang)}
              variant="secondary"
              aria-label={labels.playTranslation}
            >
              <Volume2 size={16} />
              {labels.playTranslation}
            </Button>
            {workspace.lastRequest ? (
              <Button
                disabled={workspace.translating || retranslateMutation.isPending}
                onClick={handleRetranslate}
                variant="secondary"
              >
                <RefreshCw size={16} />
                {labels.retranslate}
              </Button>
            ) : null}
            <Button onClick={handleCopyResult} variant="primary">
              <Copy size={16} />
              {labels.copy}
            </Button>
            <Button disabled={pinMutation.isPending} onClick={handleTogglePin} variant="secondary">
              <Pin size={16} />
              {workspace.pinned ? labels.unpin : labels.pin}
            </Button>
          </div>
        </div>
        <Textarea
          className="workspace-textarea bg-background text-[15px]"
          value={workspace.translating ? "" : workspace.snapshot.result}
          readOnly
          placeholder={workspace.translating ? labels.translating : labels.translationPlaceholder}
        />
      </section>
    </section>
  );

  function setTextResult(record: HistoryRecord) {
    workspace.setResultFromHistory(record);
  }
}

function isScreenshotSelectionCancelled(error: unknown) {
  return errorMessage(error).includes("screenshot selection produced no image; status=0");
}
