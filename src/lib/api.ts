export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Init = Omit<RequestInit, "body"> & { body?: unknown; raw?: boolean };

// 后端错误格式 {code, message};CPA 管理接口转发过来的错误格式是 {error}
export async function api<T>(path: string, { body, raw, headers, ...init }: Init = {}): Promise<T> {
  const isJson = body !== undefined && !raw;
  const res = await fetch(path, {
    ...init,
    headers: isJson ? { "Content-Type": "application/json", ...headers } : headers,
    body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
  });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const code = (data && typeof data === "object" && "code" in data && String(data.code)) || `http_${res.status}`;
    const message =
      (data && typeof data === "object" && ("message" in data ? data.message : "error" in data ? data.error : null)) ||
      (typeof data === "string" && data) ||
      `请求失败(${res.status})`;
    throw new ApiError(res.status, code, String(message));
  }
  return data as T;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.code === "unauthorized";
}
