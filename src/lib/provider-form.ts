import i18n from "@/i18n";
import { api } from "@/lib/api";

export type Json = Record<string, unknown>;

export type Kind = {
  endpoint: string;
  label: string;
  openai?: boolean;
  baseUrlRequired?: boolean;
  websockets?: boolean;
  /** 键级支持 cloak.mode(仅官方 Claude API key) */
  cloak?: boolean;
  /**
   * 只有键级 proxy-url,没有分组级。
   * openai-compatibility 的 Go 结构体没有分组代理字段,分组级写进去会被静默丢弃。
   */
  perKeyProxyOnly?: boolean;
};

export const KINDS: Kind[] = [
  { endpoint: "gemini", label: "Gemini" },
  { endpoint: "claude", label: "Claude", cloak: true },
  { endpoint: "codex", label: "Codex", baseUrlRequired: true, websockets: true },
  {
    endpoint: "openai-compatibility",
    get label() {
      return i18n.t("provider_form.openai_compat");
    },
    openai: true,
    perKeyProxyOnly: true,
  },
  { endpoint: "vertex", label: "Vertex" },
  { endpoint: "xai", label: "xAI", baseUrlRequired: true, websockets: true },
  { endpoint: "meta", label: "Meta" },
  { endpoint: "interactions", label: "Interactions" },
];

// /observability/usage/api-keys 的分组名:OpenAI 兼容按名称(小写),interactions 用运行时 provider 名
export function usageGroup(kind: Kind, item: Json): string {
  if (kind.openai) return str(item.name).trim().toLowerCase();
  return kind.endpoint === "interactions" ? "gemini-interactions" : kind.endpoint;
}

export type ProviderKey = {
  "api-key": string;
  weight?: number;
  "proxy-url"?: string;
  websockets?: boolean;
  cloak?: { mode?: string } & Json;
};

// 键级字段:weight 决定加权轮询份额,proxy-url 覆盖分组代理,websockets 仅个别渠道支持
export type KeyRow = {
  id: string;
  "api-key": string;
  weight: string;
  "proxy-url": string;
  websockets: boolean;
  cloakMode: string;
};

export type Form = {
  name: string;
  keys: KeyRow[];
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  priority: string;
  headers: string;
  models: string;
  excluded: string;
  // 三态:空串表示不配置(继承全局)
  disableCooling: "" | "true" | "false";
  requestRetry: string;
};

export type Model = { name: string; alias?: string } & Json;

// 按渠道可选的键级 cloak.mode,空串表示继承
export const CLOAK_MODES = ["", "auto", "always", "never"] as const;

export function newKeyRow(): KeyRow {
  return {
    id: Math.random().toString(36).slice(2),
    "api-key": "",
    weight: "",
    "proxy-url": "",
    websockets: false,
    cloakMode: "",
  };
}

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
      // 别名与原名相同也保留(Vertex 模型必须有别名)
      return alias ? `${name} => ${alias}` : name;
    })
    .join("\n");
}

/** 额外请求头的键值对;value 以 $ 开头时 CPA 会从下游请求复制同名头 */
export type HeaderRow = { id: string; key: string; value: string };

export function newHeaderRow(key = "", value = ""): HeaderRow {
  return { id: Math.random().toString(36).slice(2), key, value };
}

export function parseHeaderRows(text: string): HeaderRow[] {
  return lines(text)
    .map((line) => {
      const i = line.indexOf(":");
      return i > 0 ? newHeaderRow(line.slice(0, i).trim(), line.slice(i + 1).trim()) : null;
    })
    .filter((r): r is HeaderRow => r !== null);
}

/** 空的 key 会被丢弃;value 允许为空(与 CPA 的 map 语义一致) */
export function formatHeaderRows(rows: HeaderRow[]): string {
  return rows
    .filter((r) => r.key.trim())
    .map((r) => `${r.key.trim()}: ${r.value.trim()}`)
    .join("\n");
}

/** 解析成写入配置的 headers map;无有效项时返回空对象(调用方据此删除该字段) */
export function headersFromText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const KIND_CHANNEL_MAP: Record<string, string[]> = {
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini", "aistudio"],
  interactions: ["gemini-interactions"],
  vertex: ["vertex"],
  xai: ["xai"],
  meta: ["meta"],
};

// 上游模型列表格式不一(数组、{data: [...]}、{models: [...]});非 JSON 内容返回空数组
function upstreamModelIds(payload: unknown): string[] {
  let entries: unknown[] = [];
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (payload && typeof payload === "object") {
    const data = "data" in payload ? payload.data : undefined;
    const models = "models" in payload ? payload.models : undefined;
    if (Array.isArray(data)) entries = data;
    else if (Array.isArray(models)) entries = models;
  }

  const ids: string[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const id = ("id" in item ? item.id : undefined) ?? ("name" in item ? item.name : undefined);
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

export async function fetchProviderModels(
  kind: Kind,
  baseUrl: string,
  apiKey: string,
  headersText = "",
): Promise<string[]> {
  const models = new Set<string>();
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");

  if (cleanBase) {
    // 要求 JSON,避免上游把 SPA/错误页的 HTML 当成模型列表
    const customHeaders: Record<string, string> = { Accept: "application/json" };
    const trimmedKey = apiKey.trim();

    if (trimmedKey) {
      customHeaders.Authorization = `Bearer ${trimmedKey}`;
      if (kind.endpoint === "claude") {
        customHeaders["x-api-key"] = trimmedKey;
      } else if (kind.endpoint === "gemini") {
        customHeaders["x-goog-api-key"] = trimmedKey;
      }
    }
    if (kind.endpoint === "claude") {
      customHeaders["anthropic-version"] = "2023-06-01";
    }

    for (const line of lines(headersText)) {
      const i = line.indexOf(":");
      if (i > 0) customHeaders[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }

    const candidateUrls = cleanBase.endsWith("/models")
      ? [cleanBase]
      : cleanBase.endsWith("/v1")
        ? [`${cleanBase}/models`]
        : [`${cleanBase}/models`, `${cleanBase}/v1/models`];

    let lastError = i18n.t("provider_form.no_models");
    for (const url of candidateUrls) {
      const res = await api<{ status_code: number; body?: unknown }>("/v8/management/requests/api-call", {
        method: "POST",
        body: { method: "GET", url, header: customHeaders },
      });

      if (res.status_code < 200 || res.status_code >= 300) {
        lastError = i18n.t("provider_form.fetch_models_failed", { status: res.status_code });
        continue;
      }

      // 上游可能返回 HTML(SPA 页面、网关错误页)而不是 JSON,解析失败就试下一个候选地址
      let payload: unknown = res.body;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          lastError = i18n.t("provider_form.not_json", { status: res.status_code });
          continue;
        }
      }

      for (const id of upstreamModelIds(payload)) models.add(id);
      if (models.size > 0) return Array.from(models).sort();
    }
    if (models.size === 0) throw new Error(lastError);
  }

  for (const ch of KIND_CHANNEL_MAP[kind.endpoint] ?? []) {
    const res = await api<{ models?: { id: string }[] }>(
      `/v8/management/routing/model-definitions/${encodeURIComponent(ch)}`,
    );
    for (const m of res.models ?? []) {
      if (m.id) models.add(m.id);
    }
  }
  return Array.from(models).sort();
}

export function mask(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key;
}

export function identity(item: Json): string {
  const name = str(item.name);
  if (name) return name;
  return `${str(list<ProviderKey>(item.keys)[0]?.["api-key"])}|${str(item["base-url"])}`;
}

// 分组显示名:没有名称时用第一个 key 的掩码
export function groupTitle(item: Json): string {
  return str(item.name) || mask(str(list<ProviderKey>(item.keys)[0]?.["api-key"]));
}

export function toForm(item: Json): Form {
  const keysList = list<ProviderKey>(item.keys);
  const disableCooling = item["disable-cooling"];
  return {
    name: str(item.name),
    keys: keysList.map((k) => ({
      id: Math.random().toString(36).slice(2),
      "api-key": str(k["api-key"]),
      weight: k.weight === undefined ? "" : str(k.weight),
      "proxy-url": str(k["proxy-url"]),
      websockets: k.websockets === true,
      cloakMode: str(k.cloak?.mode),
    })),
    baseUrl: str(item["base-url"]),
    proxyUrl: str(item["proxy-url"]),
    prefix: str(item.prefix),
    priority: str(item.priority),
    headers: Object.entries((item.headers as Record<string, string> | undefined) ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    models: list<Model>(item.models)
      .map((m) => (m.alias ? `${m.name} => ${m.alias}` : m.name))
      .join("\n"),
    excluded: list<string>(item["excluded-models"]).join("\n"),
    disableCooling: disableCooling === true ? "true" : disableCooling === false ? "false" : "",
    requestRetry: item["request-retry"] === undefined ? "" : str(item["request-retry"]),
  };
}

// 键级字段:空值表示删除该字段回退继承,其余按类型写入
function applyKeyRow(kind: Kind, row: KeyRow, previous: Json | undefined): Json {
  const entry: Json = { ...previous, "api-key": row["api-key"].trim() };
  if (row.weight.trim()) entry.weight = Number(row.weight.trim());
  else delete entry.weight;
  if (row["proxy-url"].trim()) entry["proxy-url"] = row["proxy-url"].trim();
  else delete entry["proxy-url"];
  if (kind.websockets) {
    if (row.websockets) entry.websockets = true;
    else delete entry.websockets;
  }
  if (kind.cloak) {
    const cloak: Json = { ...((entry.cloak as Json | undefined) ?? {}) };
    if (row.cloakMode) cloak.mode = row.cloakMode;
    else delete cloak.mode;
    if (Object.keys(cloak).length) entry.cloak = cloak;
    else delete entry.cloak;
  }
  return entry;
}

// 分组字段按 v8 校验:OpenAI 兼容没有分组级 proxy-url / excluded-models(代理在 keys[].proxy-url)
export function fromForm(kind: Kind, form: Form, original: Json): Json {
  const out: Json = { ...original };
  const set = (key: string, value: unknown) => {
    const empty =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" && value !== null && Object.keys(value).length === 0);
    if (empty) delete out[key];
    else out[key] = value;
  };

  set("name", form.name.trim() || undefined);
  // 按 api-key 匹配保留每个 key 上的其它字段(alpha-search、fingerprint-profile 等)
  const prevKeys = new Map(list<ProviderKey>(original.keys).map((k) => [str(k["api-key"]), k as Json]));
  set(
    "keys",
    form.keys
      .filter((row) => row["api-key"].trim())
      .map((row) => applyKeyRow(kind, row, prevKeys.get(row["api-key"].trim()))),
  );
  set("base-url", form.baseUrl.trim());
  if (!kind.openai) {
    set("proxy-url", form.proxyUrl.trim());
    set("excluded-models", lines(form.excluded, true));
    set("disable-cooling", form.disableCooling ? form.disableCooling === "true" : undefined);
    set("request-retry", form.requestRetry.trim() ? Number(form.requestRetry.trim()) : undefined);
  }
  set("prefix", form.prefix.trim());
  set("priority", form.priority.trim() ? Number(form.priority) : undefined);
  set("headers", headersFromText(form.headers));
  const models = new Map(list<Model>(original.models).map((m) => [m.name, m]));
  set(
    "models",
    parseModelRows(form.models).map(({ name, alias }) => {
      const model: Model = { ...models.get(name), name };
      if (alias) model.alias = alias;
      else delete model.alias;
      return model;
    }),
  );
  return out;
}

export function validate(kind: Kind, form: Form): string | null {
  if (kind.openai && !form.name.trim()) return i18n.t("provider_form.name_required");
  if (!form.keys.some((row) => row["api-key"].trim())) return i18n.t("provider_form.api_key_required");
  if ((kind.openai || kind.baseUrlRequired) && !form.baseUrl.trim()) return i18n.t("provider_form.base_url_required");
  if (form.priority.trim() && !/^-?\d+$/.test(form.priority.trim())) return i18n.t("provider_form.priority_integer");
  if (form.requestRetry.trim() && !/^-?\d+$/.test(form.requestRetry.trim()))
    return i18n.t("provider_form.retry_integer");
  if (form.keys.some((row) => row.weight.trim() && !/^-?\d+$/.test(row.weight.trim())))
    return i18n.t("provider_form.weight_integer");
  // 请求头必须写成 "名称: 值",名称不能为空(值可以为空)
  if (lines(form.headers).some((l) => !l.includes(":") || !l.slice(0, l.indexOf(":")).trim()))
    return i18n.t("provider_form.headers_format");
  // CPA 会丢弃没有别名的 Vertex 模型
  if (kind.endpoint === "vertex" && parseModelRows(form.models).some((r) => !r.alias))
    return i18n.t("provider_form.vertex_alias_required");
  return null;
}

export async function testProviderConnectivity(
  kind: Kind,
  form: Form,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  const cleanBase = form.baseUrl.trim().replace(/\/+$/, "");
  const customHeaders: Record<string, string> = headersFromText(form.headers);

  const key = form.keys[0]?.["api-key"].trim() ?? "";
  const modelRows = parseModelRows(form.models);
  const testModel = modelRows[0]?.name || "";

  let method = "POST";
  let url = "";
  let payload: unknown;

  if (kind.openai) {
    if (!cleanBase) throw new Error(i18n.t("provider_form.base_url_required_test"));
    if (key) customHeaders.Authorization = `Bearer ${key}`;
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
  } else if (kind.endpoint === "claude") {
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
  } else if (kind.endpoint === "gemini" || kind.endpoint === "interactions") {
    const host = cleanBase || "https://generativelanguage.googleapis.com";
    const m = testModel || "gemini-1.5-flash";
    url = `${host}/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    customHeaders["Content-Type"] = "application/json";
    payload = {
      contents: [{ parts: [{ text: "Hi" }] }],
    };
  } else if (kind.endpoint === "codex") {
    if (!cleanBase) throw new Error(i18n.t("provider_form.base_url_required_for", { name: "Codex" }));
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    url = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
    method = "GET";
  } else if (kind.endpoint === "xai") {
    if (!cleanBase) throw new Error(i18n.t("provider_form.base_url_required_for", { name: "xAI" }));
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    customHeaders["Content-Type"] = "application/json";
    url = cleanBase.endsWith("/chat/completions") ? cleanBase : `${cleanBase}/v1/chat/completions`;
    payload = {
      model: testModel || "grok-beta",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    };
  } else {
    if (!cleanBase) throw new Error(i18n.t("provider_form.base_url_required"));
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    url = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
    method = "GET";
  }

  try {
    const res = await api<{ status_code: number; body?: unknown }>("/v8/management/requests/api-call", {
      method: "POST",
      body: {
        method,
        url,
        header: customHeaders,
        ...(payload ? { data: JSON.stringify(payload) } : {}),
      },
    });
    const latencyMs = Date.now() - start;
    if (res.status_code >= 200 && res.status_code < 300) {
      return { ok: true, latencyMs, message: i18n.t("provider_form.test_ok", { ms: latencyMs }) };
    }
    return { ok: false, latencyMs, message: i18n.t("provider_form.upstream_http", { status: res.status_code }) };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, message: (err as Error).message || i18n.t("provider_form.request_failed") };
  }
}
