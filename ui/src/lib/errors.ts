export function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return formatUserError(raw);
}

export function formatUserError(message: string) {
  const raw = message.trim();
  const parsed = parseProviderError(raw);
  if (parsed) return parsed;

  if (raw.includes("local SnapText Cloud debug service is unavailable")) {
    return "本地调试源不可用：请启动本地翻译服务，或切回线上 SnapText 免费源后重启应用。";
  }

  if (raw.includes("provider failed with HTTP")) {
    return "翻译服务暂时不可用，请稍后重试或切换翻译服务。";
  }

  if (raw.includes("HTTP 502 Bad Gateway")) {
    return "翻译服务暂时不可用，请稍后重试或切换翻译服务。";
  }

  return raw;
}

function parseProviderError(message: string) {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) return "";

  try {
    const payload = JSON.parse(message.slice(jsonStart));
    const detail = payload?.error?.message;
    if (typeof detail === "string") {
      if (detail.includes("localhost:11434")) {
        return "本地调试源不可用：请启动本地翻译服务，或切回线上 SnapText 免费源后重启应用。";
      }
      return `翻译服务异常：${detail}`;
    }
  } catch {
    return "";
  }

  return "";
}
