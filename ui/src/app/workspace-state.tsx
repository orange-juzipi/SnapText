import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { DictionaryEntry, HistoryRecord, TextLine, TranslationRequest, WorkspaceSnapshot } from "@/lib/types";
import {
  AUTO_SOURCE_LANG,
  AUTO_TARGET_LANG,
  normalizeTargetLang,
} from "@/lib/language";

export type AppToast = {
  /** 提示的唯一标识，用于独立关闭。 */
  id: string;
  /** 提示标题。 */
  title: string;
  /** 可选的详细说明。 */
  description?: string;
  /** 提示的视觉状态。 */
  variant: "default" | "success" | "destructive";
};

type WorkspaceState = {
  /** 当前原文、译文和 OCR 复核信息。 */
  snapshot: WorkspaceSnapshot;
  /** 输入框中正在编辑的原文。 */
  textInput: string;
  /** 是否正在执行 OCR 识别。 */
  ocrLoading: boolean;
  /** 当前选择的源语言。 */
  sourceLang: string;
  /** 当前选择的目标语言。 */
  targetLang: string;
  /** 当前请求是否正在翻译。 */
  translating: boolean;
  /** 结果窗口是否已固钉。 */
  pinned: boolean;
  /** 最近一次结果对应的翻译来源和原文。 */
  lastRequest: TranslationRequest | null;
  /** 工作区当前状态文案。 */
  status: string;
  /** 当前可见的操作提示。 */
  toasts: AppToast[];
  /** 更新工作区状态文案。 */
  setStatus: (status: string) => void;
  /** 展示可自动消失的操作提示。 */
  showToast: (title: string, description?: string, variant?: AppToast["variant"]) => void;
  /** 将错误详细信息展示为失败提示。 */
  showError: (message: string, title?: string) => void;
  /** 按标识关闭一条操作提示。 */
  dismissToast: (id: string) => void;
  /** 更新原文，实际变化时使旧翻译失效。 */
  setTextInput: (value: string) => void;
  /** 更新 OCR 识别的加载状态。 */
  setOcrLoading: (value: boolean) => void;
  /** 更新源语言，实际变化时使旧翻译失效。 */
  setSourceLang: (value: string) => void;
  /** 更新规范化后的目标语言，实际变化时使旧翻译失效。 */
  setTargetLang: (value: string) => void;
  /** 直接更新翻译加载状态。 */
  setTranslating: (value: boolean) => void;
  /** 开始新的翻译并使主页面和原生事件的先前请求失效。 */
  beginTranslation: () => number;
  /** 判断返回结果是否仍属于当前输入与语言设置。 */
  isTranslationCurrent: (id: number) => boolean;
  /** 仅允许当前请求结束自己的加载状态。 */
  finishTranslation: (id: number) => void;
  /** 编辑或切换内容时使所有待处理翻译失效。 */
  cancelTranslation: () => void;
  /** 更新结果窗口固钉状态。 */
  setPinned: (value: boolean) => void;
  /** 写入新的 OCR 或划词原文并保留可选复核信息。 */
  setOcrTextInput: (sourceText: string, source: string, textLines?: TextLine[], requiresReview?: boolean) => void;
  /** 从历史记录恢复完整结果。 */
  setResultFromHistory: (record: HistoryRecord) => void;
  /** 从翻译返回值恢复完整结果。 */
  setResultFromTranslation: (result: {
    /** 识别或翻译内容的来源类型。 */
    source: string;
    /** 结果对应的完整原文。 */
    source_text: string;
    /** 返回的译文文本。 */
    translated_text: string;
    /** 该译文实际使用的目标语言。 */
    target_lang: string;
    /** 可选的词典释义和发音信息。 */
    dictionary_entries?: DictionaryEntry[];
    /** 可选的 OCR 行文字及坐标信息。 */
    text_lines?: TextLine[];
  }) => void;
  /** 仅替换右侧译文，保留输入框内容。 */
  setTranslationResultOnly: (result: {
    /** 识别或翻译内容的来源类型。 */
    source: string;
    /** 结果对应的完整原文。 */
    source_text: string;
    /** 返回的译文文本。 */
    translated_text: string;
    /** 该译文实际使用的目标语言。 */
    target_lang: string;
    /** 可选的词典释义和发音信息。 */
    dictionary_entries?: DictionaryEntry[];
    /** 可选的 OCR 行文字及坐标信息。 */
    text_lines?: TextLine[];
  }) => void;
  /** 整体替换当前原文、译文和元信息。 */
  setResultSnapshot: (result: {
    /** 识别或翻译内容的来源类型。 */
    source: string;
    /** 结果对应的完整原文。 */
    source_text: string;
    /** 返回的译文文本。 */
    translated_text: string;
    /** 该译文实际使用的目标语言。 */
    target_lang: string;
    /** 可选的词典释义和发音信息。 */
    dictionary_entries?: DictionaryEntry[];
    /** 可选的 OCR 行文字及坐标信息。 */
    text_lines?: TextLine[];
  }) => void;
  /** 交换两侧文字并更新结果语言。 */
  swapTextPanels: (next: {
    /** 交换后放入输入框的原文。 */
    sourceText: string;
    /** 交换后放入译文面板的文字。 */
    translatedText: string;
    /** 交换后译文对应的语言。 */
    targetLang: string;
  }) => void;
  /** 清除结果和最近请求，保留输入框内容。 */
  clearTranslation: () => void;
  /** 清空两侧文本，保留语言和固钉状态。 */
  clearTextPanels: () => void;
  /** 清空文本、结果和固钉状态。 */
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

/** 在页面与原生事件间共享输入、结果及翻译请求所有权。 */
export function WorkspaceStateProvider({ children }: {
  /** 共享工作区状态的子组件。 */
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot);
  const [textInput, setTextInputState] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [sourceLang, setSourceLangState] = useState(AUTO_SOURCE_LANG);
  const [targetLang, setTargetLangState] = useState(AUTO_TARGET_LANG);
  const [translating, setTranslating] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [lastRequest, setLastRequest] = useState<TranslationRequest | null>(null);
  const [status, setStatus] = useState("就绪");
  const [toasts, setToasts] = useState<AppToast[]>([]);
  const translationEpochRef = useRef(0);
  // 同步保存输入与语言，支持同一渲染周期内判断值是否实际变化。
  const currentInputRef = useRef({
    /** 当前输入框原文。 */
    text: textInput,
    /** 当前源语言。 */
    sourceLang,
    /** 当前规范化目标语言。 */
    targetLang,
  });
  currentInputRef.current = { text: textInput, sourceLang, targetLang };

  /** 同步抢占请求所有权，避免旧请求在 React 下一次渲染前写入。 */
  const beginTranslation = useCallback(() => {
    const id = ++translationEpochRef.current;
    setTranslating(true);
    return id;
  }, []);

  /** 校验成功、失败和 finally 回调的请求代次。 */
  const isTranslationCurrent = useCallback((id: number) => id === translationEpochRef.current, []);

  /** 旧请求结束时不能停止新请求的加载提示。 */
  const finishTranslation = useCallback((id: number) => {
    if (id === translationEpochRef.current) setTranslating(false);
  }, []);

  /** 内容被用户修改或替换后，旧翻译的结果和错误均不再有效。 */
  const cancelTranslation = useCallback(() => {
    translationEpochRef.current += 1;
    setTranslating(false);
  }, []);

  /** 按唯一标识移除指定提示。 */
  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** 合并重复提示并在展示五秒后自动关闭。 */
  const showToast = useCallback((title: string, description?: string, variant: AppToast["variant"] = "default") => {
    const id = crypto.randomUUID();
    setToasts((current) => {
      const nextToast = { id, title, description, variant };
      const deduped = current.filter((toast) => toast.title !== title || toast.description !== description);
      return [...deduped.slice(-1), nextToast];
    });
    window.setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  /** 将错误详情放入失败提示，避免占用紧凑状态栏。 */
  const showError = useCallback((message: string, title = "操作失败") => {
    // Error details belong in toast, not the compact header status badge.
    showToast(title, message, "destructive");
  }, [showToast]);

  /** 修改源语言时立即废弃使用旧设置的翻译请求。 */
  const setSourceLang = useCallback((value: string) => {
    if (value === currentInputRef.current.sourceLang) return;
    currentInputRef.current.sourceLang = value;
    cancelTranslation();
    setSourceLangState(value);
  }, [cancelTranslation]);

  /** 规范化目标语言，并使使用旧目标语言的响应失效。 */
  const setTargetLang = useCallback((value: string) => {
    const normalized = normalizeTargetLang(value);
    if (normalized === currentInputRef.current.targetLang) return;
    currentInputRef.current.targetLang = normalized;
    cancelTranslation();
    setTargetLangState(normalized);
  }, [cancelTranslation]);

  /** 编辑原文时取消旧翻译，同时按需保留 OCR 复核坐标。 */
  const setTextInput = useCallback((value: string) => {
    if (value === currentInputRef.current.text) return;
    currentInputRef.current.text = value;
    cancelTranslation();
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
  }, [cancelTranslation]);

  /** 原子替换当前结果，并结束此前仍在等待的翻译。 */
  const setResultSnapshot = useCallback(
    (result: {
      /** 识别或翻译内容的来源类型。 */
      source: string;
      /** 结果对应的完整原文。 */
      source_text: string;
      /** 返回的译文文本。 */
      translated_text: string;
      /** 该译文实际使用的目标语言。 */
      target_lang: string;
      /** 可选的词典释义和发音信息。 */
      dictionary_entries?: DictionaryEntry[];
      /** 可选的 OCR 行文字及坐标信息。 */
      text_lines?: TextLine[];
    }) => {
      cancelTranslation();
      setSnapshot({
        result: result.translated_text,
        sourceText: result.source_text,
        sourceKind: result.source,
        targetLang: result.target_lang,
        dictionaryEntries: result.dictionary_entries ?? [],
        textLines: result.text_lines ?? [],
        requiresReview: false,
      });
      currentInputRef.current.text = result.source_text;
      setTextInputState(result.source_text);
      setLastRequest({ source: result.source, source_text: result.source_text });
    },
    [cancelTranslation],
  );

  /** 新 OCR 或划词内容到达时抢占旧输入的请求。 */
  const setOcrTextInput = useCallback((
    sourceText: string,
    source: string,
    textLines: TextLine[] = [],
    requiresReview = false,
  ) => {
    cancelTranslation();
    currentInputRef.current.text = sourceText;
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
  }, [cancelTranslation]);

  /** 使用历史记录替换完整工作区结果。 */
  const setResultFromHistory = useCallback(
    (record: HistoryRecord) => setResultSnapshot(record),
    [setResultSnapshot],
  );

  /** 将翻译返回值交给统一结果替换流程。 */
  const setResultFromTranslation = useCallback(
    (result: {
      /** 识别或翻译内容的来源类型。 */
      source: string;
      /** 结果对应的完整原文。 */
      source_text: string;
      /** 返回的译文文本。 */
      translated_text: string;
      /** 该译文实际使用的目标语言。 */
      target_lang: string;
      /** 可选的词典释义和发音信息。 */
      dictionary_entries?: DictionaryEntry[];
      /** 可选的 OCR 行文字及坐标信息。 */
      text_lines?: TextLine[];
    }) =>
      setResultSnapshot(result),
    [setResultSnapshot],
  );

  /** 写入已校验为当前请求的译文，保持输入框中的文字不变。 */
  const setTranslationResultOnly = useCallback(
    (result: {
      /** 识别或翻译内容的来源类型。 */
      source: string;
      /** 结果对应的完整原文。 */
      source_text: string;
      /** 返回的译文文本。 */
      translated_text: string;
      /** 该译文实际使用的目标语言。 */
      target_lang: string;
      /** 可选的词典释义和发音信息。 */
      dictionary_entries?: DictionaryEntry[];
      /** 可选的 OCR 行文字及坐标信息。 */
      text_lines?: TextLine[];
    }) => {
      cancelTranslation();
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
    [cancelTranslation],
  );

  /** 交换两侧文字并取消尚未返回的翻译。 */
  const swapTextPanels = useCallback(
    (next: {
      /** 交换后放入输入框的原文。 */
      sourceText: string;
      /** 交换后放入译文面板的文字。 */
      translatedText: string;
      /** 交换后译文对应的语言。 */
      targetLang: string;
    }) => {
      cancelTranslation();
      // Swap is a local panel operation; do not create a history request or retranslate immediately.
      currentInputRef.current.text = next.sourceText;
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
    [cancelTranslation],
  );

  /** 清除结果时禁止先前请求再次填回内容。 */
  const clearTranslation = useCallback(() => {
    cancelTranslation();
    setSnapshot(emptySnapshot);
    setLastRequest(null);
  }, [cancelTranslation]);

  /** 清空两侧内容并取消旧请求，保留语言设置和固钉状态。 */
  const clearTextPanels = useCallback(() => {
    cancelTranslation();
    // 首页清空只处理两侧文本内容，不改变目标语言、历史记录或固钉窗口状态。
    setSnapshot(emptySnapshot);
    currentInputRef.current.text = "";
    setTextInputState("");
    setLastRequest(null);
  }, [cancelTranslation]);

  /** 重置整个工作区，并使当前翻译失效。 */
  const clearResult = useCallback(() => {
    cancelTranslation();
    setSnapshot(emptySnapshot);
    currentInputRef.current.text = "";
    setTextInputState("");
    setLastRequest(null);
    setPinned(false);
  }, [cancelTranslation]);

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
      beginTranslation,
      isTranslationCurrent,
      finishTranslation,
      cancelTranslation,
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
      beginTranslation,
      isTranslationCurrent,
      finishTranslation,
      cancelTranslation,
      setSourceLang,
      setTargetLang,
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

/** 从应用容器中读取唯一的工作区状态。 */
export function useWorkspaceState() {
  const value = useContext(WorkspaceStateContext);
  if (!value) {
    throw new Error("useWorkspaceState must be used within WorkspaceStateProvider");
  }
  return value;
}
