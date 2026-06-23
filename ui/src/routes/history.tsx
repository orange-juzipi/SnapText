import { useNavigate } from "@tanstack/react-router";
import { FileText, Trash2 } from "lucide-react";
import { historyItemMeta } from "@/lib/format";
import { labelsForLanguage } from "@/lib/labels";
import { useClearHistoryMutation, useConfigQuery, useHistoryQuery } from "@/lib/queries";
import { useWorkspaceState } from "@/app/workspace-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function HistoryPage() {
  const configQuery = useConfigQuery();
  const labels = labelsForLanguage(configQuery.data?.ui.language);
  const historyQuery = useHistoryQuery(50);
  const clearMutation = useClearHistoryMutation();
  const workspace = useWorkspaceState();
  const navigate = useNavigate();
  const items = historyQuery.data ?? [];
  const isClearDisabled = items.length === 0 || clearMutation.isPending;

  async function handleClear() {
    try {
      await clearMutation.mutateAsync();
      workspace.setStatus(labels.historyCleared);
    } catch (error) {
      workspace.showError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{labels.history}</CardTitle>
        {/* 历史列表为空或清空请求进行中时禁用按钮，避免重复清空操作。 */}
        <Button onClick={handleClear} variant="destructive" disabled={isClearDisabled}>
          <Trash2 size={16} />
          {labels.clear}
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="grid min-h-44 place-items-center rounded-lg border border-dashed border-border bg-secondary/35 p-6 text-center">
            <div>
              <FileText className="mx-auto mb-3 text-muted-foreground" size={28} />
              <strong className="text-sm">{labels.noHistoryTitle}</strong>
              <p className="mt-1 text-sm text-muted-foreground">{labels.noHistoryDescription}</p>
            </div>
          </div>
        ) : (
          <ol className="grid gap-3">
            {items.map((item) => (
              <li key={item.id} className="history-record rounded-lg border border-border bg-secondary/45 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Badge>{historyItemMeta(item, labels)}</Badge>
                  <Button
                    size="sm"
                    onClick={() => {
                      workspace.setResultFromHistory(item);
                      workspace.setStatus(`${labels.historyItemOpened}: ${item.source_text}`);
                      navigate({ to: "/" });
                    }}
                  >
                    {labels.open}
                  </Button>
                </div>
                <strong className="block text-sm">{item.source_text}</strong>
                <p className="mt-1 text-sm text-muted-foreground">{item.translated_text}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
