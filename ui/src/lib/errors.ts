export function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return formatUserError(raw);
}

export function formatUserError(message: string) {
  const raw = message.trim();
  const parsed = parseProviderError(raw);
  if (parsed) return parsed;

  if (raw.includes("local SnapText Cloud debug service is unavailable")) {
    return "本地调试源不可用：请启动本地翻译服务，或切回线上 SnapText 官方源后重启应用。";
  }

  if (raw.includes("provider failed with HTTP")) {
    return "翻译服务暂时不可用，请稍后重试或切换翻译服务。";
  }

  if (raw.includes("HTTP 502 Bad Gateway")) {
    return "翻译服务暂时不可用，请稍后重试或切换翻译服务。";
  }

  if (raw.includes("HTTP 504 Gateway Timeout")) {
    return "SnapText 官方源响应超时，请稍后重试。";
  }

  if (
    raw.includes("error sending request for url") &&
    (raw.includes("snaptext.uuidcx.com") || raw.includes("translate.snaptext.app"))
  ) {
    return "无法连接 SnapText 官方源，请检查网络后重试。";
  }

  if (raw.includes("missing OCR model files")) {
    return "OCR 模型文件缺失，请确认安装包已包含 det.onnx、cls.onnx、rec.onnx 和 rec_dict.txt。";
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
        return "本地调试源不可用：请启动本地翻译服务，或切回线上 SnapText 官方源后重启应用。";
      }
      return `翻译服务异常：${detail}`;
    }
  } catch {
    return "";
  }

  return "";
}
