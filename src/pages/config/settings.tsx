import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound, replaceKey } from "@/lib/api";
import { showErrorToast } from "@/lib/toast";
import { parseValue, SettingField } from "./settings-fields";

export { parseAuthRules, parseChannelEntries, parseIceServers, parseValue, SettingField } from "./settings-fields";

export type Json = Record<string, unknown>;

// 文案取自 i18n：config.fields.<endpoint>.{label,hint,options.<value>}，config.groups.<id>
// list 为每行一项的字符串数组，auth-rules 为插件商店认证规则数组，
// channel-entries 为「渠道 -> 条目数组」对象（如 oauth.settings），
// ice-servers 为 Codex Live 的 STUN/TURN 条目数组
export type Setting = {
  endpoint: string;
  type: "bool" | "int" | "text" | "password" | "select" | "list" | "auth-rules" | "channel-entries" | "ice-servers";
  options?: string[];
  fallback?: string | boolean;
  /** channel-entries 可视化编辑时每个条目的字段 */
  entryFields?: EntryFieldSpec[];
};

export type ConfigSection = {
  id: string;
  items: Setting[];
};

export type ConfigGroup = {
  id: string;
  /** 组内小节的顺序就是渲染顺序 */
  sections: ConfigSection[];
  /** 相关页面跳转(如 access.api-keys 在客户端密钥页编辑) */
  link?: { to: string; labelKey: string };
};

/** 一条插件商店认证规则,键名沿用 CPA 的 json tag(snake_case) */
export type AuthRule = Record<string, unknown>;

/** Codex Live 的 STUN/TURN 服务器;凭据字段不会由配置接口回显 */
export type IceServer = { urls: string[]; username?: string; credential?: string };

/** channel-entries 里单个条目的字段编辑方式,key 用 CPA 的 json tag */
export type EntryFieldSpec = {
  key: string;
  kind: "text" | "int" | "list" | "select";
  options?: string[];
};

/** 「渠道 -> 条目数组」配置,如 oauth.settings、oauth.request-scoped-errors */
export type ChannelEntries = Record<string, AuthRule[]>;

/** apply-to 取值,对应 CPA pluginstore.RequestKind* */
export const AUTH_APPLY_TO = ["registry", "metadata", "artifact"] as const;

/** 认证类型,对应 CPA pluginstore.AuthType*;none 表示不认证 */
export const AUTH_TYPES = ["none", "bearer", "github-token", "basic", "header"] as const;

/** 各认证类型需要的环境变量字段,只写变量名不写明文 */
export const AUTH_TYPE_FIELDS: Record<string, string[]> = {
  none: [],
  bearer: ["token_env"],
  "github-token": ["token_env"],
  basic: ["username_env", "password_env"],
  header: ["header_name", "header_value_env"],
};

/**
 * 对照 CPA v8 路径表(internal/config/config_v8.go 的 buildV8Paths)、config.example.yaml 与官方文档
 * configuration/options 构建。分组与 config.example.yaml 的根节点一一对应，组内再按用途分小节。
 * access.api-keys 由「客户端密钥」页面维护，这里不再单列分组。
 * 不暴露 Home 管理契约(credentials.concurrency/in-flight、plugins.auth-revision)与无 v8 对应的旧字段
 * (quota-exceeded.switch-project/switch-preview-model)。
 */
export const GROUPS: ConfigGroup[] = [
  {
    id: "models",
    sections: [
      {
        id: "catalogs",
        items: [
          { endpoint: "models/catalog", type: "text" },
          { endpoint: "models/codex-catalog", type: "text" },
          { endpoint: "models/devin-catalog", type: "text" },
        ],
      },
    ],
  },
  {
    id: "server",
    sections: [
      {
        id: "listening",
        items: [
          { endpoint: "server/host", type: "text", fallback: "" },
          { endpoint: "server/port", type: "int", fallback: "8317" },
          { endpoint: "server/max-request-body-bytes", type: "int", fallback: "0" },
          { endpoint: "server/github-token", type: "password" },
          { endpoint: "server/trusted-proxies", type: "list" },
          { endpoint: "server/commercial-mode", type: "bool" },
        ],
      },
      {
        id: "tls",
        items: [
          { endpoint: "server/tls/enable", type: "bool" },
          { endpoint: "server/tls/cert", type: "text" },
          { endpoint: "server/tls/key", type: "text" },
        ],
      },
      {
        id: "discovery",
        items: [
          { endpoint: "server/discovery/enabled", type: "bool" },
          { endpoint: "server/discovery/service-name", type: "text" },
          { endpoint: "server/discovery/service-type", type: "text", fallback: "_ai-gateway._tcp" },
          { endpoint: "server/discovery/subtypes", type: "list" },
          { endpoint: "server/discovery/interfaces/include", type: "list" },
          { endpoint: "server/discovery/interfaces/exclude", type: "list" },
          { endpoint: "server/discovery/auth-required", type: "bool", fallback: true },
          { endpoint: "server/discovery/advertise-management", type: "bool" },
        ],
      },
    ],
  },
  {
    id: "management",
    sections: [
      {
        id: "management",
        items: [
          { endpoint: "management/allow-remote", type: "bool" },
          { endpoint: "management/secret-key", type: "password" },
          { endpoint: "management/disable-control-panel", type: "bool" },
          { endpoint: "management/disable-auto-update-panel", type: "bool" },
          { endpoint: "management/base-url", type: "text" },
          { endpoint: "management/panel-github-repository", type: "text" },
        ],
      },
    ],
  },
  {
    id: "routing",
    sections: [
      {
        id: "routing",
        items: [
          {
            endpoint: "routing/strategy",
            type: "select",
            options: ["round-robin", "weighted-round-robin", "fill-first"],
            fallback: "round-robin",
          },
          { endpoint: "routing/session-affinity", type: "bool" },
          { endpoint: "routing/session-affinity-subagents", type: "bool", fallback: true },
          {
            endpoint: "routing/session-affinity-rebind-on",
            type: "select",
            options: ["any", "quota"],
            fallback: "any",
          },
          { endpoint: "routing/session-affinity-ttl", type: "text", fallback: "1h" },
          { endpoint: "routing/force-model-prefix", type: "bool" },
        ],
      },
      {
        id: "retry",
        items: [
          { endpoint: "routing/retry/request-retry", type: "int" },
          { endpoint: "routing/retry/max-retry-credentials", type: "int" },
          { endpoint: "routing/retry/max-retry-interval", type: "int" },
        ],
      },
      {
        id: "cooldown",
        items: [
          { endpoint: "routing/cooldown/disable-cooling", type: "bool" },
          { endpoint: "routing/cooldown/save-cooldown-status", type: "bool" },
          { endpoint: "routing/cooldown/transient-error-cooldown-seconds", type: "int" },
        ],
      },
    ],
  },
  {
    id: "requests",
    sections: [
      {
        id: "requests",
        items: [
          { endpoint: "requests/proxy-url", type: "text" },
          { endpoint: "requests/tls-handshake-timeout-seconds", type: "int", fallback: "0" },
          { endpoint: "requests/passthrough-headers", type: "bool" },
          { endpoint: "requests/nonstream-keepalive-interval", type: "int" },
        ],
      },
      {
        id: "streaming",
        items: [
          { endpoint: "requests/streaming/keepalive-seconds", type: "int" },
          { endpoint: "requests/streaming/bootstrap-retries", type: "int" },
          { endpoint: "requests/streaming/send-keepalive-before-ft", type: "bool", fallback: false },
        ],
      },
    ],
  },
  {
    id: "client",
    sections: [
      {
        id: "codex",
        items: [
          { endpoint: "client/codex/enable-apply-patch", type: "bool" },
          { endpoint: "client/codex/optimize-multi-agent-v2", type: "bool" },
        ],
      },
    ],
  },
  {
    id: "upstream",
    sections: [
      {
        id: "codex",
        items: [
          { endpoint: "upstream/codex/response-steering", type: "bool" },
          { endpoint: "upstream/codex/disable-codex-cloaking", type: "bool" },
          { endpoint: "upstream/codex/stream-bootstrap-buffering", type: "bool" },
          { endpoint: "upstream/codex/stream-bootstrap-timeout", type: "text", fallback: "0" },
          { endpoint: "upstream/codex/orphan-delegation-compatibility", type: "bool" },
          { endpoint: "upstream/codex/model-level-cooling", type: "bool" },
        ],
      },
      {
        id: "claude",
        items: [
          { endpoint: "upstream/claude/model-level-cooling", type: "bool" },
          { endpoint: "upstream/claude/tool-search", type: "bool" },
          { endpoint: "upstream/claude/disable-claude-cloak-mode", type: "bool" },
          { endpoint: "upstream/claude/disable-cloaking-model-list", type: "bool" },
          { endpoint: "upstream/claude/header-defaults/user-agent", type: "text" },
          { endpoint: "upstream/claude/header-defaults/package-version", type: "text" },
          { endpoint: "upstream/claude/header-defaults/runtime-version", type: "text" },
          { endpoint: "upstream/claude/header-defaults/os", type: "text" },
          { endpoint: "upstream/claude/header-defaults/arch", type: "text" },
          { endpoint: "upstream/claude/header-defaults/timeout", type: "text" },
          { endpoint: "upstream/claude/header-defaults/timezone", type: "text" },
          { endpoint: "upstream/claude/header-defaults/stabilize-device-profile", type: "bool" },
          { endpoint: "upstream/claude/header-defaults/anthropic-beta-strip", type: "list" },
          { endpoint: "upstream/claude/header-defaults/anthropic-beta-append", type: "list" },
          { endpoint: "upstream/claude/header-defaults/inject-diagnostics", type: "bool", fallback: true },
          {
            endpoint: "upstream/claude/header-defaults/client-request-id",
            type: "select",
            options: ["on", "passthrough", "off"],
            fallback: "on",
          },
          { endpoint: "upstream/claude/session-date-pin-days", type: "int", fallback: "7" },
        ],
      },
      {
        id: "xai",
        items: [{ endpoint: "upstream/xai/inject-x-search", type: "bool" }],
      },
    ],
  },
  {
    id: "oauth",
    sections: [
      {
        id: "oauth",
        items: [
          { endpoint: "oauth/auth-dir", type: "text", fallback: "~/.cli-proxy-api" },
          { endpoint: "oauth/auth-auto-refresh-workers", type: "int", fallback: "16" },
          {
            endpoint: "oauth/settings",
            type: "channel-entries",
            entryFields: [
              { key: "name", kind: "text" },
              { key: "alias", kind: "text" },
              { key: "max-context-length", kind: "int" },
            ],
          },
          {
            endpoint: "oauth/request-scoped-errors",
            type: "channel-entries",
            entryFields: [
              { key: "status", kind: "int" },
              { key: "match", kind: "list" },
              { key: "match-regexr", kind: "list" },
              {
                key: "action",
                kind: "select",
                options: ["stop", "stop-and-cooldown", "continue", "continue-and-cooldown"],
              },
            ],
          },
        ],
      },
      {
        id: "aistudio",
        items: [{ endpoint: "oauth/providers/aistudio/ws-auth", type: "bool", fallback: true }],
      },
      {
        id: "codex",
        items: [
          { endpoint: "oauth/providers/codex/signin-with-chatgpt-identifier", type: "text", fallback: "CLIProxyAPI" },
          { endpoint: "oauth/providers/codex/header-defaults/user-agent", type: "text" },
          { endpoint: "oauth/providers/codex/header-defaults/beta-features", type: "text" },
          { endpoint: "oauth/providers/codex/live-media-relay/enabled", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/max-sessions", type: "int", fallback: "32" },
          { endpoint: "oauth/providers/codex/live-media-relay/disable-private-remote-ips", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/public-ip", type: "text" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-min", type: "int" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-max", type: "int" },
          { endpoint: "oauth/providers/codex/live-media-relay/ice-servers", type: "ice-servers" },
        ],
      },
      {
        id: "antigravity",
        items: [
          { endpoint: "oauth/providers/antigravity/antigravity-credits", type: "bool", fallback: true },
          { endpoint: "oauth/providers/antigravity/signature-cache-enabled", type: "bool", fallback: true },
          { endpoint: "oauth/providers/antigravity/signature-bypass-strict", type: "bool" },
          { endpoint: "oauth/providers/antigravity/sensitive-words", type: "list" },
          { endpoint: "oauth/providers/antigravity/connection-pool/enabled", type: "bool" },
          { endpoint: "oauth/providers/antigravity/connection-pool/idle-conn-timeout", type: "text", fallback: "30s" },
          {
            endpoint: "oauth/providers/antigravity/connection-pool/max-idle-conns-per-host",
            type: "int",
            fallback: "2",
          },
        ],
      },
      {
        id: "devin",
        items: [{ endpoint: "oauth/providers/devin/sensitive-words", type: "list" }],
      },
    ],
  },
  {
    id: "multimedia",
    sections: [
      {
        id: "multimedia",
        items: [
          {
            endpoint: "multimedia/disable-image-generation",
            type: "select",
            options: ["false", "true", "chat", "passthrough"],
            fallback: "false",
          },
          { endpoint: "multimedia/gpt-image-2-base-model", type: "text", fallback: "gpt-5.4-mini" },
          { endpoint: "multimedia/video-result-auth-cache-ttl", type: "text", fallback: "3h" },
        ],
      },
    ],
  },
  {
    id: "observability",
    sections: [
      {
        id: "logs",
        items: [
          { endpoint: "observability/logs/debug", type: "bool" },
          { endpoint: "observability/logs/logging-to-file", type: "bool" },
          { endpoint: "observability/logs/request-log", type: "bool" },
          { endpoint: "observability/logs/logs-max-total-size-mb", type: "int" },
          { endpoint: "observability/logs/error-logs-max-files", type: "int", fallback: "10" },
        ],
      },
      {
        id: "usage",
        items: [
          { endpoint: "observability/usage/usage-statistics-enabled", type: "bool" },
          { endpoint: "observability/usage/redis-usage-queue-retention-seconds", type: "int", fallback: "60" },
        ],
      },
      {
        id: "pprof",
        items: [
          { endpoint: "observability/pprof/enable", type: "bool" },
          { endpoint: "observability/pprof/addr", type: "text", fallback: "127.0.0.1:8316" },
        ],
      },
    ],
  },
  {
    id: "plugins",
    link: { to: "/plugins", labelKey: "config.links.plugins" },
    sections: [
      {
        id: "plugins",
        items: [
          { endpoint: "plugins/enabled", type: "bool" },
          { endpoint: "plugins/dir", type: "text", fallback: "plugins" },
          { endpoint: "plugins/store-sources", type: "list" },
          { endpoint: "plugins/store-auth", type: "auth-rules" },
        ],
      },
    ],
  },
];

const SETTINGS = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items));

const ENDPOINT_ALIASES: Record<string, string[]> = {
  "upstream/codex/disable-codex-cloaking": [
    "oauth/providers/codex/disable-codex-cloaking",
    "codex/disable-codex-cloaking",
  ],
  "upstream/codex/stream-bootstrap-buffering": [
    "oauth/providers/codex/stream-bootstrap-buffering",
    "codex/stream-bootstrap-buffering",
  ],
  "upstream/codex/stream-bootstrap-timeout": [
    "oauth/providers/codex/stream-bootstrap-timeout",
    "codex/stream-bootstrap-timeout",
  ],
  "upstream/codex/orphan-delegation-compatibility": [
    "oauth/providers/codex/orphan-delegation-compatibility",
    "codex/orphan-delegation-compatibility",
  ],
  "upstream/codex/model-level-cooling": ["oauth/providers/codex/model-level-cooling", "codex/model-level-cooling"],
  "upstream/codex/response-steering": ["oauth/providers/codex/response-steering", "codex/response-steering"],
  "upstream/claude/model-level-cooling": ["oauth/providers/claude/model-level-cooling"],
  "upstream/claude/disable-cloaking-model-list": [
    "oauth/providers/claude/claude-code/disable-cloaking-model-list",
    "oauth/providers/claude/disable-cloaking-model-list",
  ],
  "upstream/claude/disable-claude-cloak-mode": [
    "oauth/providers/claude/disable-claude-cloak-mode",
    "disable-claude-cloak-mode",
  ],
  "upstream/claude/header-defaults/user-agent": ["oauth/providers/claude/header-defaults/user-agent"],
  "upstream/claude/header-defaults/package-version": ["oauth/providers/claude/header-defaults/package-version"],
  "upstream/claude/header-defaults/runtime-version": ["oauth/providers/claude/header-defaults/runtime-version"],
  "upstream/claude/header-defaults/os": ["oauth/providers/claude/header-defaults/os"],
  "upstream/claude/header-defaults/arch": ["oauth/providers/claude/header-defaults/arch"],
  "upstream/claude/header-defaults/timeout": ["oauth/providers/claude/header-defaults/timeout"],
  "upstream/claude/header-defaults/timezone": ["oauth/providers/claude/header-defaults/timezone"],
  "upstream/claude/header-defaults/stabilize-device-profile": [
    "oauth/providers/claude/header-defaults/stabilize-device-profile",
  ],
  "upstream/claude/header-defaults/anthropic-beta-strip": [
    "oauth/providers/claude/header-defaults/anthropic-beta-strip",
  ],
  "upstream/claude/header-defaults/anthropic-beta-append": [
    "oauth/providers/claude/header-defaults/anthropic-beta-append",
  ],
  "upstream/claude/header-defaults/inject-diagnostics": ["oauth/providers/claude/header-defaults/inject-diagnostics"],
  "upstream/claude/header-defaults/client-request-id": ["oauth/providers/claude/header-defaults/client-request-id"],
  "upstream/claude/session-date-pin-days": ["claude/session-date-pin-days"],
  "upstream/xai/inject-x-search": ["oauth/providers/xai/inject-x-search"],
  "client/codex/optimize-multi-agent-v2": [
    "oauth/providers/codex/optimize-multi-agent-v2",
    "providers/codex/optimize-multi-agent-v2",
    "codex/optimize-multi-agent-v2",
  ],
};

function lookupPath(config: Json | undefined, path: string): unknown {
  let node: unknown = config;
  for (const key of path.split("/")) node = node && typeof node === "object" ? (node as Json)[key] : undefined;
  return node ?? undefined;
}

export function readPath(config: Json | undefined, endpoint: string): unknown {
  const value = lookupPath(config, endpoint);
  if (value !== undefined) return value;
  const aliases = ENDPOINT_ALIASES[endpoint];
  if (aliases) {
    for (const alias of aliases) {
      const aliasValue = lookupPath(config, alias);
      if (aliasValue !== undefined) return aliasValue;
    }
  }
  return undefined;
}

// patch 里存界面上的原始输入(开关为布尔,其余为文本),保存时再转换;空文本表示删除该项
type Value = string | boolean;

export const MANAGEMENT_SECRET_ENDPOINT = "management/secret-key";

/** 只有管理密钥字段会改变本面板的登录凭据 */
export function managementKeyFromPatch(patch: Record<string, Value>): string {
  const raw = patch[MANAGEMENT_SECRET_ENDPOINT];
  return typeof raw === "string" ? raw : "";
}

type ConfigSettingsContextType = {
  config: Json | undefined;
  isPending: boolean;
  error: Error | null;
  patch: Record<string, Value>;
  dirtyCount: number;
  getValue: (setting: Setting) => Value;
  setValue: (setting: Setting, value: Value) => void;
  resetPatch: () => void;
  saveAll: () => void;
  isSaving: boolean;
};

const ConfigSettingsContext = createContext<ConfigSettingsContextType | null>(null);

export function useConfigSettings() {
  const ctx = useContext(ConfigSettingsContext);
  if (!ctx) throw new Error("useConfigSettings must be used within ConfigSettingsProvider");
  return ctx;
}

export function ConfigSettingsProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: config, isPending, error } = useQuery(configQuery);
  const [patch, setPatch] = useState<Record<string, Value>>({});

  // 管理密钥在配置里是 bcrypt 哈希,不回显,留空即不修改
  const original = useCallback(
    (setting: Setting): Value => {
      if (setting.type === "password") return "";
      const value = readPath(config, setting.endpoint);
      if (setting.type === "bool") return typeof value === "boolean" ? value : setting.fallback === true;
      if (value === undefined) return String(setting.fallback ?? "");
      if (setting.type === "list" && Array.isArray(value)) return value.join("\n");
      if (setting.type === "auth-rules" || setting.type === "channel-entries" || setting.type === "ice-servers")
        return JSON.stringify(value ?? [], null, 2);
      return String(value);
    },
    [config],
  );

  const getValue = useCallback(
    (setting: Setting) => (Object.hasOwn(patch, setting.endpoint) ? patch[setting.endpoint] : original(setting)),
    [patch, original],
  );

  const setValue = useCallback(
    (setting: Setting, value: Value) => {
      setPatch((prev) => {
        const next = { ...prev };
        if (value === original(setting)) delete next[setting.endpoint];
        else next[setting.endpoint] = value;
        return next;
      });
    },
    [original],
  );

  const saveMutation = useMutation({
    meta: { quiet: true },
    mutationFn: async () => {
      const body: Json = {};
      const cleared: string[] = [];
      const replaced: [string, unknown][] = [];
      const newKey = managementKeyFromPatch(patch);
      for (const setting of SETTINGS) {
        if (!Object.hasOwn(patch, setting.endpoint)) continue;
        const raw = patch[setting.endpoint];
        if (raw === "") {
          cleared.push(setting.endpoint);
          continue;
        }
        const value = typeof raw === "boolean" ? raw : parseValue(setting.type, raw);
        if (value === undefined) {
          throw new Error(
            t("config.settings.invalid_value", { field: t(`config.fields.${setting.endpoint}.label` as never) }),
          );
        }
        // map 类型 PATCH 会深度合并、删不掉已有键,整体 PUT 替换
        if (setting.type === "auth-rules" || setting.type === "channel-entries" || setting.type === "ice-servers") {
          replaced.push([setting.endpoint, value]);
          continue;
        }
        const keys = setting.endpoint.split("/");
        let node = body;
        for (const key of keys.slice(0, -1)) {
          node[key] ??= {};
          node = node[key] as Json;
        }
        node[keys[keys.length - 1]] = value;
      }
      // 先删除清空的项,其余修改合并成一次 PATCH(原子写入、只重载一次);管理密钥也在这次 PATCH 里,成功后才切换本地密钥
      for (const endpoint of cleared) {
        await api(configPath(...endpoint.split("/")), { method: "DELETE" }).catch(orNotFound(undefined));
      }
      for (const [endpoint, value] of replaced) {
        await api(configPath(...endpoint.split("/")), { method: "PUT", body: value });
      }
      if (Object.keys(body).length > 0) await api("/v8/management/config", { method: "PATCH", body });
      if (newKey) replaceKey(newKey);
    },
    onSuccess: () => {
      setPatch({});
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
      toast.success(t("config.save_success"));
    },
    onError: (err: Error) => {
      showErrorToast(t("config.save_failed", { message: errorText(err) }));
    },
  });

  return (
    <ConfigSettingsContext.Provider
      value={{
        config,
        isPending,
        error,
        patch,
        dirtyCount: Object.keys(patch).length,
        getValue,
        setValue,
        resetPatch: () => setPatch({}),
        saveAll: () => saveMutation.mutate(),
        isSaving: saveMutation.isPending,
      }}
    >
      {children}
    </ConfigSettingsContext.Provider>
  );
}

function SettingsState({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { isPending, error } = useConfigSettings();

  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("config.yaml.load_failed", { message: errorText(error) })}
      </p>
    );
  if (isPending) return <Skeleton className="h-64 w-full" />;
  return <>{children}</>;
}

function SettingList({ items }: { items: Setting[] }) {
  return (
    <div className="divide-y border-y">
      {items.map((setting) => (
        <SettingField key={setting.endpoint} setting={setting} />
      ))}
    </div>
  );
}

/**
 * 单个小节的标题 + 设置列表。设置项多的大组（如 oauth 的 7 个提供商小节）
 * 会把这部分挂到二级 tab 下，所以单独抽出来。
 */
function SettingsSection({ groupId, section }: { groupId: string; section: ConfigSection }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{t(`config.sections.${groupId}.${section.id}` as never)}</h3>
      <SettingList items={section.items} />
    </section>
  );
}

export function SettingsGroup({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;

  const { sections } = group;
  // 小节只有一两个时摊开更省事；多到需要滚动才值得再切一层
  const nested = sections.length > 2;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t(`config.groups.${group.id}` as never)}</p>
      <SettingsState>
        {nested ? (
          <Tabs defaultValue={sections[0].id} className="gap-4">
            <div className="overflow-x-auto no-scrollbar">
              <TabsList variant="line" className="h-8">
                {sections.map((section) => (
                  <TabsTrigger key={section.id} value={section.id} className="h-8 px-2.5 text-xs sm:text-sm shrink-0">
                    {t(`config.sections.${group.id}.${section.id}` as never)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {sections.map((section) => (
              <TabsContent key={section.id} value={section.id} className="pt-2">
                <SettingsSection groupId={group.id} section={section} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <SettingsSection key={section.id} groupId={group.id} section={section} />
            ))}
          </div>
        )}
      </SettingsState>
      {group.link && (
        <Link
          to={group.link.to}
          className="inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {t(group.link.labelKey as never)}
        </Link>
      )}
    </div>
  );
}
