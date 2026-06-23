import type * as React from "react";
import { Copy, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { events, getConfig, unpinResultWindow } from "@/lib/api";
import { sourceLabel, targetLangLabel } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { resolveSourceSpeechLang } from "@/lib/language";
import { isSpeechSupported, speakText, stopSpeech } from "@/lib/speech";
import { copyText, tauriListen } from "@/lib/tauri";
import type { AppConfig, HistoryRecord, PinnedResultPayload, TranslationResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SpeechAccent = "american" | "british";

export function ResultWindowApp() {
  const labels = labelsForLanguage("zh_cn");
  const [sourceKind, setSourceKind] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [result, setResult] = useState("");
  const [targetLang, setTargetLang] = useState("");
  const [status, setStatus] = useState(labels.pinnedResultWindow);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const speechReady = Boolean(config) && isSpeechSupported(config?.speech);

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

  useEffect(() => {
    if (speechReady || !activeSpeechKey) return;
    // 固钉窗口可能独立存在，配置关闭后也要停止已开始的朗读。
    stopSpeech();
    setActiveSpeechKey(null);
  }, [activeSpeechKey, speechReady]);

  function applySnapshot(snapshot: PinnedResultPayload) {
    setSourceKind(snapshot.source);
    setSourceText(snapshot.source_text);
    setResult(snapshot.translated_text);
    setTargetLang(snapshot.target_lang);
  }

  function applyTranslation(output: TranslationResult) {
    setSourceKind(output.source);
    setSourceText(output.source_text);
    setResult(output.translated_text);
    setTargetLang(output.target_lang);
  }

  function applyHistory(record: HistoryRecord) {
    setSourceKind(record.source);
    setSourceText(record.source_text);
    setResult(record.translated_text);
    setTargetLang(record.target_lang);
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

  async function handleSpeak(text: string, lang: string, key: string, accent?: SpeechAccent) {
    if (!text.trim()) {
      setStatus(labels.noSpeechText);
      return;
    }
    if (!speechReady) {
      setStatus(config?.speech.enabled === false ? labels.speechDisabled : labels.speechUnsupported);
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
        config: config?.speech,
        englishAccent: accent,
        onEnd: () => setActiveSpeechKey((current) => (current === key ? null : current)),
        onError: () => setActiveSpeechKey((current) => (current === key ? null : current)),
      });
      setStatus(labels.speechStarted);
    } catch (error) {
      setActiveSpeechKey((current) => (current === key ? null : current));
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function renderSpeechButtons(text: string, lang: string, scope: "source" | "translation", label: string) {
    if (!speechReady || !text.trim()) return null;
    const disabled = !speechReady || !text.trim();
    const tooltipLabel = !text.trim()
      ? labels.noSpeechText
      : config?.speech.enabled === false
        ? labels.speechEnableToPlay
        : !speechReady
          ? labels.speechUnsupported
          : label;
    if (lang === "en") {
      const englishAccents = visibleEnglishAccents(config?.speech.english_accents);
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
            {renderSpeechButtons(sourceText, resolveSourceSpeechLang(sourceText), "source", labels.playSource)}
            {renderSpeechButtons(result, targetLang, "translation", labels.playTranslation)}
            <IconTooltipButton label={labels.copy} onClick={handleCopy} variant="primary">
              <Copy size={15} />
            </IconTooltipButton>
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
      size={accentLabel ? "sm" : "icon"}
      disabled={disabled}
    >
      <Volume2 size={15} />
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

function visibleEnglishAccents(accents?: string[]): SpeechAccent[] {
  if (!accents) return ["american", "british"];
  return accents.filter((accent): accent is SpeechAccent => accent === "american" || accent === "british");
}
