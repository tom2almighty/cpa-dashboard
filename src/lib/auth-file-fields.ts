import { formatModelRows, lines, list, type ModelRow, parseModelRows, str } from "./provider-form";

// 认证文件里的模型别名条目:除 name/alias 外还可能有 fork、display-name 等字段
export type Alias = { name?: string; alias?: string } & Record<string, unknown>;

export type Fields = {
  note: string;
  prefix: string;
  proxy_url: string;
  priority: string;
  weight: string;
  request_retry: string;
  websockets: boolean;
  headers: string;
  timezone: string;
  model_aliases: string;
  excluded_models: string;
  // 别名原始条目,保存时按 name 合并,保留 fork / display-name 等未在表单里编辑的字段
  alias_entries: Alias[];
};

export const NUMBER_FIELDS = [
  ["priority", "auth_files.field_priority"],
  ["weight", "auth_files.field_weight"],
  ["request_retry", "auth_files.field_request_retry"],
] as const;

export function readFields(source: Record<string, unknown>): Fields {
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
  const headers = (source.headers ?? {}) as Record<string, string>;
  const aliasEntries = list<Alias>(source.model_aliases ?? source["model-aliases"]);
  return {
    note: text(source.note),
    prefix: text(source.prefix),
    proxy_url: text(source.proxy_url ?? source["proxy-url"]),
    priority: text(source.priority),
    weight: text(source.weight),
    request_retry: text(source.request_retry ?? source["request-retry"]),
    websockets: source.websockets === true || source.websockets === "true",
    headers: Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    timezone: text(source.timezone),
    model_aliases: formatModelRows(aliasEntries.map((entry) => ({ name: str(entry.name), alias: str(entry.alias) }))),
    excluded_models: list<string>(source.excluded_models ?? source["excluded-models"]).join("\n"),
    alias_entries: aliasEntries,
  };
}

// 按 name 复用原条目,同一 name 有多条时按顺序匹配
export function mergeAliasEntries(previous: Alias[], rows: ModelRow[]): Alias[] {
  const rest = [...previous];
  return rows.map(({ name, alias }) => {
    const index = rest.findIndex((entry) => str(entry.name) === name);
    const [matched] = index >= 0 ? rest.splice(index, 1) : [undefined];
    const entry: Alias = { ...(matched ?? { name }) };
    entry.name = name;
    if (alias) entry.alias = alias;
    else delete entry.alias;
    return entry;
  });
}

function parseHeaders(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes(":"))
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
}

// 只提交改动的字段;清空的文本写成空字符串,清空的数字写成 null(恢复继承),删掉的请求头写成空值
export function diffFields(before: Fields, after: Fields): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["note", "prefix", "proxy_url"] as const) {
    if (before[key] !== after[key]) patch[key] = after[key].trim();
  }
  for (const [key] of NUMBER_FIELDS) {
    if (before[key] !== after[key]) patch[key] = after[key].trim() ? Number(after[key]) : null;
  }
  if (before.websockets !== after.websockets) patch.websockets = after.websockets;
  if (before.timezone !== after.timezone) patch.timezone = after.timezone.trim();
  if (before.model_aliases !== after.model_aliases)
    patch.model_aliases = mergeAliasEntries(before.alias_entries, parseModelRows(after.model_aliases));
  if (before.excluded_models !== after.excluded_models) patch.excluded_models = lines(after.excluded_models);
  if (before.headers !== after.headers) {
    const old = parseHeaders(before.headers);
    const next = parseHeaders(after.headers);
    patch.headers = { ...Object.fromEntries(Object.keys(old).map((k) => [k, ""])), ...next };
  }
  return patch;
}
