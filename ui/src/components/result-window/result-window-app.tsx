import { Copy, RefreshCw, Square, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { events, getConfig, retranslateResultText, unpinResultWindow } from "@/lib/api";
import { sourceLabel, targetLangLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { resolveSourceSpeechLang } from "@/lib/language";
import { speakText, stopSpeech } from "@/lib/speech";
import { copyText, tauriListen } from "@/lib/tauri";
import type { AppConfig, HistoryRecord, PinnedResultPayload, TranslationRequest, TranslationResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ResultWindowApp() {
  const labels = labelsForLanguage("zh_cn");
  const [sourceKind, setSourceKind] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [result, setResult] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [lastRequest, setLastRequest] = useState<TranslationRequest | null>(null);
  const [status, setStatus] = useState(labels.pinnedResultWindow);
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    tauriListen<PinnedResultPayload>(events.resultSnapshot, (event) => {
      applySnapshot(event.payload);
      setStatus(labels.pinnedResultWindow);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen<TranslationResult>(events.resultTranslation, (event) => {
      applyTranslation(event.payload);
      setStatus(labels.regionTranslated);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen<HistoryRecord>(events.resultSelection, (event) => {
      applyHistory(event.payload);
      setStatus(labels.textTranslated);
    }).then((unlisten) => unlisteners.push(unlisten));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  function applySnapshot(snapshot: PinnedResultPayload) {
    setSourceKind(snapshot.source);
    setSourceText(snapshot.source_text);
    setResult(snapshot.translated_text);
    setTargetLang(snapshot.target_lang);
    setLastRequest({ source: snapshot.source, source_text: snapshot.source_text });
  }

  function applyTranslation(output: TranslationResult) {
    setSourceKind(output.source);
    setSourceText(output.source_text);
    setResult(output.translated_text);
    setTargetLang(output.target_lang);
    setLastRequest({ source: output.source, source_text: output.source_text });
  }

  function applyHistory(record: HistoryRecord) {
    setSourceKind(record.source);
    setSourceText(record.source_text);
    setResult(record.translated_text);
    setTargetLang(record.target_lang);
    setLastRequest({ source: record.source, source_text: record.source_text });
  }

  async function handleCopy() {
    if (!result.trim()) {
      setStatus(labels.noResultToCopy);
      return;
    }
    try {
      await copyText(result);
      setStatus(labels.resultCopied);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSpeak(text: string, lang: string) {
    if (!text.trim()) {
      setStatus(labels.noSpeechText);
      return;
    }
    try {
      await speakText({ text, lang, config: config?.speech });
      setStatus(labels.speechStarted);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRetranslate() {
    if (!lastRequest) {
      setStatus(labels.noSourceTextForRetranslation);
      return;
    }
    try {
      const record = await retranslateResultText(lastRequest);
      applyHistory(record);
      setStatus(labels.resultRetranslated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClose() {
    try {
      await unpinResultWindow();
      setStatus(labels.pinnedWindowHidden);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="min-h-screen p-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{labels.pinnedResult}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => handleSpeak(sourceText, resolveSourceSpeechLang(sourceText))}>
              <Volume2 size={15} />
              {labels.playSource}
            </Button>
            <Button size="sm" onClick={() => handleSpeak(result, targetLang)}>
              <Volume2 size={15} />
              {labels.playTranslation}
            </Button>
            <Button size="sm" onClick={stopSpeech} aria-label={labels.stopSpeech}>
              <Square size={15} />
            </Button>
            <Button size="sm" onClick={handleRetranslate}>
              <RefreshCw size={15} />
              {labels.retranslate}
            </Button>
            <Button size="sm" onClick={handleCopy} variant="primary">
              <Copy size={15} />
              {labels.copy}
            </Button>
            <Button size="sm" onClick={handleClose}>
              <X size={15} />
              {labels.close}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>{labels.sourceType}</FieldLabel>
              <Input value={sourceLabel(sourceKind, labels)} readOnly />
            </Field>
            <Field>
              <FieldLabel>{labels.targetLanguage}</FieldLabel>
              <Input value={targetLangLabel(targetLang, labels)} readOnly />
            </Field>
          </div>
          <Field>
            <FieldLabel>{labels.sourceText}</FieldLabel>
            <Textarea value={sourceText} readOnly />
          </Field>
          <Field>
            <FieldLabel>{labels.translationText}</FieldLabel>
            <Textarea className="min-h-32" value={result} readOnly />
          </Field>
        </CardContent>
      </Card>
    </main>
  );
}
