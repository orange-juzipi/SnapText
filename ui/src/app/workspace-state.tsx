import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { HistoryRecord, TranslationRequest, WorkspaceSnapshot } from "@/lib/types";
import { AUTO_SOURCE_LANG, DEFAULT_TARGET_LANG, normalizeTargetLang } from "@/lib/language";

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
  setOcrTextInput: (sourceText: string, source: string) => void;
  setResultFromHistory: (record: HistoryRecord) => void;
  setResultFromTranslation: (result: {
    source: string;
    source_text: string;
    translated_text: string;
    target_lang: string;
  }) => void;
  setResultSnapshot: (result: {
    source: string;
    source_text: string;
    translated_text: string;
    target_lang: string;
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
};

export function WorkspaceStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [textInput, setTextInput] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [sourceLang, setSourceLang] = useState(AUTO_SOURCE_LANG);
  const [targetLang, setTargetLangState] = useState(DEFAULT_TARGET_LANG);
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

  const setResultSnapshot = useCallback(
    (result: { source: string; source_text: string; translated_text: string; target_lang: string }) => {
      setSnapshot({
        result: result.translated_text,
        sourceText: result.source_text,
        sourceKind: result.source,
        targetLang: result.target_lang,
      });
      setTextInput(result.source_text);
      setLastRequest({ source: result.source, source_text: result.source_text });
    },
    [],
  );

  const setOcrTextInput = useCallback((sourceText: string, source: string) => {
    setTextInput(sourceText);
    setSnapshot({
      result: "",
      sourceText,
      sourceKind: source,
      targetLang: "",
    });
    setLastRequest({ source, source_text: sourceText });
  }, []);

  const setResultFromHistory = useCallback(
    (record: HistoryRecord) => setResultSnapshot(record),
    [setResultSnapshot],
  );

  const setResultFromTranslation = useCallback(
    (result: { source: string; source_text: string; translated_text: string; target_lang: string }) =>
      setResultSnapshot(result),
    [setResultSnapshot],
  );

  const clearTranslation = useCallback(() => {
    setSnapshot(emptySnapshot);
    setLastRequest(null);
  }, []);

  const clearTextPanels = useCallback(() => {
    // 首页清空只处理两侧文本内容，不改变目标语言、历史记录或固钉窗口状态。
    setSnapshot(emptySnapshot);
    setTextInput("");
    setLastRequest(null);
  }, []);

  const clearResult = useCallback(() => {
    setSnapshot(emptySnapshot);
    setTextInput("");
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
      setResultFromHistory,
      setResultFromTranslation,
      setResultSnapshot,
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
