import { SiGithub } from "@icons-pack/react-simple-icons";
import type { QueryClient } from "@tanstack/react-query";
import { Puzzle } from "lucide-react";
import { useMemo, useState } from "react";
import { i18n } from "@/i18n/context";
import { CONFIG_KEY } from "@/lib/api";
import { type ConfigField, fetchPlugins, PLUGINS_KEY, type Plugin, resolvePluginAsset } from "@/lib/plugins";

export type { Plugin } from "@/lib/plugins";

export function fieldsOf(p: Plugin): ConfigField[] {
  return (p.config_fields?.length ? p.config_fields : p.metadata?.config_fields) ?? [];
}

export function kindOf(f: ConfigField): "bool" | "number" | "enum" | "json" | "text" {
  if (f.enum_values?.length) return "enum";
  const t = (f.type ?? "").toLowerCase();
  if (t.startsWith("bool")) return "bool";
  if (t === "array" || t === "object") return "json";
  if (/int|float|number|double/.test(t)) return "number";
  return "text";
}

/** 插件字段的默认值,作为输入框占位提示 */
export function defaultHint(field: ConfigField): string | undefined {
  const value = field.default;
  if (value === undefined || value === null || typeof value === "boolean") return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// 表单里数字和 JSON 字段编辑时保留原文,保存时再转换校验
export function toForm(fields: ConfigField[], config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const f of fields) {
    const v = config[f.name];
    if (v === undefined || v === null) continue;
    const kind = kindOf(f);
    if (kind === "number") out[f.name] = String(v);
    else if (kind === "json") out[f.name] = JSON.stringify(v, null, 2);
  }
  return out;
}

export function fromForm(fields: ConfigField[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const f of fields) {
    const kind = kindOf(f);
    const raw = values[f.name];
    if ((kind !== "number" && kind !== "json") || typeof raw !== "string") continue;
    if (!raw.trim()) {
      delete out[f.name];
    } else if (kind === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || (/int/i.test(f.type ?? "") && !Number.isInteger(n)))
        throw new Error(i18n.t("plugins.field_invalid_number", { name: f.name }));
      out[f.name] = n;
    } else {
      try {
        out[f.name] = JSON.parse(raw);
      } catch {
        throw new Error(i18n.t("plugins.field_invalid_json", { name: f.name }));
      }
    }
  }
  return out;
}

export type PluginPlatform = { goos?: string; goarch?: string };

export type StorePlugin = {
  store_id: string;
  source_id: string;
  source_name?: string;
  id: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  repository?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  platforms?: PluginPlatform[];
  install_type?: string;
  auth_required?: boolean;
  auth_configured?: boolean;
  installed?: boolean;
  installed_version?: string;
  installed_source_id?: string;
  // different: 已从其它商店源安装;unknown: 无法确认安装来源
  install_source_status?: "matched" | "different" | "unknown" | "assumed";
  update_available?: boolean;
  logo?: string;
};

export function PluginLogo({ src, name, size = "md" }: { src?: string; name: string; size?: "sm" | "md" | "lg" }) {
  const [error, setError] = useState(false);
  const resolved = useMemo(() => (src && !error ? resolvePluginAsset(src) : ""), [src, error]);
  const dim = size === "sm" ? "size-8 rounded-md" : size === "lg" ? "size-12 rounded-lg" : "size-10 rounded-lg";
  const iconSize = size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5";

  if (resolved) {
    return (
      <div
        className={`relative flex items-center justify-center shrink-0 border bg-muted/30 p-1 overflow-hidden shadow-2xs ${dim}`}
      >
        <img src={resolved} alt={name} className="size-full object-contain" onError={() => setError(true)} />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center shrink-0 border bg-muted/40 text-muted-foreground ${dim}`}>
      <Puzzle className={iconSize} />
    </div>
  );
}

export function formatRepoUrl(repo?: string, homepage?: string): string {
  const target = (repo || homepage || "").trim();
  if (!target) return "";
  if (/^https?:\/\//i.test(target)) return target;
  return `https://github.com/${target.replace(/^\/+/, "")}`;
}

export function GithubIcon({ className = "size-3.5" }: { className?: string }) {
  return <SiGithub className={className} />;
}

export type StoreResponse = {
  sources?: { id: string; name: string; url: string }[];
  source_errors?: { source_id: string; source_name: string; source_url: string; message: string }[];
  plugins?: StorePlugin[];
};

export const STORE_KEY = ["cpa", "plugin-store"];
// 插件重载是异步的:写入配置后轮询几次,直到列表状态与预期一致(或放弃)
const REFRESH_ATTEMPTS = 4;
const REFRESH_DELAY_MS = 700;

export async function refreshPlugins(queryClient: QueryClient, waitFor?: (plugins: Plugin[]) => boolean) {
  await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });

  for (let attempt = 0; ; attempt++) {
    const data = await queryClient.fetchQuery({ queryKey: PLUGINS_KEY, queryFn: fetchPlugins, staleTime: 0 });
    if (!waitFor || waitFor(data.plugins ?? []) || attempt >= REFRESH_ATTEMPTS) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, REFRESH_DELAY_MS);
    await promise;
  }
}
