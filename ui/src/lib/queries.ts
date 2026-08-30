import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearHistory,
  deleteHistory,
  getConfig,
  getHistory,
  searchHistory,
  pinResultWindow,
  retranslateResultText,
  translateImageBase64,
  translateText,
  updateConfig,
  validateOcrModels,
} from "@/lib/api";
import type { ImagePreprocessOptions, Region } from "@/lib/types";

export const queryKeys = {
  config: ["config"] as const,
  history: (limit = 50) => ["history", limit] as const,
  historySearch: (query = "", source = "", from = "", to = "", limit = 50) =>
    ["history", "search", query, source, from, to, limit] as const,
};

export function useConfigQuery() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: getConfig,
  });
}

export function useHistoryQuery(limit = 50) {
  return useQuery({
    queryKey: queryKeys.history(limit),
    queryFn: () => getHistory(limit),
  });
}

/** Queries filtered local history for the history page. */
/** Queries filtered local history using text, source, and optional epoch-millisecond bounds. */
export function useSearchHistoryQuery(
  query: string,
  source: string,
  from?: number,
  to?: number,
  limit = 50,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: queryKeys.historySearch(query, source, from?.toString(), to?.toString(), limit),
    queryFn: () => searchHistory(query || undefined, source || undefined, from, to, limit),
  });
}

export function useUpdateConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.config, config);
    },
  });
}

export function useTranslateTextMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceText, targetLang, sourceLang }: { sourceText: string; targetLang?: string; sourceLang?: string }) =>
      translateText(sourceText, targetLang, sourceLang),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"], exact: false });
    },
  });
}

export function useTranslateImageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      /** Image data URL or raw base64 payload. */
      base64Png: string;
      /** Optional crop in source-image pixels. */
      bbox?: Region;
      /** Optional OCR preprocessing profile. */
      preprocessOptions?: ImagePreprocessOptions;
    }) => translateImageBase64(input.base64Png, input.bbox, input.preprocessOptions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"], exact: false });
    },
  });
}

export function useRetranslateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retranslateResultText,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"], exact: false });
    },
  });
}

export function useClearHistoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"], exact: false });
    },
  });
}

/** Deletes one history item and refreshes every history query. */
export function useDeleteHistoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteHistory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["history"], exact: false });
    },
  });
}

export function useValidateModelsMutation() {
  return useMutation({
    mutationFn: validateOcrModels,
  });
}

export function usePinResultMutation() {
  return useMutation({
    mutationFn: pinResultWindow,
  });
}
