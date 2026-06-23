import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearHistory,
  getConfig,
  getHistory,
  pinResultWindow,
  retranslateResultText,
  translateImageBase64,
  translateText,
  updateConfig,
  validateOcrModels,
} from "@/lib/api";

export const queryKeys = {
  config: ["config"] as const,
  history: (limit = 50) => ["history", limit] as const,
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
    mutationFn: translateImageBase64,
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
