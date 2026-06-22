export const SNAPTEXT_CLOUD_ENDPOINT = "https://snaptext.uuidcx.com";

export function clientSnapTextCloudEndpoint() {
  // 官方源默认固定，调试覆盖由桌面进程运行时处理。
  return SNAPTEXT_CLOUD_ENDPOINT;
}

export function sameEndpoint(left: string, right: string) {
  return normalizeEndpoint(left) === normalizeEndpoint(right);
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}
