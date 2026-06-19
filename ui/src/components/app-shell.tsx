import { Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Home, History, Settings } from "lucide-react";
import { useEffect } from "react";
import { queryKeys, useConfigQuery, useUpdateConfigMutation } from "@/lib/queries";
import { labelsForLanguage } from "@/lib/labels";
import { clientSnapTextCloudEndpoint, sameEndpoint } from "@/lib/snaptext-cloud";
import { translateText } from "@/lib/api";
import { TabsLink, TabsNav } from "@/components/ui/tabs";
import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { useWorkspaceState } from "@/app/workspace-state";
import { events } from "@/lib/api";
import { tauriListen } from "@/lib/tauri";
import type { HistoryRecord, OverlayOcrPayload, TranslationResult } from "@/lib/types";

export function AppShell() {
  const queryClient = useQueryClient();
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
    setTargetLang,
    setTranslating,
    showError,
    targetLang,
  } = workspace;

  useEffect(() => {
    // The home page target picker follows the saved desktop config, with English as the empty fallback.
    setTargetLang(configQuery.data?.target_lang?.trim() || "en");
  }, [configQuery.data?.target_lang, setTargetLang]);

  useEffect(() => {
    const config = configQuery.data;
    if (!config || updateConfig.isPending) return;

    const endpoint = clientSnapTextCloudEndpoint();
    if (sameEndpoint(config.translator.snaptext_cloud.endpoint, endpoint)) return;

    // Keep stale persisted desktop config aligned with the hidden client environment.
    updateConfig
      .mutateAsync({
        ...config,
        translator: {
          ...config.translator,
          snaptext_cloud: {
            ...config.translator.snaptext_cloud,
            endpoint,
          },
        },
      })
      .catch((error) => {
        showError(error instanceof Error ? error.message : String(error));
      });
  }, [configQuery.data, showError, updateConfig]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    tauriListen<TranslationResult>(events.resultTranslation, (event) => {
      setResultFromTranslation(event.payload);
      setStatus(labels.regionTranslated);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen<HistoryRecord>(events.resultSelection, (event) => {
      setResultFromHistory(event.payload);
      setStatus(labels.textTranslated);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen(events.overlayOcrStarted, () => {
      setOcrLoading(true);
      setTranslating(false);
      setStatus(labels.ocrSelectedRegion);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen(events.overlayOcrFailed, () => {
      setOcrLoading(false);
      setTranslating(false);
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen<OverlayOcrPayload>(events.overlayOcr, (event) => {
      const sourceText = event.payload.result.source_text;
      setOcrLoading(false);
      setOcrTextInput(sourceText, "screenshot");
      setStatus(labels.ocrTextExtracted);
      setTranslating(true);
      translateText(sourceText, targetLang)
        .then((record) => {
          setResultSnapshot({ ...record, source: "screenshot" });
          setStatus(labels.regionTranslated);
          void queryClient.invalidateQueries({ queryKey: queryKeys.history(), exact: false });
        })
        .catch((error) => {
          showError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => setTranslating(false));
    }).then((unlisten) => unlisteners.push(unlisten));
    tauriListen<boolean>(events.resultWindowState, (event) => {
      setPinned(Boolean(event.payload));
    }).then((unlisten) => unlisteners.push(unlisten));
    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [
    labels.regionTranslated,
    labels.textTranslated,
    labels.ocrSelectedRegion,
    labels.ocrTextExtracted,
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
    targetLang,
  ]);

  return (
    <main className="app-frame">
      <header className="app-header">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight sm:text-xl">SnapText</h1>
          <p className="mt-1 text-sm text-muted-foreground">{labels.subtitle}</p>
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
      <Outlet />
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
