import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  Crosshair,
  ImagePlus,
  Languages,
  LoaderCircle,
  Maximize2,
  Mic,
  MoreHorizontal,
  Pin,
  RefreshCw,
  ScanText,
  Volume2,
  X,
} from "lucide-react";
import { pinyin } from "pinyin-pro";
import {
  startScreenshotOverlay,
  ocrImageRegion,
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
  resolveTargetLang,
} from "@/lib/language";
import { errorMessage } from "@/lib/errors";
import { isSpeechSupported, speakAudioUrl, speakText, stopSpeech } from "@/lib/speech";
import {
  useConfigQuery,
  usePinResultMutation,
  useTranslateImageMutation,
  useTranslateTextMutation,
  useUpdateConfigMutation,
} from "@/lib/queries";
import { copyText, tauriListen } from "@/lib/tauri";
import type {
  HistoryRecord,
  ImagePreprocessOptions,
  Region,
  TextLine,
  VoiceInputPartialPayload,
} from "@/lib/types";
import { useWorkspaceState } from "@/app/workspace-state";
import {
  mergeProviderConfig,
  ProviderDialog,
  sanitizeProviderConfig,
} from "@/components/provider-settings";
import { DictionaryPanel } from "@/components/dictionary-panel";
import { LanguageCombobox } from "@/components/language-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SpeechAccent = "american" | "british";
/** Holds a validated image payload and its intrinsic dimensions for OCR. */
type ImageInput = {
  /** Data URL accepted by the Tauri image commands and used for the preview. */
  dataUrl: string;
  /** Natural image width in pixels, used as the full-image OCR region. */
  width: number;
  /** Natural image height in pixels, used as the full-image OCR region. */
  height: number;
  /** Original file name shown beside the preview. */
  name: string;
};

/** Stores the temporary selection drawn over an imported image preview. */
type ImageCropSelection = {
  /** Left edge in preview CSS pixels. */
  x: number;
  /** Top edge in preview CSS pixels. */
  y: number;
  /** Selection width in preview CSS pixels. */
  width: number;
  /** Selection height in preview CSS pixels. */
  height: number;
};

/** Stores the pointer origin while the user drags an image crop. */
type ImageCropDrag = {
  /** Pointer x coordinate relative to the preview surface. */
  startX: number;
  /** Pointer y coordinate relative to the preview surface. */
  startY: number;
};

const DEFAULT_IMAGE_PREPROCESS: ImagePreprocessOptions = {
  scale: 1,
  grayscale: false,
  contrast: 1,
  sharpen: false,
  rotation: 0,
};
// Keep the existing conservative threshold while bounding the review surface so every
// suspicious line remains available without pushing the source text out of view.
const LOW_CONFIDENCE_THRESHOLD = 0.85;
const AUTO_TRANSLATE_DEBOUNCE_MS = 500;

export function WorkspacePage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();

  const translateTextMutation = useTranslateTextMutation();
  const translateImageMutation = useTranslateImageMutation();
  const updateConfigMutation = useUpdateConfigMutation();
  const pinMutation = usePinResultMutation();
  const [activeSpeechKey, setActiveSpeechKey] = useState<string | null>(null);
  const [voiceInputActive, setVoiceInputActive] = useState(false);
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceInputStopping, setVoiceInputStopping] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerSaveError, setProviderSaveError] = useState("");
  const [imageInput, setImageInput] = useState<ImageInput | null>(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageCrop, setImageCrop] = useState<Region | null>(null);
  const [imageCropSelection, setImageCropSelection] = useState<ImageCropSelection | null>(null);
  const [imageCropDrag, setImageCropDrag] = useState<ImageCropDrag | null>(null);
  const [imagePreprocess, setImagePreprocess] = useState<ImagePreprocessOptions>(DEFAULT_IMAGE_PREPROCESS);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [ocrReviewOpen, setOcrReviewOpen] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [failedTranslation, setFailedTranslation] = useState<{
    /** Source text used by the failed request. */
    sourceText: string;
    /** Resolved source language used by the failed request. */
    sourceLang: string;
    /** Resolved target language used by the failed request. */
    targetLang: string;
  } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageCropSelectionBeforeDragRef = useRef<ImageCropSelection | null>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceInputActiveRef = useRef(false);
  const voiceInputBaseTextRef = useRef("");
  const voiceInputDraftRef = useRef("");
  const textInputRef = useRef(workspace.textInput);
  const autoTranslatingRef = useRef(false);
  const skipNextAutoTranslateRef = useRef(false);
  const autoTranslatePendingRef = useRef<{ sourceText: string; sourceLang: string; targetLang: string } | null>(null);
  const lastAutoTranslatedKeyRef = useRef("");
  const translationRunIdRef = useRef(0);
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
    return pinyin(sourceText, {
      nonZh: "removed",
      toneType: "symbol",
    }).replace(/\s+/g, " ").trim();
  }, [workspace.textInput]);
  const lowConfidenceLines = useMemo(
    () => workspace.snapshot.textLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) =>
        line.text.trim().length > 0 &&
        Number.isFinite(line.confidence) &&
        line.confidence < LOW_CONFIDENCE_THRESHOLD,
      ),
    [workspace.snapshot.textLines],
  );
  const isOcrTextEdited = Boolean(
    workspace.snapshot.textLines.length > 0 && workspace.snapshot.sourceText !== workspace.textInput,
  );
  const canSwapTranslation = Boolean(
    workspace.textInput.trim() &&
      workspace.snapshot.result.trim() &&
      !workspace.ocrLoading &&
      !workspace.translating &&
      !translateTextMutation.isPending,
  );
  const autoTranslateEnabled = configQuery.data?.ui.auto_translate ?? true;
  const canPinResult = workspace.pinned || hasTranslationText;

  useEffect(() => {
    textInputRef.current = workspace.textInput;
  }, [workspace.textInput]);

  useEffect(() => {
    // A new OCR result starts with the review panel closed so it never obscures the fresh source text.
    setOcrReviewOpen(false);
  }, [workspace.snapshot.sourceText, workspace.snapshot.textLines.length]);

  useEffect(() => {
    if (!failedTranslation || failedTranslation.sourceText === workspace.textInput.trim()) return;
    // A new source invalidates the old retry action and its error message.
    setFailedTranslation(null);
    setTranslationError("");
  }, [failedTranslation, workspace.textInput]);

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
    if (workspace.ocrLoading) {
      return;
    }
    if (workspace.snapshot.requiresReview) {
      // OCR-only flows deliberately wait for a user edit or an explicit translate action.
      return;
    }
    if (skipNextAutoTranslateRef.current) {
      // OCR-only mode intentionally leaves the recognized text for manual review.
      skipNextAutoTranslateRef.current = false;
      return;
    }
    if (!autoTranslateEnabled) {
      if (!autoTranslateEnabled && workspace.snapshot.sourceText.trim() !== workspace.textInput.trim()) {
        workspace.clearTranslation();
      }
      return;
    }
    const sourceText = workspace.textInput.trim();
    if (!sourceText) {
      autoTranslatePendingRef.current = null;
      lastAutoTranslatedKeyRef.current = "";
      workspace.clearTranslation();
      return;
    }
    const sourceLang = resolveSourceLang(sourceText, workspace.sourceLang) ?? AUTO_SOURCE_LANG;
    const targetLang = resolveTargetLang(sourceText, workspace.targetLang);
    const requestKey = autoTranslateKey(sourceText, sourceLang, targetLang);
    if (requestKey === lastAutoTranslatedKeyRef.current) return;

    const timeout = window.setTimeout(() => {
      void runAutoTranslate(sourceText, sourceLang, targetLang);
    }, AUTO_TRANSLATE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [autoTranslateEnabled, workspace.ocrLoading, workspace.sourceLang, workspace.targetLang, workspace.textInput]);

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
    const targetLang = resolveTargetLang(sourceText, workspace.snapshot.targetLang);
    lastAutoTranslatedKeyRef.current = autoTranslateKey(sourceText, sourceLang, targetLang);
  }, [
    workspace.snapshot.result,
    workspace.snapshot.sourceText,
    workspace.snapshot.targetLang,
    workspace.textInput,
  ]);

  async function runTranslateText(sourceText: string, sourceLang: string, targetLang: string, mode: "manual" | "auto") {
    const runId = translationRunIdRef.current + 1;
    translationRunIdRef.current = runId;
    setTranslationError("");
    setFailedTranslation(null);
    try {
      workspace.setTranslating(true);
      const record = await translateTextMutation.mutateAsync({
        sourceText,
        sourceLang,
        targetLang,
      });
      if (runId !== translationRunIdRef.current) return;
      if (mode === "auto" && textInputRef.current.trim() !== sourceText) {
        return;
      }
      lastAutoTranslatedKeyRef.current = autoTranslateKey(sourceText, sourceLang, targetLang);
      if (mode === "auto") {
        workspace.setTranslationResultOnly(record);
      } else {
        setTextResult(record);
      }
      workspace.setStatus(labels.textTranslated);
    } catch (error) {
      if (runId !== translationRunIdRef.current) return;
      const message = errorMessage(error);
      setTranslationError(message);
      setFailedTranslation({ sourceText, sourceLang, targetLang });
      if (mode === "manual") {
        workspace.showError(message);
      } else {
        workspace.setStatus(message);
      }
    } finally {
      if (runId === translationRunIdRef.current) workspace.setTranslating(false);
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
    const targetLang = resolveTargetLang(sourceText, workspace.targetLang);
    autoTranslatePendingRef.current = null;
    await runTranslateText(sourceText, sourceLang, targetLang, "manual");
  }

  /** Cancels the visible translation request and invalidates its eventual response. */
  function handleCancelTranslation() {
    if (!workspace.translating) return;
    translationRunIdRef.current += 1;
    autoTranslatePendingRef.current = null;
    workspace.setTranslating(false);
    setTranslationError("");
    setFailedTranslation(null);
    workspace.setStatus(labels.translationCancelled);
  }

  /** Retries the last failed translation with the same resolved language pair. */
  function handleRetryTranslation() {
    if (!failedTranslation || translateTextMutation.isPending) return;
    void runTranslateText(
      failedTranslation.sourceText,
      failedTranslation.sourceLang,
      failedTranslation.targetLang,
      "manual",
    );
  }

  /** Reads an image file, validates its MIME type, and stores a preview payload. */
  async function loadImageFile(file: File, translateAfterLoad = false) {
    if (!file.type || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      workspace.showError(labels.unsupportedImageType);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      workspace.showError(labels.imageTooLarge);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(dataUrl);
      const nextImageInput: ImageInput = {
        dataUrl,
        width: dimensions.width,
        height: dimensions.height,
        name: file.name || labels.imageFileName,
      };
      setImageInput(nextImageInput);
      setImageCrop(null);
      setImageCropSelection(null);
      setImageViewerOpen(false);
      setImageSettingsOpen(false);
      imageCropSelectionBeforeDragRef.current = null;
      workspace.setStatus(labels.imageLoaded);
      if (translateAfterLoad) {
        // The newly loaded image has no crop yet; pass the explicit override before React commits state.
        void handleImageProcess(true, nextImageInput, null);
      }
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
  }

  /** Handles files selected through the hidden file picker. */
  function handleImageFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void loadImageFile(file);
    event.target.value = "";
  }

  /** Accepts an image dropped onto the source panel. */
  function handleImageDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.startsWith("image/"));
    if (file) void loadImageFile(file);
    else if (event.dataTransfer.files.length) workspace.showError(labels.unsupportedImageType);
  }

  /** Accepts an image pasted from the system clipboard without swallowing text paste. */
  function handleImagePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((candidate) => candidate.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    void loadImageFile(file, true);
  }

  /** Starts a bounded crop gesture on the imported image preview. */
  function handleImageCropPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageInput || imageProcessing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = imagePreviewPoint(event);
    imageCropSelectionBeforeDragRef.current = imageCropSelection;
    setImageCropDrag({ startX: point.x, startY: point.y });
    setImageCropSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  /** Updates the visible crop rectangle while the pointer is held down. */
  function handleImageCropPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageInput || !imageCropDrag) return;
    const point = imagePreviewPoint(event);
    setImageCropSelection(
      imageSelectionFromPoints(imageCropDrag.startX, imageCropDrag.startY, point.x, point.y),
    );
  }

  /** Commits the preview rectangle as source-image pixels for the OCR command. */
  function handleImageCropPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageInput || !imageCropDrag) return;
    const point = imagePreviewPoint(event);
    const selection = imageSelectionFromPoints(imageCropDrag.startX, imageCropDrag.startY, point.x, point.y);
    setImageCropDrag(null);
    setImageCropSelection(selection);
    const region = imageSelectionToRegion(selection, imageInput.width, imageInput.height, event.currentTarget);
    if (!region) {
      setImageCropSelection(imageCropSelectionBeforeDragRef.current);
      imageCropSelectionBeforeDragRef.current = null;
      if (selection.width >= 1 || selection.height >= 1) {
        workspace.setStatus(labels.selectedRegionTooSmall);
      }
      return;
    }
    setImageCrop(region);
    imageCropSelectionBeforeDragRef.current = null;
    workspace.setStatus(labels.imageCropReady);
  }

  /** Restores the last committed crop when a pointer gesture is cancelled. */
  function handleImageCropPointerCancel() {
    setImageCropDrag(null);
    setImageCropSelection(imageCropSelectionBeforeDragRef.current);
    imageCropSelectionBeforeDragRef.current = null;
  }

  /** Clears a previously selected image crop without removing the image input. */
  function handleClearImageCrop() {
    setImageCrop(null);
    setImageCropSelection(null);
    imageCropSelectionBeforeDragRef.current = null;
    workspace.setStatus(labels.imageCropCleared);
  }

  /** Runs local OCR on the selected image or sends it through the full image pipeline. */
  async function handleImageProcess(
    translateAfterOcr: boolean,
    inputOverride?: ImageInput,
    cropOverride?: Region | null,
  ) {
    const input = inputOverride ?? imageInput;
    if (!input || imageProcessing) return;
    setImageProcessing(true);
    workspace.setOcrLoading(true);
    workspace.setStatus(labels.imageProcessing);
    const crop = cropOverride === undefined ? imageCrop : cropOverride;
    const bbox = crop ?? {
      x: 0,
      y: 0,
      width: input.width,
      height: input.height,
    };
    try {
      if (translateAfterOcr) {
        const result = await translateImageMutation.mutateAsync({
          base64Png: input.dataUrl,
          bbox,
          preprocessOptions: imagePreprocess,
        });
        workspace.setResultFromTranslation(result);
        workspace.setStatus(labels.imageTranslated);
        setImageSettingsOpen(false);
      } else {
        skipNextAutoTranslateRef.current = true;
        const result = await ocrImageRegion(input.dataUrl, bbox, imagePreprocess);
        workspace.setOcrTextInput(result.source_text, "image", result.text_lines, true);
        workspace.setStatus(labels.imageOcrReady);
        setImageSettingsOpen(false);
      }
    } catch (error) {
      skipNextAutoTranslateRef.current = false;
      workspace.showError(errorMessage(error));
    } finally {
      workspace.setOcrLoading(false);
      setImageProcessing(false);
    }
  }

  /** Clears the selected image while retaining any text the user has already edited. */
  function handleRemoveImage() {
    setImageInput(null);
    setImageCrop(null);
    setImageCropSelection(null);
    setImageViewerOpen(false);
    setImageSettingsOpen(false);
    imageCropSelectionBeforeDragRef.current = null;
    workspace.setStatus(labels.ready);
  }

  /** Selects one low-confidence OCR line in the editable source textarea. */
  function handleLocateOcrLine(lineIndex: number) {
    const line = workspace.snapshot.textLines[lineIndex];
    if (!line || !sourceTextareaRef.current) return;
    if (isOcrTextEdited) {
      workspace.setStatus(labels.ocrTextEdited);
      return;
    }
    const range = ocrLineSelectionRange(workspace.textInput, workspace.snapshot.textLines, lineIndex);
    if (!range) return;
    setOcrReviewOpen(false);
    sourceTextareaRef.current.focus();
    sourceTextareaRef.current.setSelectionRange(range.start, range.end);
    workspace.setStatus(`${labels.ocrLineLocated}: ${line.text}`);
  }

  /** Keeps review metadata visible while marking the OCR aggregate as edited. */
  function handleSourceTextChange(value: string) {
    const wasAwaitingReview = workspace.snapshot.requiresReview;
    const previousValue = workspace.textInput;
    workspace.setTextInput(value);
    if (wasAwaitingReview && value !== previousValue) {
      workspace.setStatus(labels.ocrTextEdited);
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

  async function handleSpeak(
    text: string,
    lang: string,
    key: string,
    accent?: SpeechAccent,
    audioUrl?: string | null,
  ) {
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
      const speechInput = {
        text,
        lang,
        config: configQuery.data?.speech,
        englishAccent: accent,
        onEnd: () => setActiveSpeechKey((current) => (current === key ? null : current)),
        onError: () => setActiveSpeechKey((current) => (current === key ? null : current)),
      };
      try {
        // 词典 API 有真实发音时优先播放音频，失败后回退到系统 TTS。
        if (audioUrl) {
          await speakAudioUrl(audioUrl, speechInput.onEnd, speechInput.onError);
        } else {
          await speakText(speechInput);
        }
      } catch (audioError) {
        if (!audioUrl) throw audioError;
        await speakText(speechInput);
      }
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
    if (!hasTranslationText) {
      workspace.showError(labels.noResultToPin);
      return;
    }
    try {
      await pinMutation.mutateAsync({
        source: workspace.snapshot.sourceKind,
        source_text: workspace.snapshot.sourceText || workspace.textInput,
        translated_text: workspace.snapshot.result,
        target_lang: workspace.snapshot.targetLang || workspace.targetLang,
        dictionary_entries: workspace.snapshot.dictionaryEntries,
      });
      workspace.setPinned(true);
      workspace.setStatus(labels.resultPinned);
    } catch (error) {
      workspace.showError(errorMessage(error));
    }
  }

  return (
    <>
    <section className="workspace-page workspace-grid">
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
            <input
              ref={imageFileInputRef}
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              type="file"
              onChange={handleImageFileChange}
            />
            <IconTooltipButton
              disabled={imageProcessing}
              label={labels.selectImage}
              onClick={() => imageFileInputRef.current?.click()}
            >
              <ImagePlus size={16} />
            </IconTooltipButton>
            <IconTooltipButton label={labels.startOverlay} onClick={handleStartOverlay}>
              <ScanText size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div
          className={[
            "workspace-source-body",
            imageInput ? "has-image-input" : "",
            workspace.snapshot.textLines.length > 0 && !workspace.ocrLoading ? "has-ocr-summary" : "",
          ].filter(Boolean).join(" ")}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleImageDrop}
        >
          {imageInput ? (
            <div className="workspace-image-panel" aria-busy={imageProcessing}>
              <button
                className="workspace-image-thumbnail-button"
                type="button"
                aria-label={labels.viewImage}
                onClick={() => setImageViewerOpen(true)}
              >
                <img
                  className="workspace-image-preview"
                  src={imageInput.dataUrl}
                  alt={labels.imagePreviewAlt}
                  draggable={false}
                  style={{
                    filter: `${imagePreprocess.grayscale ? "grayscale(1) " : ""}contrast(${imagePreprocess.contrast})`,
                  }}
                />
                <span className="workspace-image-zoom-hint" aria-hidden="true">
                  <Maximize2 size={14} />
                </span>
              </button>
              <div className="workspace-image-summary">
                <strong title={imageInput.name}>{imageInput.name}</strong>
                <span>{imageInput.width} x {imageInput.height}px</span>
                <div className="workspace-image-summary-actions">
                  <Button
                    className="workspace-image-translate-button"
                    disabled={imageProcessing}
                    size="sm"
                    type="button"
                    variant="primary"
                    onClick={() => void handleImageProcess(true)}
                  >
                    <Languages size={14} />
                    {labels.imageOcrAndTranslate}
                  </Button>
                  <Button
                    aria-expanded={imageSettingsOpen}
                    aria-controls="workspace-image-preprocess"
                    className="workspace-image-more-button"
                    disabled={imageProcessing}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setImageSettingsOpen((open) => !open)}
                  >
                    <MoreHorizontal size={15} />
                    {labels.more}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <button
              className="workspace-image-dropzone"
              type="button"
              onClick={() => imageFileInputRef.current?.click()}
            >
              <ImagePlus size={18} aria-hidden="true" />
              <span>{labels.imageDropHint}</span>
            </button>
          )}

          {workspace.snapshot.textLines.length > 0 && !workspace.ocrLoading ? (
            <div className="workspace-ocr-summary" aria-live="polite">
              <span className="workspace-ocr-summary-copy">
                {labels.ocrDetectedSummary
                  .replace("{lines}", String(workspace.snapshot.textLines.length))
                  .replace("{characters}", String(sourceCharacterCount))}
              </span>
              <div className="workspace-ocr-summary-actions">
                {workspace.snapshot.requiresReview ? (
                  <span className="workspace-ocr-summary-status is-pending">{labels.ocrNeedsReview}</span>
                ) : isOcrTextEdited ? (
                  <span className="workspace-ocr-summary-status">{labels.ocrTextEdited}</span>
                ) : null}
                {lowConfidenceLines.length > 0 ? (
                  <Button
                    aria-expanded={ocrReviewOpen}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setOcrReviewOpen(true)}
                  >
                    <Crosshair size={14} />
                    {labels.ocrConfidenceReview} · {lowConfidenceLines.length}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="workspace-textarea-shell" aria-busy={workspace.ocrLoading}>
            <Textarea
              className={
                workspace.ocrLoading
                  ? "workspace-textarea workspace-source-textarea workspace-textarea-busy bg-control"
                  : "workspace-textarea workspace-source-textarea bg-control"
              }
              value={workspace.ocrLoading ? "" : workspace.textInput}
              onChange={(event) => handleSourceTextChange(event.target.value)}
              ref={sourceTextareaRef}
              onPaste={handleImagePaste}
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
              <div className="workspace-source-footer">
                {sourcePinyin ? (
                  <div className="workspace-source-pinyin" aria-label={labels.sourcePinyin}>
                    {sourcePinyin}
                  </div>
                ) : null}
                <div className="workspace-source-footer-row">
                  <div className="workspace-textarea-controls-left">
                    {voiceInputAvailable ? (
                      <IconTooltipButton
                        className={voiceInputActive ? "workspace-voice-input-active" : undefined}
                        disabled={workspace.translating || voiceInputStopping}
                        label={voiceInputActive ? labels.stopVoiceInput : labels.startVoiceInput}
                        onClick={handleToggleVoiceInput}
                        pressed={voiceInputActive}
                        variant="secondary"
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
                    {(!autoTranslateEnabled || workspace.snapshot.requiresReview) && hasSourceText ? (
                      <IconTooltipButton
                        disabled={workspace.translating || translateTextMutation.isPending}
                        label={labels.translateNow}
                        onClick={() => void handleTranslateText()}
                        variant="primary"
                      >
                        <Languages size={16} />
                      </IconTooltipButton>
                    ) : null}
                  </div>
                  {hasSourceText ? (
                    <div className="workspace-source-count" aria-label={labels.sourceCharacterCount}>
                      {sourceCharacterCount}
                    </div>
                  ) : null}
                </div>
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
              includeAuto
              labels={labels}
              uiLanguage={configQuery.data?.ui.language}
              value={workspace.targetLang}
              onChange={workspace.setTargetLang}
            />
          </div>
          <div className="workspace-actions">
            <IconTooltipButton
              disabled={pinMutation.isPending || !canPinResult}
              label={workspace.pinned ? labels.unpin : labels.pin}
              onClick={handleTogglePin}
              variant={workspace.pinned ? "primary" : "secondary"}
            >
              <Pin size={16} />
            </IconTooltipButton>
          </div>
        </div>
        <div className="workspace-result-scroll">
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
              <div className="workspace-result-footer">
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
                <div className="workspace-loading-message workspace-loading-message-with-action">
                  <span className="workspace-loading-copy">
                    <LoaderCircle size={18} aria-hidden="true" />
                    <span>{labels.translating}</span>
                  </span>
                  <IconTooltipButton
                    label={labels.cancelTranslation}
                    onClick={handleCancelTranslation}
                    size="icon"
                    variant="secondary"
                  >
                    <X size={15} />
                  </IconTooltipButton>
                </div>
                <div className="workspace-loading-bar" aria-hidden="true" />
              </div>
            ) : null}
            {!workspace.translating && translationError && failedTranslation ? (
              <div className="workspace-translation-error" role="alert">
                <span>{translationError}</span>
                <IconTooltipButton
                  disabled={translateTextMutation.isPending}
                  label={labels.retryTranslation}
                  onClick={handleRetryTranslation}
                  size="icon"
                  variant="secondary"
                >
                  <RefreshCw size={15} />
                </IconTooltipButton>
              </div>
            ) : null}
          </div>
          <DictionaryPanel
            activeSpeechKey={activeSpeechKey}
            entries={workspace.snapshot.dictionaryEntries}
            labels={labels}
            onSpeakEntry={(entry, key) => handleSpeak(entry.headword, "en", key, undefined, entry.audio_url)}
          />
        </div>
      </section>
    </section>
    {imageInput ? (
      <Dialog open={imageViewerOpen} onOpenChange={setImageViewerOpen}>
        <DialogContent className="workspace-image-viewer-dialog">
          <DialogHeader>
            <DialogTitle>{labels.viewImage}</DialogTitle>
          </DialogHeader>
          <div
            className="workspace-image-viewer-surface"
            style={{ aspectRatio: `${imageInput.width} / ${imageInput.height}` }}
            aria-label={labels.imageCropSurface}
            onPointerDown={handleImageCropPointerDown}
            onPointerMove={handleImageCropPointerMove}
            onPointerUp={handleImageCropPointerUp}
            onPointerCancel={handleImageCropPointerCancel}
          >
            <img
              className="workspace-image-viewer-preview"
              src={imageInput.dataUrl}
              alt={labels.imagePreviewAlt}
              draggable={false}
              style={{
                filter: `${imagePreprocess.grayscale ? "grayscale(1) " : ""}contrast(${imagePreprocess.contrast})`,
              }}
            />
            {imageCropSelection ? (
              <span
                className="workspace-image-crop-selection"
                style={{
                  left: imageCropSelection.x,
                  top: imageCropSelection.y,
                  width: imageCropSelection.width,
                  height: imageCropSelection.height,
                }}
              />
            ) : null}
          </div>
          <p className="workspace-image-viewer-hint">{labels.imageCropHint}</p>
          <DialogFooter>
            {imageCrop ? (
              <Button
                disabled={imageProcessing}
                type="button"
                variant="ghost"
                onClick={handleClearImageCrop}
              >
                {labels.imageCropClear}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => setImageViewerOpen(false)}>
              {labels.closePreview}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
    {imageInput ? (
      <Dialog open={imageSettingsOpen} onOpenChange={setImageSettingsOpen}>
        <DialogContent className="workspace-image-settings-dialog">
          <DialogHeader>
            <DialogTitle>{labels.imageEnhancement}</DialogTitle>
            <DialogDescription>{imageInput.name}</DialogDescription>
          </DialogHeader>
          <div id="workspace-image-preprocess" className="workspace-image-settings-body">
            <div className="workspace-image-preprocess-grid">
              <label className="workspace-image-control">
                <span>{labels.imageScale}</span>
                <Select
                  value={String(imagePreprocess.scale)}
                  disabled={imageProcessing}
                  onChange={(event) => setImagePreprocess((current) => ({
                    ...current,
                    scale: Number(event.target.value),
                  }))}
                >
                  <option value="0.5">50%</option>
                  <option value="1">100%</option>
                  <option value="1.5">150%</option>
                  <option value="2">200%</option>
                  <option value="3">300%</option>
                </Select>
              </label>
              <label className="workspace-image-control">
                <span>{labels.imageRotation}</span>
                <Select
                  value={String(imagePreprocess.rotation)}
                  disabled={imageProcessing}
                  onChange={(event) => setImagePreprocess((current) => ({
                    ...current,
                    rotation: Number(event.target.value) as ImagePreprocessOptions["rotation"],
                  }))}
                >
                  <option value="0">0°</option>
                  <option value="90">90°</option>
                  <option value="180">180°</option>
                  <option value="270">270°</option>
                </Select>
              </label>
              <label className="workspace-image-control workspace-image-control-range">
                <span>{labels.imageContrast}: {Math.round(imagePreprocess.contrast * 100)}%</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={imagePreprocess.contrast}
                  disabled={imageProcessing}
                  onChange={(event) => setImagePreprocess((current) => ({
                    ...current,
                    contrast: Number(event.target.value),
                  }))}
                />
              </label>
              <label className="workspace-image-grayscale-control">
                <Checkbox
                  checked={imagePreprocess.grayscale}
                  disabled={imageProcessing}
                  onCheckedChange={(checked) => setImagePreprocess((current) => ({
                    ...current,
                    grayscale: checked === true,
                  }))}
                />
                <span>{labels.imageGrayscale}</span>
              </label>
              <label className="workspace-image-grayscale-control">
                <Checkbox
                  checked={imagePreprocess.sharpen}
                  disabled={imageProcessing}
                  onCheckedChange={(checked) => setImagePreprocess((current) => ({
                    ...current,
                    sharpen: checked === true,
                  }))}
                />
                <span>{labels.imageSharpen}</span>
              </label>
            </div>
            {imageCrop ? (
              <Button
                className="workspace-image-settings-clear-crop"
                disabled={imageProcessing}
                type="button"
                variant="ghost"
                onClick={handleClearImageCrop}
              >
                <X size={14} />
                {labels.imageCropClear}
              </Button>
            ) : null}
          </div>
          <DialogFooter className="workspace-image-settings-actions">
            <Button
              className="workspace-image-settings-remove"
              disabled={imageProcessing}
              type="button"
              variant="ghost"
              onClick={handleRemoveImage}
            >
              <X size={14} />
              {labels.imageRemove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
    {lowConfidenceLines.length > 0 ? (
      <Dialog open={ocrReviewOpen} onOpenChange={setOcrReviewOpen}>
        <DialogContent className="workspace-ocr-review-dialog">
          <DialogHeader>
            <DialogTitle>{labels.ocrConfidenceReview}</DialogTitle>
            <DialogDescription>
              {labels.ocrLowConfidenceCount.replace("{count}", String(lowConfidenceLines.length))}
              {isOcrTextEdited ? ` · ${labels.ocrTextEdited}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="workspace-ocr-confidence-list" aria-live="polite">
            {lowConfidenceLines.map(({ line, index }) => (
              <button
                className="workspace-ocr-confidence-item"
                disabled={isOcrTextEdited}
                key={`${index}-${line.bbox.x}-${line.bbox.y}`}
                title={line.text}
                type="button"
                onClick={() => handleLocateOcrLine(index)}
              >
                <span className="workspace-ocr-confidence-score">
                  {Math.round(clampConfidence(line.confidence) * 100)}%
                </span>
                <span className="workspace-ocr-confidence-text">{line.text}</span>
                <Crosshair size={14} aria-hidden="true" />
                <span className="sr-only">{labels.locateOcrText}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOcrReviewOpen(false)}>
              {labels.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null}
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

/** Renders a speech control with a tonal active state instead of a primary-action fill. */
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
      pressed={active}
      variant="secondary"
      size={accentLabel ? "md" : "icon"}
      disabled={disabled}
    >
      <Volume2 size={16} />
      {accentLabel ? <span>{accentLabel}</span> : null}
    </IconTooltipButton>
  );
}

/** Wraps an icon button with a tooltip and optional toggle semantics. */
function IconTooltipButton({
  children,
  className,
  disabled,
  label,
  onClick,
  pressed,
  size = "icon",
  variant = "secondary",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  /** Announces the current toggle state to assistive technology. */
  pressed?: boolean;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const button = (
    <Button
      aria-label={label}
      aria-pressed={pressed}
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

/** Converts a pointer event into coordinates relative to the image preview surface. */
function imagePreviewPoint(event: React.PointerEvent<HTMLDivElement>) {
  const surface = event.currentTarget;
  const surfaceRect = surface.getBoundingClientRect();
  const imageElement = surface.querySelector("img");
  const imageRect = imageElement?.getBoundingClientRect() ?? surfaceRect;
  const imageLeft = clampNumber(imageRect.left - surfaceRect.left, 0, surfaceRect.width);
  const imageTop = clampNumber(imageRect.top - surfaceRect.top, 0, surfaceRect.height);
  const imageRight = clampNumber(imageRect.right - surfaceRect.left, imageLeft, surfaceRect.width);
  const imageBottom = clampNumber(imageRect.bottom - surfaceRect.top, imageTop, surfaceRect.height);
  // Keep the crop gesture inside the rendered image when object-fit adds letterboxing.
  return {
    x: clampNumber(event.clientX - surfaceRect.left, imageLeft, imageRight),
    y: clampNumber(event.clientY - surfaceRect.top, imageTop, imageBottom),
  };
}

/** Creates a normalized preview rectangle regardless of drag direction. */
function imageSelectionFromPoints(startX: number, startY: number, endX: number, endY: number): ImageCropSelection {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/** Maps a preview rectangle to intrinsic image pixels and rejects accidental clicks. */
function imageSelectionToRegion(
  selection: ImageCropSelection,
  imageWidth: number,
  imageHeight: number,
  surface: HTMLElement,
): Region | null {
  const surfaceRect = surface.getBoundingClientRect();
  const imageElement = surface.querySelector("img");
  const imageRect = imageElement?.getBoundingClientRect() ?? surfaceRect;
  const imageLeft = imageRect.left - surfaceRect.left;
  const imageTop = imageRect.top - surfaceRect.top;
  const imageRight = imageLeft + imageRect.width;
  const imageBottom = imageTop + imageRect.height;
  const clippedLeft = Math.max(selection.x, imageLeft);
  const clippedTop = Math.max(selection.y, imageTop);
  const clippedRight = Math.min(selection.x + selection.width, imageRight);
  const clippedBottom = Math.min(selection.y + selection.height, imageBottom);
  if (
    clippedRight - clippedLeft < 4 ||
    clippedBottom - clippedTop < 4 ||
    imageRect.width <= 0 ||
    imageRect.height <= 0
  ) return null;
  const left = clampNumber(Math.round((clippedLeft - imageLeft) * imageWidth / imageRect.width), 0, imageWidth);
  const top = clampNumber(Math.round((clippedTop - imageTop) * imageHeight / imageRect.height), 0, imageHeight);
  const right = clampNumber(Math.round((clippedRight - imageLeft) * imageWidth / imageRect.width), 0, imageWidth);
  const bottom = clampNumber(Math.round((clippedBottom - imageTop) * imageHeight / imageRect.height), 0, imageHeight);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Clamps a numeric value while keeping preview geometry finite. */
function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

/** Returns a safe confidence fraction for display when an OCR backend reports malformed data. */
function clampConfidence(value: number) {
  return clampNumber(value, 0, 1);
}

/** Finds the UTF-16 selection range for one OCR line using its aggregate line offset. */
function ocrLineSelectionRange(sourceText: string, lines: TextLine[], lineIndex: number) {
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const sourceLines = sourceText.split(/\r?\n/);
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const sourceLine = sourceLines[index] ?? "";
    const lineText = lines[index]?.text ?? "";
    if (index === lineIndex) {
      if (!lineText) return null;
      const exactStart = sourceLine.indexOf(lineText);
      if (exactStart >= 0) {
        return { start: offset + exactStart, end: offset + exactStart + lineText.length };
      }

      // OCR output can differ only in whitespace after a platform normalizes line endings.
      const normalizedSource = sourceLine.replace(/\s+/g, " ").trim();
      const normalizedLine = lineText.replace(/\s+/g, " ").trim();
      const normalizedStart = normalizedSource.indexOf(normalizedLine);
      if (normalizedStart >= 0 && normalizedLine) {
        return { start: offset, end: offset + sourceLine.length };
      }
      return null;
    }
    offset += sourceLine.length + 1;
  }
  return null;
}

/** Reads a browser File as a base64 data URL for the image commands. */
function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string" && value.trim()) {
        resolve(value);
      } else {
        reject(new Error("无法读取图片内容"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.onabort = () => reject(new Error("读取图片已取消"));
    reader.readAsDataURL(file);
  });
}

/** Resolves intrinsic image dimensions so the full image can be passed as an OCR region. */
function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("图片尺寸无效"));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new Error("无法解析图片"));
    image.src = dataUrl;
  });
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
