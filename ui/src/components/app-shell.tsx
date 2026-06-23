import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Home, History, Settings } from "lucide-react";
import { useCallback, useEffect } from "react";
import { queryKeys, useConfigQuery, useUpdateConfigMutation } from "@/lib/queries";
import { labelsForLanguage } from "@/lib/labels";
import { AUTO_SOURCE_LANG, normalizeTargetLang, resolveSourceLang } from "@/lib/language";
import { errorMessage } from "@/lib/errors";
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

export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hideHeader = pathname === "/settings";
  const configQuery = useConfigQuery();
  const updateConfig = useUpdateConfigMutation();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const workspace = useWorkspaceState();
  const {
    setOcrTextInput,
    setPinned,
    setResultFromHistory,
    setResultSnapshot,
    setResultFromTranslation,
    setOcrLoading,
    setStatus,
    setTranslating,
    showError,
    clearResult,
    sourceLang,
    targetLang,
  } = workspace;

  const ensureWorkspaceRoute = useCallback(() => {
    // Capture and selection flows update the workspace panels, so surface them immediately.
    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  }, [navigate, pathname]);

  useEffect(() => {
    const config = configQuery.data;
    if (!config || updateConfig.isPending) return;

    const shouldUpdateTargetLang = !config.target_lang?.trim() || config.target_lang?.trim() === "auto";
    const shouldUpdateProvider = !isVisibleProvider(config.translator.provider);
    if (!shouldUpdateTargetLang && !shouldUpdateProvider) return;

    // Keep stale persisted desktop config aligned without changing explicit endpoint choices.
    updateConfig
      .mutateAsync({
        ...config,
        target_lang: shouldUpdateTargetLang ? "en" : config.target_lang,
        translator: {
          ...config.translator,
          provider: shouldUpdateProvider ? "snaptext_cloud" : config.translator.provider,
        },
      })
      .catch((error) => {
        showError(errorMessage(error));
      });
  }, [configQuery.data, showError, updateConfig]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    const register = <T,>(listener: Promise<() => void>) => {
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
      setResultFromTranslation(event.payload);
      setStatus(labels.regionTranslated);
    }));
    register(tauriListen<HistoryRecord>(events.resultSelection, (event) => {
      ensureWorkspaceRoute();
      setResultFromHistory(event.payload);
      setStatus(labels.textTranslated);
    }));
    register(tauriListen<SelectionTextPayload>(events.selectionText, (event) => {
      const sourceText = event.payload.text;
      ensureWorkspaceRoute();
      setOcrLoading(false);
      setOcrTextInput(sourceText, "selection");
      setStatus(labels.selectionTextExtracted);
      setTranslating(true);
      translateText(sourceText, normalizeTargetLang(targetLang), resolveSourceLang(sourceText, sourceLang) ?? AUTO_SOURCE_LANG)
        .then((record) => {
          setResultSnapshot({ ...record, source: "selection" });
          setStatus(labels.textTranslated);
          void queryClient.invalidateQueries({ queryKey: queryKeys.history(), exact: false });
        })
        .catch((error) => {
          showError(errorMessage(error));
        })
        .finally(() => setTranslating(false));
    }));
    register(tauriListen<SelectionFailurePayload>(events.resultSelectionFailed, (event) => {
      ensureWorkspaceRoute();
      setTranslating(false);
      setOcrLoading(false);
      showError(errorMessage(event.payload.message));
    }));
    register(tauriListen(events.overlayOcrStarted, () => {
      ensureWorkspaceRoute();
      setOcrLoading(true);
      setTranslating(false);
      setStatus(labels.ocrSelectedRegion);
    }));
    register(tauriListen(events.overlayOcrFailed, () => {
      setOcrLoading(false);
      setTranslating(false);
    }));
    register(tauriListen<OverlayOcrPayload>(events.overlayOcr, (event) => {
      const sourceText = event.payload.result.source_text;
      setOcrLoading(false);
      setOcrTextInput(sourceText, "screenshot");
      setStatus(labels.ocrTextExtracted);
      setTranslating(true);
      translateText(sourceText, normalizeTargetLang(targetLang), resolveSourceLang(sourceText, sourceLang) ?? AUTO_SOURCE_LANG)
        .then((record) => {
          setResultSnapshot({ ...record, source: "screenshot" });
          setStatus(labels.regionTranslated);
          void queryClient.invalidateQueries({ queryKey: queryKeys.history(), exact: false });
        })
        .catch((error) => {
          showError(errorMessage(error));
        })
        .finally(() => setTranslating(false));
    }));
    register(tauriListen<boolean>(events.resultWindowState, (event) => {
      setPinned(Boolean(event.payload));
    }));
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    labels.regionTranslated,
    labels.textTranslated,
    labels.selectionTextExtracted,
    labels.ocrSelectedRegion,
    labels.ocrTextExtracted,
    clearResult,
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
    sourceLang,
    targetLang,
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

function isVisibleProvider(provider?: string) {
  return provider === "snaptext_cloud" || provider === "deepl" || provider === "google";
}
