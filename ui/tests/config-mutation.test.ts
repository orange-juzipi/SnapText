import { expect, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createConfigMutationOptions } from "../src/lib/config-mutation";
import type { AppConfig } from "../src/lib/types";

/** 构造手动完成的持久化结果，用于确定性控制跨页面响应顺序。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** 本测试只关心完整配置快照的缓存身份，省略不会被访问的服务商字段。 */
function config(language: string): AppConfig {
  return { ui: { language } } as AppConfig;
}

/** 模拟两个设置入口连续保存，旧成功不能覆盖较新的乐观编辑。 */
test("serializes saves across observers and keeps the newest draft visible", async () => {
  const client = new QueryClient();
  client.setQueryData(["config"], config("initial"));
  const first = deferred<AppConfig>();
  const second = deferred<AppConfig>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const secondPublished = deferred<void>();
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (client.getQueryData<AppConfig>(["config"])?.ui.language === "second") secondPublished.resolve();
  });
  const saved: string[] = [];
  /** 记录真正进入原生写入的顺序。 */
  const persist = (value: AppConfig) => {
    saved.push(value.ui.language);
    if (value.ui.language === "first") { firstStarted.resolve(); return first.promise; }
    secondStarted.resolve();
    return second.promise;
  };
  const a = new MutationObserver(client, createConfigMutationOptions(client, persist));
  const b = new MutationObserver(client, createConfigMutationOptions(client, persist));
  const promiseA = a.mutate(config("first"));
  await firstStarted.promise;
  const promiseB = b.mutate(config("second"));
  await secondPublished.promise;
  expect(client.getQueryData<AppConfig>(["config"])?.ui.language).toBe("second");
  expect(saved).toEqual(["first"]);
  first.resolve(config("first-normalized"));
  await promiseA;
  await secondStarted.promise;
  expect(client.getQueryData<AppConfig>(["config"])?.ui.language).toBe("second");
  second.resolve(config("second-normalized"));
  await promiseB;
  expect(saved).toEqual(["first", "second"]);
  expect(client.getQueryData<AppConfig>(["config"])?.ui.language).toBe("second-normalized");
  unsubscribe();
  client.clear();
});

/** 连续失败时回退到已持久化配置，而不是前一份失败的乐观草稿。 */
test("rolls back consecutive failures to the last confirmed configuration", async () => {
  const client = new QueryClient();
  client.setQueryData(["config"], config("confirmed"));
  const failure = deferred<AppConfig>();
  const started = deferred<void>();
  /** 第一份草稿保持未决，确保第二份草稿进入同一个保存队列。 */
  const persist = (value: AppConfig) => {
    if (value.ui.language === "first") { started.resolve(); return failure.promise; }
    return Promise.reject(new Error("second save failed"));
  };
  const a = new MutationObserver(client, createConfigMutationOptions(client, persist));
  const b = new MutationObserver(client, createConfigMutationOptions(client, persist));
  const promiseA = a.mutate(config("first")).catch(() => undefined);
  await started.promise;
  const promiseB = b.mutate(config("second")).catch(() => undefined);
  failure.reject(new Error("first save failed"));
  await Promise.all([promiseA, promiseB]);
  expect(client.getQueryData<AppConfig>(["config"])?.ui.language).toBe("confirmed");
  client.clear();
});
