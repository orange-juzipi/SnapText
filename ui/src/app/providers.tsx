import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { queryClient } from "@/app/query-client";
import { WorkspaceStateProvider } from "@/app/workspace-state";
import { useConfigQuery } from "@/lib/queries";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <WorkspaceStateProvider>{children}</WorkspaceStateProvider>
    </QueryClientProvider>
  );
}

function ThemeSync() {
  const configQuery = useConfigQuery();

  useEffect(() => {
    document.documentElement.dataset.theme = configQuery.data?.ui.theme?.trim() || "system";
  }, [configQuery.data?.ui.theme]);

  return null;
}
