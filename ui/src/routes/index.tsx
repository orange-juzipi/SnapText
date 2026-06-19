import { Copy, Pin, RefreshCw, X } from "lucide-react";
import { startScreenshotOverlay, unpinResultWindow } from "@/lib/api";
import { labelsForLanguage } from "@/lib/labels";
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
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
    const targetLang = normalizedTargetLang(workspace.targetLang);
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
        target_lang: normalizedTargetLang(workspace.targetLang),
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
    if (!workspace.snapshot.result.trim() || !workspace.snapshot.sourceText.trim()) {
      workspace.showError(labels.noResultToPin);
      return;
    }
    try {
      await pinMutation.mutateAsync({
        source: workspace.snapshot.sourceKind,
        source_text: workspace.snapshot.sourceText,
        translated_text: workspace.snapshot.result,
        target_lang: workspace.snapshot.targetLang,
      });
      workspace.setPinned(true);
      workspace.setStatus(labels.resultPinned);
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
  }

  return (
    <section className="grid gap-4">
      <Card className="workspace-card">
        <CardContent className="workspace-content">
          <section className="rounded-lg border border-border bg-secondary/45 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Badge variant="primary">TEXT</Badge>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleTranslateText} variant="primary">
                  {labels.translateText}
                </Button>
                <Button onClick={handleStartOverlay}>{labels.startOverlay}</Button>
              </div>
            </div>
            <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem] md:items-end">
              <Field>
                <FieldLabel>{labels.sourceText}</FieldLabel>
                <Input value={labels.autoDetectLanguage} readOnly />
              </Field>
              <Field>
                <FieldLabel>{labels.targetLanguage}</FieldLabel>
                <Select
                  value={workspace.targetLang}
                  onChange={(event) => workspace.setTargetLang(event.target.value)}
                >
                  <option value="en">English</option>
                  <option value="zh_cn">中文</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="es">Español</option>
                  <option value="ru">Русский</option>
                </Select>
              </Field>
            </div>
            <Textarea
              className="h-24 min-h-0 bg-card"
              value={workspace.ocrLoading ? "" : workspace.textInput}
              onChange={(event) => workspace.setTextInput(event.target.value)}
              placeholder={workspace.ocrLoading ? labels.ocrSelectedRegion : labels.textInputPlaceholder}
              disabled={workspace.ocrLoading}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <Badge variant="success">RESULT</Badge>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCopyResult} variant="primary">
                  <Copy size={16} />
                  {labels.copy}
                </Button>
                <Button onClick={handleTogglePin}>
                  <Pin size={16} />
                  {workspace.pinned ? labels.unpin : labels.pin}
                </Button>
                <Button onClick={workspace.clearResult} variant="ghost">
                  <X size={16} />
                  {labels.close}
                </Button>
              </div>
            </div>
            <Textarea
              className="h-24 min-h-0 bg-background text-[15px]"
              value={workspace.translating ? "" : workspace.snapshot.result}
              readOnly
              placeholder={workspace.translating ? labels.translating : labels.translationPlaceholder}
            />
            {workspace.lastRequest ? (
              <Button
                className="mt-3"
                disabled={workspace.translating || retranslateMutation.isPending}
                onClick={handleRetranslate}
                variant="secondary"
              >
                <RefreshCw size={16} />
                {labels.retranslate}
              </Button>
            ) : null}
          </section>
        </CardContent>
      </Card>
    </section>
  );

  function setTextResult(record: HistoryRecord) {
    workspace.setResultFromHistory(record);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizedTargetLang(value: string) {
  return value.trim() || "en";
}
