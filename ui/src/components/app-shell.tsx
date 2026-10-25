import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Home, History, Settings } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { queryKeys, useConfigQuery, useUpdateConfigMutation } from "@/lib/queries";
import { labelsForLanguage } from "@/lib/labels";
import {
  AUTO_SOURCE_LANG,
  AUTO_TARGET_LANG,
  resolveSourceLang,
  resolveTargetLang,
} from "@/lib/language";
import { errorMessage } from "@/lib/errors";
import { visibleProvider } from "@/lib/translation-provider";
import { translateText } from "@/lib/api";
import { TabsLink, TabsNav } from "@/components/ui/tabs";
import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { useWorkspaceState } from "@/app/workspace-state";
import { events } from "@/lib/api";
import { tauriListen } from "@/lib/tauri";
import type {
  HistoryRecord,
  OverlayOcrPayload,
  SelectionFailurePayload,
  SelectionTextPayload,
  TranslationResult,
} from "@/lib/types";

/** 协调页面导航和原生 OCR、划词事件，保持异步翻译的唯一所有权。 */
export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hideHeader = pathname === "/settings";
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();
  const liveContextRef = useRef({ pathname, labels, sourceLang: workspace.sourceLang, targetLang: workspace.targetLang });
  liveContextRef.current = { pathname, labels, sourceLang: workspace.sourceLang, targetLang: workspace.targetLang };
  const {
    setOcrTextInput,
    setPinned,
    setResultFromHistory,
    setResultSnapshot,
    setResultFromTranslation,
    setOcrLoading,
    setStatus,
    setTranslating,
    beginTranslation,
    isTranslationCurrent,
    finishTranslation,
    cancelTranslation,
    showError,
  } = workspace;

  /** 原生流程跳回首页时不重建监听器，也不使刚发出的翻译失效。 */
  const ensureWorkspaceRoute = useCallback(() => {
    // Capture and selection flows update the workspace panels, so surface them immediately.
    if (liveContextRef.current.pathname !== "/") {
      void navigate({ to: "/" });
    }
  }, [navigate]);

  /** 配置迁移与服务选择共用名单，避免把新增直连服务误改为云端。 */
  useEffect(() => {
    const config = configQuery.data;
    if (!config || updateConfig.isPending) return;

    const shouldUpdateTargetLang = !config.target_lang?.trim();
    const provider = visibleProvider(config.translator.provider);
    const shouldUpdateProvider = provider !== config.translator.provider;
    if (!shouldUpdateTargetLang && !shouldUpdateProvider) return;

    // Keep stale persisted desktop config aligned without changing explicit endpoint choices.
    updateConfig
      .mutateAsync({
        ...config,
        target_lang: shouldUpdateTargetLang ? AUTO_TARGET_LANG : config.target_lang,
        translator: {
          ...config.translator,
          provider,
        },
      })
      .catch((error) => {
        showError(errorMessage(error));
      });
  }, [configQuery.data, showError, updateConfig]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    /** 异步注册成功时若已卸载，立即释放迟到的监听器。 */
    const register = (listener: Promise<() => void>) => {
      listener
        .then((unlisten) => {
          // Tauri listener registration is async. If React has already cleaned
          // this effect up, immediately detach the late listener so stale
          // handlers cannot emit old failure toasts after a newer success.
          if (disposed) {
            unlisten();
            return;
          }
          unlisteners.push(unlisten);
        })
        .catch((error) => {
          if (!disposed) showError(errorMessage(error));
        });
    };

    register(tauriListen<TranslationResult>(events.resultTranslation, (event) => {
      // A native image/overlay result supersedes any direct selection request still in flight.
      if (disposed) return;
      setResultFromTranslation(event.payload);
      setStatus(liveContextRef.current.labels.regionTranslated);
    }));
    register(tauriListen<HistoryRecord>(events.resultSelection, (event) => {
      if (disposed) return;
      ensureWorkspaceRoute();
      setResultFromHistory(event.payload);
      setStatus(liveContextRef.current.labels.textTranslated);
    }));
    register(tauriListen<SelectionTextPayload>(events.selectionText, (event) => {
      const sourceText = event.payload.text;
      if (disposed) return;
      ensureWorkspaceRoute();
      setOcrLoading(false);
      setOcrTextInput(sourceText, "selection");
      setStatus(liveContextRef.current.labels.selectionTextExtracted);
      const { sourceLang, targetLang } = liveContextRef.current;
      const runId = beginTranslation();
      translateText(sourceText, resolveTargetLang(sourceText, targetLang), resolveSourceLang(sourceText, sourceLang) ?? AUTO_SOURCE_LANG)
        .then((record) => {
          if (disposed || !isTranslationCurrent(runId)) return;
          setResultSnapshot({ ...record, source: "selection" });
          setStatus(liveContextRef.current.labels.textTranslated);
          void queryClient.invalidateQueries({ queryKey: queryKeys.history(), exact: false });
        })
        .catch((error) => {
          if (disposed || !isTranslationCurrent(runId)) return;
          showError(errorMessage(error));
        })
        .finally(() => {
          if (!disposed) finishTranslation(runId);
        });
    }));
    register(tauriListen<SelectionFailurePayload>(events.resultSelectionFailed, (event) => {
      if (disposed) return;
      cancelTranslation();
      ensureWorkspaceRoute();
      setTranslating(false);
      setOcrLoading(false);
      showError(errorMessage(event.payload.message));
    }));
    register(tauriListen(events.overlayOcrStarted, () => {
      if (disposed) return;
      cancelTranslation();
      ensureWorkspaceRoute();
      setOcrLoading(true);
      setTranslating(false);
      setStatus(liveContextRef.current.labels.ocrSelectedRegion);
    }));
    register(tauriListen<Partial<SelectionFailurePayload>>(events.overlayOcrFailed, (event) => {
      if (disposed) return;
      cancelTranslation();
      setOcrLoading(false);
      setTranslating(false);
      // OCR 期间选区窗口已隐藏，错误必须由用户仍能看见的主窗口展示。
      if (event.payload?.message) showError(errorMessage(event.payload.message));
    }));
    register(tauriListen<OverlayOcrPayload>(events.overlayOcr, (event) => {
      if (disposed) return;
      const sourceText = event.payload.result.source_text;
      setOcrLoading(false);
      setOcrTextInput(
        sourceText,
        "screenshot",
        event.payload.result.text_lines,
        event.payload.translate_after_ocr === false,
      );
      setStatus(liveContextRef.current.labels.ocrTextExtracted);
      // Overlay mode can intentionally stop after OCR so the user can correct text first.
      if (event.payload.translate_after_ocr === false) {
        setTranslating(false);
        return;
      }
      const { sourceLang, targetLang } = liveContextRef.current;
      const runId = beginTranslation();
      translateText(sourceText, resolveTargetLang(sourceText, targetLang), resolveSourceLang(sourceText, sourceLang) ?? AUTO_SOURCE_LANG)
        .then((record) => {
          if (disposed || !isTranslationCurrent(runId)) return;
          setResultSnapshot({ ...record, source: "screenshot" });
          setStatus(liveContextRef.current.labels.regionTranslated);
          void queryClient.invalidateQueries({ queryKey: queryKeys.history(), exact: false });
        })
        .catch((error) => {
          if (disposed || !isTranslationCurrent(runId)) return;
          showError(errorMessage(error));
        })
        .finally(() => {
          if (!disposed) finishTranslation(runId);
        });
    }));
    register(tauriListen<boolean>(events.resultWindowState, (event) => {
      if (disposed) return;
      setPinned(Boolean(event.payload));
    }));
    return () => {
      // Disposed guards reject work from this listener generation without cancelling another owner's request.
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    beginTranslation,
    isTranslationCurrent,
    finishTranslation,
    cancelTranslation,
    ensureWorkspaceRoute,
    queryClient,
    setPinned,
    setOcrTextInput,
    setOcrLoading,
    setResultFromHistory,
    setResultSnapshot,
    setResultFromTranslation,
    setStatus,
    setTranslating,
    showError,
  ]);

  return (
    <main className={hideHeader ? "app-frame app-frame-no-header" : "app-frame"}>
      {hideHeader ? null : (
        <header className="app-header">
          <div className="app-title-lockup">
            <h1>SnapText</h1>
          </div>
          <TabsNav>
            <TabsLink to="/">
              <Home size={15} />
              {labels.home}
            </TabsLink>
            <TabsLink to="/history">
              <History size={15} />
              {labels.history}
            </TabsLink>
            <TabsLink to="/settings">
              <Settings size={15} />
              {labels.settings}
            </TabsLink>
          </TabsNav>
        </header>
      )}
      <div className="app-content">
        <Outlet />
      </div>
      <ToastViewport>
        {workspace.toasts.map((toast) => (
          <Toast key={toast.id} className="relative pr-10" variant={toast.variant}>
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
            <ToastClose onClick={() => workspace.dismissToast(toast.id)} />
          </Toast>
        ))}
      </ToastViewport>
    </main>
  );
}
