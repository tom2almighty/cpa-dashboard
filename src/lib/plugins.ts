import { api, resolveUrl } from "@/lib/api";

export type ConfigField = {
  name: string;
  type?: string;
  enum_values?: string[] | null;
  description?: string;
};

export type PluginMenu = {
  path: string;
  menu?: string;
  description?: string;
};

export type Plugin = {
  id: string;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  supports_oauth?: boolean;
  oauth_provider?: string;
  supports_quota?: boolean;
  quota_provider?: string;
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
