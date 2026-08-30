import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DictionaryEntry, HistoryRecord, TextLine, TranslationRequest, WorkspaceSnapshot } from "@/lib/types";
import {
  AUTO_SOURCE_LANG,
  AUTO_TARGET_LANG,
  normalizeTargetLang,
} from "@/lib/language";

export type AppToast = {
  id: string;
  title: string;
  description?: string;
  variant: "default" | "success" | "destructive";
};

type WorkspaceState = {
  snapshot: WorkspaceSnapshot;
  textInput: string;
  ocrLoading: boolean;
  sourceLang: string;
  targetLang: string;
  translating: boolean;
  pinned: boolean;
  lastRequest: TranslationRequest | null;
  status: string;
  toasts: AppToast[];
  setStatus: (status: string) => void;
  showToast: (title: string, description?: string, variant?: AppToast["variant"]) => void;
  showError: (message: string, title?: string) => void;
  dismissToast: (id: string) => void;
  setTextInput: (value: string) => void;
  setOcrLoading: (value: boolean) => void;
  setSourceLang: (value: string) => void;
  setTargetLang: (value: string) => void;
  setTranslating: (value: boolean) => void;
  setPinned: (value: boolean) => void;
  setOcrTextInput: (sourceText: string, source: string, textLines?: TextLine[], requiresReview?: boolean) => void;
  setResultFromHistory: (record: HistoryRecord) => void;
  setResultFromTranslation: (result: {
    source: string;
    source_text: string;
    translated_text: string;
    target_lang: string;
    dictionary_entries?: DictionaryEntry[];
    text_lines?: TextLine[];
  }) => void;
  setTranslationResultOnly: (result: {
    source: string;
    source_text: string;
    translated_text: string;
    target_lang: string;
    dictionary_entries?: DictionaryEntry[];
    text_lines?: TextLine[];
  }) => void;
  setResultSnapshot: (result: {
    source: string;
    source_text: string;
    translated_text: string;
    target_lang: string;
    dictionary_entries?: DictionaryEntry[];
    text_lines?: TextLine[];
  }) => void;
  swapTextPanels: (next: {
    sourceText: string;
    translatedText: string;
    targetLang: string;
  }) => void;
  clearTranslation: () => void;
  clearTextPanels: () => void;
  clearResult: () => void;
};

const WorkspaceStateContext = createContext<WorkspaceState | null>(null);

const emptySnapshot: WorkspaceSnapshot = {
  result: "",
  sourceText: "",
  sourceKind: "",
  targetLang: "",
  dictionaryEntries: [],
  textLines: [],
  requiresReview: false,
};

export function WorkspaceStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [textInput, setTextInputState] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [sourceLang, setSourceLang] = useState(AUTO_SOURCE_LANG);
  const [targetLang, setTargetLangState] = useState(AUTO_TARGET_LANG);
  const [translating, setTranslating] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [lastRequest, setLastRequest] = useState<TranslationRequest | null>(null);
  const [status, setStatus] = useState("就绪");
  const [toasts, setToasts] = useState<AppToast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((title: string, description?: string, variant: AppToast["variant"] = "default") => {
    const id = crypto.randomUUID();
    setToasts((current) => {
      const nextToast = { id, title, description, variant };
      const deduped = current.filter((toast) => toast.title !== title || toast.description !== description);
      return [...deduped.slice(-1), nextToast];
    });
    window.setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  const showError = useCallback((message: string, title = "操作失败") => {
    // Error details belong in toast, not the compact header status badge.
    showToast(title, message, "destructive");
  }, [showToast]);

  const setTargetLang = useCallback((value: string) => {
    setTargetLangState(normalizeTargetLang(value));
  }, []);

  const setTextInput = useCallback((value: string) => {
    setTextInputState(value);
    setSnapshot((current) => {
      // Keep OCR boxes visible after an edit so the user can still review every flagged line;
      // the workspace disables coordinate lookup once the aggregate text no longer matches.
      if (current.sourceText === value && !current.requiresReview) return current;
      const preserveOcrMetadata = value.trim().length > 0 && !current.result.trim() && current.textLines.length > 0;
      return {
        ...current,
        textLines: preserveOcrMetadata ? current.textLines : [],
        requiresReview: false,
      };
    });
  }, []);

  const setResultSnapshot = useCallback(
    (result: {
      source: string;
      source_text: string;
      translated_text: string;
      target_lang: string;
      dictionary_entries?: DictionaryEntry[];
      text_lines?: TextLine[];
    }) => {
      setSnapshot({
        result: result.translated_text,
        sourceText: result.source_text,
        sourceKind: result.source,
        targetLang: result.target_lang,
        dictionaryEntries: result.dictionary_entries ?? [],
        textLines: result.text_lines ?? [],
        requiresReview: false,
      });
      setTextInputState(result.source_text);
      setLastRequest({ source: result.source, source_text: result.source_text });
    },
    [],
  );

  const setOcrTextInput = useCallback((
    sourceText: string,
    source: string,
    textLines: TextLine[] = [],
    requiresReview = false,
  ) => {
    setTextInputState(sourceText);
    setSnapshot({
      result: "",
      sourceText,
      sourceKind: source,
      targetLang: "",
      dictionaryEntries: [],
      textLines,
      requiresReview,
    });
    setLastRequest({ source, source_text: sourceText });
  }, []);

  const setResultFromHistory = useCallback(
    (record: HistoryRecord) => setResultSnapshot(record),
    [setResultSnapshot],
  );

  const setResultFromTranslation = useCallback(
    (result: {
      source: string;
      source_text: string;
      translated_text: string;
      target_lang: string;
      dictionary_entries?: DictionaryEntry[];
      text_lines?: TextLine[];
    }) =>
      setResultSnapshot(result),
    [setResultSnapshot],
  );

  const setTranslationResultOnly = useCallback(
    (result: {
      source: string;
      source_text: string;
      translated_text: string;
      target_lang: string;
      dictionary_entries?: DictionaryEntry[];
      text_lines?: TextLine[];
    }) => {
      // 自动翻译结果可能晚于用户输入返回，只更新右侧译文，不能回写当前输入框。
      setSnapshot({
        result: result.translated_text,
        sourceText: result.source_text,
        sourceKind: result.source,
        targetLang: result.target_lang,
        dictionaryEntries: result.dictionary_entries ?? [],
        textLines: result.text_lines ?? [],
        requiresReview: false,
      });
      setLastRequest({ source: result.source, source_text: result.source_text });
    },
    [],
  );

  const swapTextPanels = useCallback(
    (next: { sourceText: string; translatedText: string; targetLang: string }) => {
      // Swap is a local panel operation; do not create a history request or retranslate immediately.
      setTextInputState(next.sourceText);
      setSnapshot({
        result: next.translatedText,
        sourceText: next.sourceText,
        sourceKind: "text",
        targetLang: next.targetLang,
        dictionaryEntries: [],
        textLines: [],
        requiresReview: false,
      });
      setLastRequest(null);
    },
    [],
  );

  const clearTranslation = useCallback(() => {
    setSnapshot(emptySnapshot);
    setLastRequest(null);
  }, []);

  const clearTextPanels = useCallback(() => {
    // 首页清空只处理两侧文本内容，不改变目标语言、历史记录或固钉窗口状态。
    setSnapshot(emptySnapshot);
    setTextInputState("");
    setLastRequest(null);
  }, []);

  const clearResult = useCallback(() => {
    setSnapshot(emptySnapshot);
    setTextInputState("");
    setLastRequest(null);
    setPinned(false);
  }, []);

  const value = useMemo<WorkspaceState>(
    () => ({
      snapshot,
      textInput,
      ocrLoading,
      sourceLang,
      targetLang,
      translating,
      pinned,
      lastRequest,
      status,
      toasts,
      setStatus,
      showToast,
      showError,
      dismissToast,
      setTextInput,
      setOcrLoading,
      setSourceLang,
      setTargetLang,
      setTranslating,
      setPinned,
      setOcrTextInput,
      setResultSnapshot,
      setTranslationResultOnly,
      swapTextPanels,
      setResultFromHistory,
      setResultFromTranslation,
      clearTranslation,
      clearTextPanels,
      clearResult,
    }),
    [
      clearTextPanels,
      clearResult,
      clearTranslation,
      lastRequest,
      ocrLoading,
      pinned,
      dismissToast,
      setOcrTextInput,
      setTextInput,
      setResultFromHistory,
      setResultFromTranslation,
      setTranslationResultOnly,
      setResultSnapshot,
      swapTextPanels,
      showToast,
      showError,
      snapshot,
      sourceLang,
      status,
      targetLang,
      textInput,
      translating,
      toasts,
    ],
  );

  return <WorkspaceStateContext.Provider value={value}>{children}</WorkspaceStateContext.Provider>;
}

export function useWorkspaceState() {
  const value = useContext(WorkspaceStateContext);
  if (!value) {
    throw new Error("useWorkspaceState must be used within WorkspaceStateProvider");
  }
  return value;
}
