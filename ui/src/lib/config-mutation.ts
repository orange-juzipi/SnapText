import type { QueryClient } from "@tanstack/react-query";
import type { AppConfig } from "@/lib/types";

type ConfigSaveState = {
  /** 最新提交的编辑版本。 */
  version: number;
  /** 尚未完成的提交数量，包含同一作用域内排队的提交。 */
  pending: number;
  /** 最近确认写入原生配置的值，用于最终提交失败时回退。 */
  confirmed: AppConfig | undefined;
};

type ConfigSaveContext = {
  /** 当前提交所拥有的乐观缓存版本。 */
  version: number;
};

const saveStates = new WeakMap<QueryClient, ConfigSaveState>();

/** 为同一 QueryClient 中的所有设置入口提供共享写入顺序和乐观缓存。 */
export function createConfigMutationOptions(
  queryClient: QueryClient,
  persist: (config: AppConfig) => Promise<AppConfig>,
) {
  let state = saveStates.get(queryClient);
  if (!state) {
    state = { version: 0, pending: 0, confirmed: undefined };
    saveStates.set(queryClient, state);
  }
  const saves = state;
  const queryKey = ["config"] as const;
  return {
    scope: { id: "config" },
    mutationFn: persist,
    /** 在等待原生写入前发布最新草稿，使切换页面后的编辑基于新值。 */
    async onMutate(config: AppConfig): Promise<ConfigSaveContext> {
      if (saves.pending === 0) saves.confirmed = queryClient.getQueryData<AppConfig>(queryKey);
      const version = ++saves.version;
      saves.pending += 1;
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (version === saves.version) queryClient.setQueryData(queryKey, config);
      return { version };
    },
    /** 老提交可以更新回退基线，但不能覆盖更新的乐观草稿。 */
    onSuccess(config: AppConfig, _submitted: AppConfig, context: ConfigSaveContext | undefined) {
      saves.confirmed = config;
      if (context?.version === saves.version) queryClient.setQueryData(queryKey, config);
    },
    /** 最新提交失败时恢复最近成功保存的配置，避免恢复另一个失败草稿。 */
    onError(_error: Error, _submitted: AppConfig, context: ConfigSaveContext | undefined) {
      if (context?.version !== saves.version) return;
      if (saves.confirmed) queryClient.setQueryData(queryKey, saves.confirmed);
      else queryClient.removeQueries({ queryKey, exact: true });
    },
    /** 完成的提交不再参与下一批编辑的回退基线计算。 */
    onSettled() {
      saves.pending = Math.max(0, saves.pending - 1);
    },
  };
}
