import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkOcrWorker,
  clearHistory,
  getConfig,
  getDesktopCapabilities,
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
  desktopCapabilities: ["desktop-capabilities"] as const,
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

export function useDesktopCapabilitiesQuery(enabled = false) {
  return useQuery({
    queryKey: queryKeys.desktopCapabilities,
    queryFn: getDesktopCapabilities,
    enabled,
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
    mutationFn: ({ sourceText, targetLang }: { sourceText: string; targetLang?: string }) =>
      translateText(sourceText, targetLang),
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

export function useCheckOcrWorkerMutation() {
  return useMutation({
    mutationFn: checkOcrWorker,
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
