import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/app/query-client";
import { WorkspaceStateProvider } from "@/app/workspace-state";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceStateProvider>{children}</WorkspaceStateProvider>
    </QueryClientProvider>
  );
}
