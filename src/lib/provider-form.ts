import { api } from "@/lib/api";

export type Json = Record<string, unknown>;

export type Kind = {
  endpoint: string;
  label: string;
  openai?: boolean;
  baseUrlRequired?: boolean;
  websockets?: boolean;
};

export const KINDS: Kind[] = [
  { endpoint: "gemini", label: "Gemini" },
  { endpoint: "claude", label: "Claude" },
  { endpoint: "codex", label: "Codex", baseUrlRequired: true, websockets: true },
  { endpoint: "openai-compatibility", label: "OpenAI 兼容", openai: true },
  { endpoint: "vertex", label: "Vertex" },
  { endpoint: "xai", label: "xAI", baseUrlRequired: true, websockets: true },
  { endpoint: "meta", label: "Meta", websockets: true },
  { endpoint: "interactions", label: "Interactions" },
];

export type ProviderKey = {
  "api-key": string;
  weight?: number;
  "proxy-url"?: string;
  websockets?: boolean;
};

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

export type Model = { name: string; alias?: string } & Json;

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
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini-cli", "aistudio"],
  vertex: ["vertex"],
  xai: ["xai"],
  meta: ["meta"],
};

export async function fetchProviderModels(
  kind: Kind,
  baseUrl: string,
  apiKey: string,
  headersText = "",
): Promise<string[]> {
  const models = new Set<string>();
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");

  if (cleanBase) {
    const customHeaders: Record<string, string> = {};
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

    let lastError = "未返回任何模型";
    for (const url of candidateUrls) {
      const res = await api<{ status_code: number; body?: unknown }>("/v8/management/requests/api-call", {
        method: "POST",
        body: { method: "GET", url, header: customHeaders },
      });

      if (res.status_code >= 200 && res.status_code < 300) {
        const parsed = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { data?: unknown[] })?.data)
            ? (parsed as { data: unknown[] }).data
            : Array.isArray((parsed as { models?: unknown[] })?.models)
              ? (parsed as { models: unknown[] }).models
              : [];
        for (const item of list) {
          const id = (item as { id?: string })?.id || (item as { name?: string })?.name;
          if (id) models.add(id);
        }
        if (models.size > 0) return Array.from(models).sort();
      } else {
        lastError = `获取上游模型失败：上游返回 HTTP ${res.status_code}`;
      }
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

export function identity(_kind: Kind, item: Json): string {
  const name = str(item.name);
  if (name) return name;
  const keysList = list<ProviderKey>(item.keys);
  const firstKey = keysList[0]?.["api-key"] ?? str(item["api-key"]);
  return `${firstKey}|${str(item["base-url"])}`;
}

export function toForm(item: Json): Form {
  const keysList = list<ProviderKey>(item.keys);
  const firstKey = keysList[0]?.["api-key"] ?? str(item["api-key"]);
  const allKeys = keysList.length > 0 ? keysList.map((k) => str(k["api-key"])).join("\n") : str(item["api-key"]);

  return {
    name: str(item.name),
    apiKey: firstKey,
    keys: allKeys,
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
    websockets: item.websockets === true || (keysList[0] && keysList[0].websockets === true),
  };
}

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

  set("name", form.name.trim() || undefined);
  const existingKeys = list<ProviderKey>(original.keys);
  const keysMap = new Map(existingKeys.map((k) => [str(k["api-key"]), k]));
  const enteredKeys = lines(form.keys.trim() ? form.keys : form.apiKey);

  set(
    "keys",
    enteredKeys.map((k) => {
      const prev = keysMap.get(k);
      const entry: Json = typeof prev === "object" && prev !== null ? { ...prev, "api-key": k } : { "api-key": k };
      if (kind.websockets && form.websockets) entry.websockets = true;
      return entry;
    }),
  );
  if (kind.openai) {
    set("disabled", form.disabled || undefined);
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
  return out;
}

export function validate(kind: Kind, form: Form): string | null {
  if (kind.openai && !form.name.trim()) return "请填写名称";
  if (!form.apiKey.trim() && !form.keys.trim()) return "请填写 API Key";
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
  } else if (kind.endpoint === "claude") {
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
  } else if (kind.endpoint === "gemini" || kind.endpoint === "interactions") {
    const key = form.apiKey.trim();
    const host = cleanBase || "https://generativelanguage.googleapis.com";
    const m = testModel || "gemini-1.5-flash";
    url = `${host}/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    customHeaders["Content-Type"] = "application/json";
    payload = {
      contents: [{ parts: [{ text: "Hi" }] }],
    };
  } else if (kind.endpoint === "codex") {
    if (!cleanBase) throw new Error("Codex 必须填写 Base URL");
    const key = form.apiKey.trim();
    if (key) customHeaders.Authorization = `Bearer ${key}`;
    url = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
    method = "GET";
  } else if (kind.endpoint === "xai") {
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
      return { ok: true, latencyMs, message: `成功响应 (${latencyMs}ms)` };
    }
    return { ok: false, latencyMs, message: `上游返回 HTTP ${res.status_code}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, message: (err as Error).message || "请求失败" };
  }
}
