export const SNAPTEXT_CLOUD_ENDPOINTS = {
  production: "https://snaptext.uuidcx.com",
  local: "http://127.0.0.1:8080",
} as const;

export function clientSnapTextCloudEndpoint() {
  return import.meta.env.VITE_SNAPTEXT_CLOUD_ENV === "local"
    ? SNAPTEXT_CLOUD_ENDPOINTS.local
    : SNAPTEXT_CLOUD_ENDPOINTS.production;
}

export function sameEndpoint(left: string, right: string) {
  return normalizeEndpoint(left) === normalizeEndpoint(right);
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}
