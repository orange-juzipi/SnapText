import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import { OverlayApp } from "@/components/overlay/overlay-app";
import { ResultWindowApp } from "@/components/result-window/result-window-app";
import { currentWindowKind } from "@/lib/tauri";
import "@/styles/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

const windowKind = currentWindowKind();
document.body.className = `snaptext-window-${windowKind}`;

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      {windowKind === "overlay" ? (
        <OverlayApp />
      ) : windowKind === "result" ? (
        <ResultWindowApp />
      ) : (
        <RouterProvider router={router} />
      )}
    </AppProviders>
  </StrictMode>,
);
