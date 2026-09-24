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

function lines(text: string, splitComma = false): string[] {
  return text
    .split(splitComma ? /[\n,]/ : /\n/)
    .map((s) => s.trim())
    .filter(Boolean);
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
