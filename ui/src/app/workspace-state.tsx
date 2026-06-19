import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { HistoryRecord, TranslationRequest, WorkspaceSnapshot } from "@/lib/types";

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
  targetLang: string;
  translating: boolean;
  pinned: boolean;
  lastRequest: TranslationRequest | null;
  status: string;
  toasts: AppToast[];
  setStatus: (status: string) => void;
  showError: (message: string, title?: string) => void;
  dismissToast: (id: string) => void;
  setTextInput: (value: string) => void;
  setOcrLoading: (value: boolean) => void;
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
  const [targetLang, setTargetLang] = useState("en");
  const [translating, setTranslating] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [lastRequest, setLastRequest] = useState<TranslationRequest | null>(null);
  const [status, setStatus] = useState("就绪");
  const [toasts, setToasts] = useState<AppToast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showError = useCallback((message: string, title = "操作失败") => {
    const id = crypto.randomUUID();
    // Error details belong in toast, not the compact header status badge.
    setToasts((current) => [
      ...current.slice(-2),
      {
        id,
        title,
        description: message,
        variant: "destructive",
      },
    ]);
    window.setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

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
    setPinned(false);
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

  const clearResult = useCallback(() => {
    setSnapshot(emptySnapshot);
    setLastRequest(null);
    setPinned(false);
  }, []);

  const value = useMemo<WorkspaceState>(
    () => ({
      snapshot,
      textInput,
      ocrLoading,
      targetLang,
      translating,
      pinned,
      lastRequest,
      status,
      toasts,
      setStatus,
      showError,
      dismissToast,
      setTextInput,
      setOcrLoading,
      setTargetLang,
      setTranslating,
      setPinned,
      setOcrTextInput,
      setResultSnapshot,
      setResultFromHistory,
      setResultFromTranslation,
      clearResult,
    }),
    [
      clearResult,
      lastRequest,
      ocrLoading,
      pinned,
      dismissToast,
      setOcrTextInput,
      setResultFromHistory,
      setResultFromTranslation,
      setResultSnapshot,
      showError,
      snapshot,
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
