export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- 管理密钥 ----------

const KEY_STORAGE = "cpa-dashboard.management-key";

export function storedKey(): string {
  return sessionStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(KEY_STORAGE) ?? "";
}

// 默认只保存在当前标签页,勾选记住后才写入 localStorage
export function saveKey(key: string, remember: boolean) {
  clearKey();
  (remember ? localStorage : sessionStorage).setItem(KEY_STORAGE, key);
}

export function clearKey() {
  sessionStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(KEY_STORAGE);
}

// 管理接口带管理密钥;/v1 接口只认客户端 Key,每次现取配置里的第一个,没配置时 CPA 不校验
async function withAuth(path: string, headers?: HeadersInit): Promise<Headers> {
  const out = new Headers(headers);
  if (path.startsWith("/v0/management")) {
    out.set("Authorization", `Bearer ${storedKey()}`);
  } else if (path.startsWith("/v1/") && !out.has("Authorization")) {
    const key = (await api<{ "api-keys"?: string[] }>("/v0/management/api-keys"))["api-keys"]?.[0];
    if (key) out.set("Authorization", `Bearer ${key}`);
  }
  return out;
}

// ---------- 请求 ----------

type Init = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

export async function request(path: string, { body, raw, headers, ...init }: Init = {}): Promise<Response> {
  const isJson = body !== undefined && !raw;
  const h = await withAuth(path, headers);
  if (isJson) h.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers: h, body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined) });
}

// CPA 的错误格式是 {error, message?}
async function toError(res: Response): Promise<ApiError> {
  const type = res.headers.get("content-type") ?? "";
  const data: unknown = type.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const text = typeof data === "string" ? data.trim() : "";
  const message = String(record?.message ?? record?.error ?? "") || text || `请求失败（${res.status}）`;
  return new ApiError(res.status, message);
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

// ---------- 下载 ----------

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 用 fetch 下载而不是 <a href>,要带管理密钥
export async function download(path: string, fallbackName: string) {
  const res = await request(path);
  if (!res.ok) throw await toError(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  saveBlob(await res.blob(), name ? decodeURIComponent(name) : fallbackName);
}
