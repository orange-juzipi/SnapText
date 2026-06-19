import { emit, listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { WindowKind } from "@/lib/types";

declare global {
  interface Window {
    __SNAPTEXT_WINDOW?: WindowKind;
  }
}

export function currentWindowKind(): WindowKind {
  return window.__SNAPTEXT_WINDOW ?? "main";
}

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(tauriErrorToString(error));
  }
}

export async function tauriListen<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}

export async function tauriEmit<T>(event: string, payload?: T): Promise<void> {
  await emit(event, payload);
}

export async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is not available");
  }
  await navigator.clipboard.writeText(text);
}

export async function closeCurrentWindow() {
  await getCurrentWindow().close();
}

function tauriErrorToString(error: unknown) {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (kind && message) return `${kind}: ${message}`;
    if (message) return message;
    if (kind) return kind;
  }
  return "Tauri command failed";
}
