import { api } from "@/lib/api";

export type Json = Record<string, unknown>;

export type Kind = {
  endpoint: string;
  label: string;
  openai?: boolean;
  baseUrlRequired?: boolean;
  // 支持走上游 WebSocket(Codex / xAI)
  websockets?: boolean;
};

export const KINDS: Kind[] = [
  { endpoint: "gemini-api-key", label: "Gemini" },
  { endpoint: "claude-api-key", label: "Claude" },
  { endpoint: "codex-api-key", label: "Codex", baseUrlRequired: true, websockets: true },
  { endpoint: "openai-compatibility", label: "OpenAI 兼容", openai: true },
  { endpoint: "vertex-api-key", label: "Vertex" },
  { endpoint: "xai-api-key", label: "xAI", baseUrlRequired: true, websockets: true },
  { endpoint: "meta-api-key", label: "Meta", websockets: true },
  { endpoint: "interactions-api-key", label: "Interactions" },
];

export type Form = {
  name: string;
  apiKey: string;
  keys: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  priority: string;
  headers: string;
  models: string;
  excluded: string;
  disabled: boolean;
  websockets: boolean;
};

type Model = { name: string; alias?: string } & Json;

export function str(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function list<T = Json>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function lines(text: string, splitComma = false): string[] {
  return text
    .split(splitComma ? /[\n,]/ : /\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ModelRow = { name: string; alias: string };

export function parseModelRows(text: string): ModelRow[] {
  return lines(text)
    .map((line) => {
      const parts = line.split("=>").map((part) => part.trim());
      return { name: parts[0] ?? "", alias: parts[1] ?? "" };
    })
    .filter((r) => r.name);
}

export function formatModelRows(rows: ModelRow[]): string {
  return rows
    .filter((r) => r.name.trim())
    .map((r) => {
      const name = r.name.trim();
      const alias = r.alias.trim();
      return alias && alias !== name ? `${name} => ${alias}` : name;
    })
    .join("\n");
}

const KIND_CHANNEL_MAP: Record<string, string[]> = {
  "claude-api-key": ["claude"],
  "codex-api-key": ["codex"],
  "gemini-api-key": ["gemini-cli", "aistudio"],
  "vertex-api-key": ["vertex"],
  "xai-api-key": ["xai"],
  "meta-api-key": ["meta"],
};

export async function fetchProviderModels(
  kind: Kind,
  baseUrl: string,
  apiKey: string,
  headersText = "",
): Promise<string[]> {
  const models = new Set<string>();
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");

  // 1. 若填写了 Base URL，仅向上游标准 /models 或 /v1/models 获取，不混入内置渠道定义
  if (cleanBase) {
    const customHeaders: Record<string, string> = {};
    const trimmedKey = apiKey.trim();

    if (trimmedKey) {
      customHeaders.Authorization = `Bearer ${trimmedKey}`;
      if (kind.endpoint === "claude-api-key") {
        customHeaders["x-api-key"] = trimmedKey;
      } else if (kind.endpoint === "gemini-api-key") {
        customHeaders["x-goog-api-key"] = trimmedKey;
      }
    }
    if (kind.endpoint === "claude-api-key") {
      customHeaders["anthropic-version"] = "2023-06-01";
    }

    // 用户填写的自定义 Header 具有最高优先级，覆盖默认值
    for (const line of lines(headersText)) {
      const i = line.indexOf(":");
      if (i > 0) customHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }

    const candidateUrls = cleanBase.endsWith("/models")
      ? [cleanBase]
      : cleanBase.endsWith("/v1")
        ? [`${cleanBase}/models`]
        : [`${cleanBase}/models`, `${cleanBase}/v1/models`];

    let lastError = "未返回任何模型";
    for (const url of candidateUrls) {
      // 走 CPA 的 /api-call 代理，避开浏览器 CORS
      const res = await api<{ status_code: number; body?: unknown }>("/v0/management/api-call", {
        method: "POST",
        body: { method: "GET", url, header: customHeaders },
      });
      if (res.status_code < 200 || res.status_code >= 300) {
        lastError = `上游返回 HTTP ${res.status_code}`;
        continue;
      }
      const body = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
      const items: unknown[] = Array.isArray(body) ? body : (body?.data ?? body?.models ?? []);
      for (const item of items) {
        const id = typeof item === "string" ? item : (item as Json)?.id || (item as Json)?.name;
        if (typeof id === "string" && id) models.add(id);
      }
      if (models.size > 0) return Array.from(models).sort();
    }
    throw new Error(`获取上游模型失败：${lastError}`);
  }

  // 2. 未填写 Base URL 时，使用 CPA 内置渠道的模型定义
  for (const ch of KIND_CHANNEL_MAP[kind.endpoint] ?? []) {
    const res = await api<{ models?: { id: string }[] }>(`/v0/management/model-definitions/${encodeURIComponent(ch)}`);
    for (const m of res.models ?? []) {
      if (m.id) models.add(m.id);
    }
  }
  return Array.from(models).sort();
}

export function mask(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
}

// 同一提供商下用 api-key + base-url 区分条目,OpenAI 兼容用 name
export function identity(kind: Kind, item: Json): string {
  return kind.openai ? str(item.name) : `${str(item["api-key"])}|${str(item["base-url"])}`;
}

export function toForm(item: Json): Form {
  return {
    name: str(item.name),
    apiKey: str(item["api-key"]),
    keys: list(item["api-key-entries"])
      .map((e) => str(e["api-key"]))
      .join("\n"),
    baseUrl: str(item["base-url"]),
    proxyUrl: str(item["proxy-url"]),
    prefix: str(item.prefix),
    priority: str(item.priority),
    headers: Object.entries((item.headers as Record<string, string> | undefined) ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    models: list<Model>(item.models)
      .map((m) => (m.alias && m.alias !== m.name ? `${m.name} => ${m.alias}` : m.name))
      .join("\n"),
    excluded: list<string>(item["excluded-models"]).join("\n"),
    disabled: item.disabled === true,
    websockets: item.websockets === true,
  };
}

// 在原条目上合并表单字段,表单不管的字段(cloak、模型的 display-name 等)原样保留
export function fromForm(kind: Kind, form: Form, original: Json): Json {
  const out: Json = { ...original };
  delete out["auth-index"];
  const set = (key: string, value: unknown) => {
    const empty =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" && value !== null && Object.keys(value).length === 0);
    if (empty) delete out[key];
    else out[key] = value;
  };

  if (kind.openai) {
    set("name", form.name.trim());
    const entries = new Map(list(original["api-key-entries"]).map((e) => [str(e["api-key"]), e]));
    set(
      "api-key-entries",
      lines(form.keys).map((key) => entries.get(key) ?? { "api-key": key }),
    );
    set("disabled", form.disabled || undefined);
  } else {
    set("api-key", form.apiKey.trim());
  }
  set("base-url", form.baseUrl.trim());
  set("proxy-url", form.proxyUrl.trim());
  set("prefix", form.prefix.trim());
  set("priority", form.priority.trim() ? Number(form.priority) : undefined);
  set(
    "headers",
    Object.fromEntries(
      lines(form.headers).map((line) => {
        const i = line.indexOf(":");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
    ),
  );
  const models = new Map(list<Model>(original.models).map((m) => [m.name, m]));
  set(
    "models",
    lines(form.models)
      .map((line) => line.split("=>").map((part) => part.trim()))
      .filter(([name]) => name)
      .map(([name, alias]) => {
        const model: Model = { ...models.get(name), name };
        if (alias) model.alias = alias;
        else delete model.alias;
        return model;
      }),
  );
  set("excluded-models", lines(form.excluded, true));
  if (kind.websockets) set("websockets", form.websockets || undefined);
  return out;
}

export function validate(kind: Kind, form: Form): string | null {
  if (kind.openai && !form.name.trim()) return "请填写名称";
  if (!kind.openai && !form.apiKey.trim()) return "请填写 API Key";
  if ((kind.openai || kind.baseUrlRequired) && !form.baseUrl.trim()) return "请填写 Base URL";
  if (form.priority.trim() && !/^-?\d+$/.test(form.priority.trim())) return "优先级必须是整数";
  if (lines(form.headers).some((l) => !l.includes(":"))) return "请求头每行格式为 名称: 值";
  return null;
}

export async function testProviderConnectivity(
  kind: Kind,
  form: Form,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  const cleanBase = form.baseUrl.trim().replace(/\/+$/, "");
  const customHeaders: Record<string, string> = {};
  for (const line of lines(form.headers)) {
    const i = line.indexOf(":");
    if (i > 0) customHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const modelRows = parseModelRows(form.models);
  const testModel = modelRows[0]?.name || "";

  let method = "POST";
  let url = "";
  let payload: unknown;

  if (kind.openai) {
    if (!cleanBase) throw new Error("测试连通性必须填写 Base URL");
    const firstKey = lines(form.keys)[0]?.trim() || "";
    if (firstKey) customHeaders.Authorization = `Bearer ${firstKey}`;
    customHeaders["Content-Type"] = "application/json";

    url = cleanBase.endsWith("/chat/completions")
      ? cleanBase
      : cleanBase.endsWith("/v1")
        ? `${cleanBase}/chat/completions`
        : `${cleanBase}/v1/chat/completions`;

    payload = {
      model: testModel || "gpt-4o-mini",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
      stream: false,
    };
  } else if (kind.endpoint === "claude-api-key") {
    const key = form.apiKey.trim();
    if (key) customHeaders["x-api-key"] = key;
    customHeaders["anthropic-version"] = "2023-06-01";
    customHeaders["Content-Type"] = "application/json";
    const host = cleanBase || "https://api.anthropic.com";
    url = host.endsWith("/messages") ? host : `${host}/v1/messages`;
    payload = {
      model: testModel || "claude-3-5-sonnet-20241022",
      max_tokens: 5,
      messages: [{ role: "user", content: "Hi" }],
    };
  } else if (kind.endpoint === "gemini-api-key" || kind.endpoint === "interactions-api-key") {
    const key = form.apiKey.trim();
    const host = cleanBase || "https://generativelanguage.googleapis.com";
    const m = testModel || "gemini-1.5-flash";
    url = `${host}/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    customHeaders["Content-Type"] = "application/json";
    payload = {
      contents: [{ parts: [{ text: "Hi" }] }],
    };
  } else if (kind.endpoint === "codex-api-key") {
    if (!cleanBase) throw new Error("Codex 必须填写 Base URL");
    const key = form.apiKey.trim();
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    url = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
    method = "GET";
  } else if (kind.endpoint === "xai-api-key") {
    if (!cleanBase) throw new Error("xAI 必须填写 Base URL");
    const key = form.apiKey.trim();
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    customHeaders["Content-Type"] = "application/json";
    url = cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/v1/chat/completions`;
    payload = {
      model: testModel || "grok-beta",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    };
  } else {
    if (!cleanBase) throw new Error("请填写 Base URL");
    const key = form.apiKey.trim();
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    url = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/v1/models`;
    method = "GET";
  }

  try {
    const res = await api<{ status_code: number; body?: unknown }>("/v0/management/api-call", {
      method: "POST",
      body: {
        method,
        url,
        header: customHeaders,
        ...(payload !== undefined ? { data: JSON.stringify(payload) } : {}),
      },
    });

    const latencyMs = Date.now() - start;
    if (res.status_code >= 200 && res.status_code < 300) {
      return { ok: true, latencyMs, message: `HTTP ${res.status_code} 正常 (${latencyMs}ms)` };
    }

    let detail = "";
    if (res.body) {
      try {
        const bodyObj = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
        detail = bodyObj?.error?.message || bodyObj?.message || String(res.body).slice(0, 100);
      } catch {
        detail = String(res.body).slice(0, 100);
      }
    }
    return { ok: false, latencyMs, message: `HTTP ${res.status_code}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, message: (err as Error)?.message || "连通性测试请求失败" };
  }
}
