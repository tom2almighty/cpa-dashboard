import i18n from "@/i18n";

// code 为 CPA 返回的 error 字段(如 not_found、plugin_delete_requires_restart),便于按错误类型分支处理
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- CPA 服务地址与管理密钥 ----------

const KEY_STORAGE = "cpa-dashboard.management-key";
const BASE_STORAGE = "cpa-dashboard.api-base";

export function normalizeBaseUrl(input: string): string {
  let base = (input || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  base = base.replace(/\/?v8\/management\/?$/i, "");
  base = base.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

export function storedBaseUrl(): string {
  return localStorage.getItem(BASE_STORAGE) ?? sessionStorage.getItem(BASE_STORAGE) ?? "";
}

export function saveBaseUrl(base: string, remember = true) {
  const normalized = normalizeBaseUrl(base);
  if (normalized) {
    (remember ? localStorage : sessionStorage).setItem(BASE_STORAGE, normalized);
  } else {
    localStorage.removeItem(BASE_STORAGE);
    sessionStorage.removeItem(BASE_STORAGE);
  }
}

export function clearBaseUrl() {
  sessionStorage.removeItem(BASE_STORAGE);
  localStorage.removeItem(BASE_STORAGE);
}

export function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = storedBaseUrl();
  if (!base) return path;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function storedKey(): string {
  return sessionStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(KEY_STORAGE) ?? "";
}

// 默认只保存在当前标签页,勾选记住后才写入 localStorage(明文)
export function saveKey(key: string, remember: boolean) {
  clearKey();
  (remember ? localStorage : sessionStorage).setItem(KEY_STORAGE, key);
}

// 替换密钥时沿用原来的存储位置
export function replaceKey(key: string) {
  saveKey(key, localStorage.getItem(KEY_STORAGE) !== null);
}

export function clearKey() {
  sessionStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(KEY_STORAGE);
}
// 管理接口带管理密钥;/v1 等接口由调用方自行传 Authorization
function withAuth(path: string, headers?: HeadersInit): Headers {
  const out = new Headers(headers);
  if (path.includes("/v8/management")) out.set("Authorization", `Bearer ${storedKey()}`);
  return out;
}

// ---------- 请求 ----------

type Init = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

export async function request(path: string, { body, raw, headers, ...init }: Init = {}): Promise<Response> {
  const isJson = body !== undefined && !raw;
  const url = resolveUrl(path);
  const h = withAuth(url, headers);
  if (isJson) h.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers: h, body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined) });
}

// CPA 的错误格式是 {error, message?}
async function toError(res: Response): Promise<ApiError> {
  const type = res.headers.get("content-type") ?? "";
  const data: unknown = type.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const text = typeof data === "string" ? data.trim() : "";
  const code = typeof record?.error === "string" ? record.error : "";
  const message =
    String(record?.message ?? record?.error ?? "") ||
    text ||
    i18n.t("common.request_failed_status", { status: res.status });
  return new ApiError(res.status, message, code);
}

export async function api<T>(path: string, init?: Init): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) throw await toError(res);
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? await res.json() : await res.text()) as T;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// CPA 返回的错误码(见 v8 文档「错误响应」)对应的文案 key,其余码沿用服务端 message
const ERROR_KEYS: Record<string, string> = {
  "remote management disabled": "api_error.remote_management_disabled",
  "core auth manager unavailable": "api_error.auth_manager_unavailable",
  "logging to file disabled": "api_error.logging_to_file_disabled",
  "unknown channel": "api_error.unknown_channel",
  "auth not found": "api_error.auth_not_found",
  "quota provider not found for plugin": "api_error.no_quota_provider",
  "quota provider did not handle reset request": "api_error.no_quota_provider",
  cannot_delete_config: "api_error.cannot_delete_config",
  invalid_config: "api_error.invalid_config",
  invalid_yaml: "api_error.invalid_yaml",
  provider_not_found: "api_error.provider_not_found",
  read_only_field: "api_error.read_only_field",
  plugin_delete_requires_restart: "api_error.delete_requires_restart",
  plugin_update_requires_restart: "api_error.update_requires_restart",
  plugin_store_source_conflict: "api_error.store_source_conflict",
  plugin_store_installed_source_unknown: "api_error.store_installed_source_unknown",
  plugin_store_rate_limited: "api_error.store_rate_limited",
};

/** 把 CPA 的错误码翻成文案,没有覆盖到的码直接用服务端 message */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const key = ERROR_KEYS[error.code];
  return key ? i18n.t(key, { message: error.message }) : error.message;
}

// 读取可能不存在的配置节点:只有 404 视为空值,其它错误照常抛出,避免读失败后整体覆盖写
export function orNotFound<T>(fallback: T) {
  return (error: unknown): T => {
    if (isNotFound(error)) return fallback;
    throw error;
  };
}

// ---------- v8 配置 ----------

// 所有配置读取共用这一份 GET /config 缓存,各页用 select 取子树;写入后 invalidate CONFIG_KEY 前缀即可
export const CONFIG_KEY = ["config"] as const;
export const configQuery = {
  queryKey: CONFIG_KEY,
  queryFn: () => api<Record<string, unknown>>("/v8/management/config"),
};

// 配置路径段是 YAML 键,逐段编码
export function configPath(...segments: string[]): string {
  return `/v8/management/config/${segments.map(encodeURIComponent).join("/")}`;
}

// ---------- 下载 ----------

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 用 fetch 取文件而不是 <a href>,要带管理密钥
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await request(path);
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export async function download(path: string, fallbackName: string) {
  const res = await request(path);
  if (!res.ok) throw await toError(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  saveBlob(await res.blob(), name ? decodeURIComponent(name) : fallbackName);
}
