import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers";
import { currentWindowKind } from "@/lib/tauri";
import "@/styles/globals.css";

// 每个原生窗口仅加载自己的界面，截图窗口无需解析完整设置和历史页面。
const MainApp = lazy(() => import("@/app/router").then((module) => ({ default: module.MainApp })));
const OverlayApp = lazy(() => import("@/components/overlay/overlay-app").then((module) => ({ default: module.OverlayApp })));
const ResultWindowApp = lazy(() => import("@/components/result-window/result-window-app").then((module) => ({ default: module.ResultWindowApp })));

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const windowKind = currentWindowKind();
document.body.className = `snaptext-window-${windowKind}`;

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <Suspense fallback={null}>
      {windowKind === "overlay" ? (
        <OverlayApp />
      ) : windowKind === "result" ? (
        <ResultWindowApp />
      ) : (
        <MainApp />
      )}
      </Suspense>
    </AppProviders>
  </StrictMode>,
);
