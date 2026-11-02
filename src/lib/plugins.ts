import { api, resolveUrl } from "@/lib/api";

export type ConfigField = {
  name: string;
  type?: string;
  enum_values?: string[] | null;
  /** 未配置时的默认值,CPA 8 起由 pluginapi 返回 */
  default?: unknown;
  description?: string;
};

export type PluginMenu = {
  path: string;
  menu?: string;
  description?: string;
};

export type OAuthProviderEntry = {
  identifier: string;
  /** 入口自己的展示名；为空时回退插件名 */
  name?: string;
  /** 入口自己的图标资产；为空时回退插件图标 */
  logo?: string;
};

export type PluginOAuthProvider = {
  id: string;
  name: string;
  logo: string;
};

export type Plugin = {
  id: string;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  supports_oauth?: boolean;
  oauth_provider?: string;
  /** 插件的多个 OAuth 提供商标识；缺省时回退到 oauth_provider */
  oauth_providers?: string[];
  /** 逐入口的名称与图标；缺省时回退到插件元数据 */
  oauth_provider_entries?: OAuthProviderEntry[];
  logo?: string;
  config_fields?: ConfigField[] | null;
  menus?: PluginMenu[] | null;
  metadata?: {
    name?: string;
    version?: string;
    author?: string;
    github_repository?: string;
    logo?: string;
    config_fields?: ConfigField[] | null;
  };
};

export type PluginsResponse = {
  plugins_enabled?: boolean;
  plugins_dir?: string;
  plugins?: Plugin[];
};

/** 插件声明的 OAuth 提供方入口。CPA 8 起支持一个插件注册多个入口。 */
export function pluginOAuthProviders(plugin: Plugin): PluginOAuthProvider[] {
  const declared = plugin.oauth_providers?.length
    ? [...plugin.oauth_providers]
    : plugin.oauth_provider
      ? [plugin.oauth_provider]
      : [];
  const entries = new Map<string, OAuthProviderEntry>();
  for (const entry of plugin.oauth_provider_entries ?? []) {
    const id = entry.identifier?.trim();
    if (!id || entries.has(id)) continue;
    entries.set(id, entry);
  }
  for (const id of entries.keys()) {
    if (!declared.includes(id)) declared.push(id);
  }

  const pluginName = plugin.metadata?.name?.trim() || plugin.id;
  const pluginLogo = plugin.logo?.trim() || plugin.metadata?.logo?.trim() || "";
  const seen = new Set<string>();
  const out: PluginOAuthProvider[] = [];
  for (const raw of declared) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry = entries.get(id);
    out.push({
      id,
      name: entry?.name?.trim() || pluginName,
      logo: entry?.logo?.trim() || pluginLogo,
    });
  }
  return out;
}

/** 插件声明的 OAuth 提供商标识。 */
export function pluginOAuthIdentifiers(plugin: Plugin): string[] {
  return pluginOAuthProviders(plugin).map((provider) => provider.id);
}

export const PLUGINS_KEY = ["cpa", "plugins"] as const;

export const fetchPlugins = () => api<PluginsResponse>("/v8/management/plugins");

/** 插件资源页挂在 /v0/resource/plugins/<id>/ 下，结合 CPA 服务地址解析完整访问 URL */
export function resolvePluginMenuUrl(pluginId: string, path: string): string {
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  let rawPath = trimmed;
  if (!rawPath.startsWith("/v0/resource/plugins/")) {
    rawPath = `/v0/resource/plugins/${encodeURIComponent(pluginId)}${rawPath.startsWith("/") ? "" : "/"}${rawPath}`;
  }
  return resolveUrl(rawPath);
}

/** 解析插件图标或静态资产的绝对 URL */
export function resolvePluginAsset(value?: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return resolveUrl(trimmed);
}
