import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type React from "react";
import { createContext, useCallback, useContext, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { DualModeField } from "@/components/dual-mode-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound, replaceKey } from "@/lib/api";

export type Json = Record<string, unknown>;

// 文案取自 i18n：config.fields.<endpoint>.{label,hint,options.<value>}，config.groups.<id>
// list 为每行一项的字符串数组，auth-rules 为插件商店认证规则数组，
// channel-entries 为「渠道 -> 条目数组」对象（如 oauth.settings）
export type Setting = {
  endpoint: string;
  type: "bool" | "int" | "text" | "password" | "select" | "list" | "auth-rules" | "channel-entries";
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
          { endpoint: "requests/passthrough-headers", type: "bool" },
          { endpoint: "requests/nonstream-keepalive-interval", type: "int" },
        ],
      },
      {
        id: "streaming",
        items: [
          { endpoint: "requests/streaming/keepalive-seconds", type: "int" },
          { endpoint: "requests/streaming/bootstrap-retries", type: "int" },
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
          { endpoint: "oauth/providers/codex/header-defaults/user-agent", type: "text" },
          { endpoint: "oauth/providers/codex/header-defaults/beta-features", type: "text" },
          { endpoint: "oauth/providers/codex/live-media-relay/enabled", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/max-sessions", type: "int", fallback: "32" },
          { endpoint: "oauth/providers/codex/live-media-relay/disable-private-remote-ips", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/public-ip", type: "text" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-min", type: "int" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-max", type: "int" },
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

// 输入框里的文本转成写入值,非法返回 undefined
export function parseValue(type: Setting["type"], text: string): unknown {
  if (type === "int") return /^-?\d+$/.test(text.trim()) ? Number(text) : undefined;
  if (type === "list")
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  if (type === "auth-rules" || type === "channel-entries") {
    try {
      const value: unknown = JSON.parse(text);
      // 认证规则是数组,数组里每项是一个规则对象
      if (type === "auth-rules") return Array.isArray(value) && value.every(isRule) ? value : undefined;
      return isChannelEntries(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return text;
}

/** 认证规则:非空对象,且不是数组(数组会被当成列表值) */
function isRule(value: unknown): value is AuthRule {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 「渠道 -> 条目数组」:每个值都必须是非空对象的数组 */
function isChannelEntries(value: unknown): value is ChannelEntries {
  return isRule(value) && Object.values(value).every((entries) => Array.isArray(entries) && entries.every(isRule));
}

// patch 里存界面上的原始输入(开关为布尔,其余为文本),保存时再转换;空文本表示删除该项
type Value = string | boolean;

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
      if (setting.type === "auth-rules" || setting.type === "channel-entries") return JSON.stringify(value, null, 2);
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
      let newKey = "";
      for (const setting of SETTINGS) {
        if (!Object.hasOwn(patch, setting.endpoint)) continue;
        const raw = patch[setting.endpoint];
        if (raw === "") {
          cleared.push(setting.endpoint);
          continue;
        }
        const value = typeof raw === "boolean" ? raw : parseValue(setting.type, raw);
        if (value === undefined) {
          throw new Error(t("config.settings.invalid_value", { field: t(`config.fields.${setting.endpoint}.label`) }));
        }
        if (setting.type === "password") newKey = String(raw);
        // map 类型 PATCH 会深度合并、删不掉已有键,整体 PUT 替换
        if (setting.type === "auth-rules" || setting.type === "channel-entries") {
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
      toast.error(t("config.save_failed", { message: errorText(err) }));
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

export function SettingField({ setting }: { setting: Setting }) {
  const { t } = useI18n();
  const { config, getValue, setValue, patch } = useConfigSettings();
  const id = useId();
  // 标签用 aria-labelledby 关联控件:htmlFor 会让点击标题行直接改值(开关、下拉)
  const labelId = `${id}-label`;
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const isModified = Object.hasOwn(patch, setting.endpoint);
  const value = getValue(setting);
  const text = typeof value === "string" ? value : "";
  const invalid = text !== "" && parseValue(setting.type, text) === undefined;

  const copyValue = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        toast.success(t("config.settings.copied_value"));
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error(t("common.copy_failed")),
    );
  };

  let control: React.ReactNode = null;

  if (setting.type === "bool") {
    control = (
      <Switch
        id={id}
        aria-labelledby={labelId}
        checked={value === true}
        onCheckedChange={(checked) => setValue(setting, checked)}
      />
    );
  } else if (setting.type === "select") {
    const options = setting.options?.map((option) => ({
      value: option,
      label: t(`config.fields.${setting.endpoint}.options.${option}`),
    }));
    control = (
      <Select items={options} value={text || null} onValueChange={(val) => val && setValue(setting, val)}>
        <SelectTrigger id={id} aria-labelledby={labelId} className="min-w-44 w-auto max-w-xs sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (setting.type === "password") {
    const placeholder = readPath(config, setting.endpoint)
      ? t("config.settings.secret_key_set")
      : t("config.settings.secret_key_unset");

    control = (
      <div className="relative w-full sm:w-80">
        <Input
          id={id}
          aria-labelledby={labelId}
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={text}
          onChange={(e) => setValue(setting, e.target.value.trim() ? e.target.value : "")}
          placeholder={placeholder}
          className="w-full pr-9 text-xs font-mono"
        />
        {text && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              title={showPassword ? t("login.hide_key") : t("config.settings.show_secret")}
              aria-label={showPassword ? t("login.hide_key") : t("config.settings.show_secret")}
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          </div>
        )}
      </div>
    );
  } else if (setting.type === "list") {
    control = (
      <ListField id={id} labelId={labelId} text={text} invalid={invalid} onChange={(next) => setValue(setting, next)} />
    );
  } else if (setting.type === "auth-rules") {
    control = (
      <DualModeField
        ariaLabelledBy={labelId}
        value={text}
        onChange={(next) => setValue(setting, next)}
        parse={parseAuthRules}
        format={(rules) => JSON.stringify(rules, null, 2)}
        render={(rules, write) => <AuthRuleList rules={rules} write={write} />}
        invalidHint={t("config.settings.auth_invalid_json")}
      />
    );
  } else if (setting.type === "channel-entries") {
    const fields = setting.entryFields ?? [];
    control = (
      <DualModeField
        ariaLabelledBy={labelId}
        value={text}
        onChange={(next) => setValue(setting, next)}
        parse={parseChannelEntries}
        format={(entries) => JSON.stringify(entries, null, 2)}
        render={(entries, write) => <ChannelEntriesField value={entries} write={write} fields={fields} />}
        invalidHint={t("config.settings.channel_invalid_json")}
      />
    );
  } else {
    const isInt = setting.type === "int";
    control = (
      <div className="flex items-center gap-1.5 w-full sm:w-80">
        <Input
          id={id}
          aria-labelledby={labelId}
          value={text}
          inputMode={isInt ? "numeric" : undefined}
          onChange={(e) => setValue(setting, e.target.value)}
          aria-invalid={invalid}
          className={`flex-1 text-xs ${isInt ? "font-mono" : ""}`}
        />
        {text && setting.type === "text" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={t("common.copy")}
            aria-label={t("config.settings.copy_value")}
            onClick={copyValue}
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          </Button>
        )}
      </div>
    );
  }

  // list / 双模式编辑器需要整行宽度,其余保持左右分栏
  const wide = setting.type === "list" || setting.type === "auth-rules" || setting.type === "channel-entries";

  return (
    <div
      className={`flex flex-col gap-3 py-4 transition-colors ${
        wide ? "" : "sm:flex-row sm:items-center sm:justify-between"
      } ${isModified ? "bg-primary/5 rounded-lg px-3 -mx-3" : ""}`}
    >
      <div className={`min-w-0 ${wide ? "" : "pr-4"}`}>
        <div className="flex items-center gap-2">
          {/* 这里刻意不用 htmlFor（点标题不该改值），所以也放开文本选中：Label 基础样式带 select-none */}
          <Label id={labelId} className="font-medium text-sm select-text">
            {t(`config.fields.${setting.endpoint}.label`)}
          </Label>
          {isModified && (
            <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 text-primary border-primary/30 font-normal">
              {t("config.settings.modified")}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          {t(`config.fields.${setting.endpoint}.hint`)}
        </p>
      </div>
      <div className={wide ? "w-full" : "shrink-0"}>{control}</div>
    </div>
  );
}

/** 字符串列表:逐行编辑,可增删行;空行由 parseValue 在保存时过滤 */
function ListField({
  id,
  labelId,
  text,
  invalid,
  onChange,
}: {
  id: string;
  labelId: string;
  text: string;
  invalid: boolean;
  onChange: (text: string) => void;
}) {
  const { t } = useI18n();
  // 空行是合法中间态(点了「添加一行」还没填),不能从 text 反推,否则新增的空行会被 join 掉
  const [rows, setRows] = useState<string[]>(() => (text === "" ? [] : text.split("\n")));
  const emitted = useRef(text);
  if (text !== emitted.current) {
    emitted.current = text;
    setRows(text === "" ? [] : text.split("\n"));
  }
  // 行没有天然标识,这里按行分配稳定 key,只在增删行时变动
  const rowKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (rowKeys.current.length < rows.length) rowKeys.current.push(`row-${keySeq.current++}`);
  if (rowKeys.current.length > rows.length) rowKeys.current.length = rows.length;
  const write = (next: string[]) => {
    setRows(next);
    emitted.current = next.join("\n");
    onChange(emitted.current);
  };

  return (
    <div className="grid gap-2">
      {rows.map((row, index) => (
        <div key={rowKeys.current[index]} className="flex items-center gap-2">
          <Input
            id={index === 0 ? id : undefined}
            aria-labelledby={labelId}
            aria-invalid={invalid}
            value={row}
            onChange={(e) => write(rows.map((item, i) => (i === index ? e.target.value : item)))}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title={t("config.settings.list_remove")}
            aria-label={t("config.settings.list_remove")}
            onClick={() => {
              rowKeys.current.splice(index, 1);
              write(rows.filter((_, i) => i !== index));
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => write([...rows, ""])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.list_add")}
      </Button>
    </div>
  );
}

/** 文本 → 认证规则数组;空文本视为空数组 */
export function parseAuthRules(text: string): AuthRule[] | null {
  if (text.trim() === "") return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every(isRule) ? value : null;
  } catch {
    return null;
  }
}

/** 文本 → 「渠道 -> 条目数组」;空文本视为空对象 */
export function parseChannelEntries(text: string): ChannelEntries | null {
  if (text.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    return isChannelEntries(value) ? value : null;
  } catch {
    return null;
  }
}

/** 认证规则列表;规则来自 JSON、自身没有 id,这里按行分配稳定 key,只在增删行时变动 */
function AuthRuleList({ rules, write }: { rules: AuthRule[]; write: (next: AuthRule[]) => void }) {
  const { t } = useI18n();
  const ruleKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (ruleKeys.current.length < rules.length) ruleKeys.current.push(`rule-${keySeq.current++}`);
  if (ruleKeys.current.length > rules.length) ruleKeys.current.length = rules.length;

  const update = (index: number, patch: AuthRule) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const next = { ...rule, ...patch };
        // 空串与关闭的开关不落进 JSON,避免堆无意义字段
        for (const [key, value] of Object.entries(patch)) if (value === "" || value === false) delete next[key];
        return next;
      }),
    );

  const setType = (index: number, type: string) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const keep = ["match", "apply_to", "allow_insecure", ...(AUTH_TYPE_FIELDS[type] ?? [])];
        const next: AuthRule = {};
        for (const key of Object.keys(rule)) if (keep.includes(key)) next[key] = rule[key];
        if (type !== "none") next.type = type;
        return next;
      }),
    );

  const toggleApply = (index: number, kind: string, checked: boolean) =>
    write(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const current = Array.isArray(rule.apply_to)
          ? rule.apply_to.filter((value): value is string => typeof value === "string")
          : [];
        const picked = checked ? [...current, kind] : current.filter((value) => value !== kind);
        const next = { ...rule };
        // 一项都不选等于对所有请求生效,直接省略该字段
        const ordered = AUTH_APPLY_TO.filter((value) => picked.includes(value));
        if (ordered.length === 0) delete next.apply_to;
        else next.apply_to = ordered;
        return next;
      }),
    );

  return (
    <div className="grid gap-2">
      {rules.length === 0 && <p className="text-xs text-muted-foreground">{t("config.settings.auth_empty")}</p>}
      {rules.map((rule, index) => (
        <AuthRuleCard
          key={ruleKeys.current[index]}
          index={index}
          rule={rule}
          onRemove={() => {
            ruleKeys.current.splice(index, 1);
            write(rules.filter((_, i) => i !== index));
          }}
          onUpdate={(patch) => update(index, patch)}
          onTypeChange={(type) => setType(index, type)}
          onToggleApply={(kind, checked) => toggleApply(index, kind, checked)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => write([...rules, {}])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.auth_add_rule")}
      </Button>
    </div>
  );
}

/** 单条认证规则的编辑卡片 */
function AuthRuleCard({
  index,
  rule,
  onUpdate,
  onTypeChange,
  onToggleApply,
  onRemove,
}: {
  index: number;
  rule: AuthRule;
  onRemove: () => void;
  onUpdate: (patch: AuthRule) => void;
  onTypeChange: (type: string) => void;
  onToggleApply: (kind: string, checked: boolean) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const type = typeof rule.type === "string" && rule.type !== "" ? rule.type : "none";
  const applies = Array.isArray(rule.apply_to)
    ? rule.apply_to.filter((value): value is string => typeof value === "string")
    : [];
  const textField = (key: string) => (typeof rule[key] === "string" ? (rule[key] as string) : "");

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("config.settings.auth_rule", { index: index + 1 })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          title={t("config.settings.list_remove")}
          aria-label={t("config.settings.list_remove")}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-match`}>{t("config.settings.auth_match")}</Label>
        <Input
          id={`${uid}-match`}
          value={textField("match")}
          onChange={(e) => onUpdate({ match: e.target.value })}
          placeholder="https://plugins.example.com/"
          className="font-mono text-xs"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("config.settings.auth_apply_to")}</Label>
        <div className="flex flex-wrap items-center gap-4">
          {AUTH_APPLY_TO.map((kind) => (
            <label key={kind} htmlFor={`${uid}-apply-${kind}`} className="flex items-center gap-2 text-xs">
              <Checkbox
                id={`${uid}-apply-${kind}`}
                checked={applies.includes(kind)}
                onCheckedChange={(checked) => onToggleApply(kind, checked === true)}
              />
              {t(`config.settings.auth_apply_${kind}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("config.settings.auth_apply_hint")}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-type`}>{t("config.settings.auth_type")}</Label>
        <Select
          items={AUTH_TYPES.map((value) => ({ value, label: t(`config.settings.auth_type_${value}`) }))}
          value={type}
          onValueChange={(value) => value && onTypeChange(value)}
        >
          <SelectTrigger id={`${uid}-type`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`config.settings.auth_type_${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(AUTH_TYPE_FIELDS[type] ?? []).map((key) => (
        <div key={key} className="grid gap-1.5">
          <Label htmlFor={`${uid}-${key}`}>{t(`config.settings.auth_field_${key}`)}</Label>
          <Input
            id={`${uid}-${key}`}
            value={textField(key)}
            onChange={(e) => onUpdate({ [key]: e.target.value })}
            className="font-mono text-xs"
          />
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${uid}-insecure`}>{t("config.settings.auth_allow_insecure")}</Label>
        <Switch
          id={`${uid}-insecure`}
          checked={rule.allow_insecure === true}
          onCheckedChange={(checked) => onUpdate({ allow_insecure: checked })}
        />
      </div>
    </div>
  );
}

/** 「渠道 -> 条目数组」可视化编辑,如 oauth.settings、oauth.request-scoped-errors */
function ChannelEntriesField({
  value,
  write,
  fields,
}: {
  value: ChannelEntries;
  write: (next: ChannelEntries) => void;
  fields: EntryFieldSpec[];
}) {
  const { t } = useI18n();
  const channels = Object.entries(value);
  // 渠道名是对象的键、没有天然 id,按行分配稳定 key,只在增删渠道时变动
  const channelKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (channelKeys.current.length < channels.length) channelKeys.current.push(`channel-${keySeq.current++}`);
  if (channelKeys.current.length > channels.length) channelKeys.current.length = channels.length;

  const replace = (index: number, name: string, entries: AuthRule[]) => {
    const next: ChannelEntries = {};
    channels.forEach(([key, current], i) => {
      next[i === index ? name : key] = i === index ? entries : current;
    });
    write(next);
  };

  const addChannel = () => {
    let i = 1;
    while (`channel-${i}` in value) i++;
    write({ ...value, [`channel-${i}`]: [] });
  };

  return (
    <div className="grid gap-2">
      {channels.length === 0 && <p className="text-xs text-muted-foreground">{t("config.settings.channel_empty")}</p>}
      {channels.map(([channel, entries], index) => (
        <div key={channelKeys.current[index]} className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={channel}
              aria-label={t("config.settings.channel_name")}
              placeholder="codex"
              onChange={(e) => replace(index, e.target.value, entries)}
              className="h-7 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              title={t("config.settings.channel_remove")}
              aria-label={t("config.settings.channel_remove")}
              onClick={() => {
                channelKeys.current.splice(index, 1);
                const next: ChannelEntries = {};
                channels.forEach(([key, current], i) => {
                  if (i !== index) next[key] = current;
                });
                write(next);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <EntryList entries={entries} fields={fields} onChange={(next) => replace(index, channel, next)} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs" onClick={addChannel}>
        <Plus className="size-3.5" />
        {t("config.settings.channel_add")}
      </Button>
    </div>
  );
}

/** 某个渠道下的条目列表 */
function EntryList({
  entries,
  fields,
  onChange,
}: {
  entries: AuthRule[];
  fields: EntryFieldSpec[];
  onChange: (next: AuthRule[]) => void;
}) {
  const { t } = useI18n();
  const entryKeys = useRef<string[]>([]);
  const keySeq = useRef(0);
  while (entryKeys.current.length < entries.length) entryKeys.current.push(`entry-${keySeq.current++}`);
  if (entryKeys.current.length > entries.length) entryKeys.current.length = entries.length;

  const update = (index: number, key: string, raw: unknown) =>
    onChange(
      entries.map((entry, i) => {
        if (i !== index) return entry;
        const next = { ...entry };
        // 空值不落进 JSON,避免堆无意义字段
        if (raw === "" || raw === undefined || (Array.isArray(raw) && raw.length === 0)) delete next[key];
        else next[key] = raw;
        return next;
      }),
    );

  return (
    <div className="grid gap-2">
      {entries.map((entry, index) => (
        <div key={entryKeys.current[index]} className="grid gap-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("config.settings.channel_entry", { index: index + 1 })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              title={t("config.settings.list_remove")}
              aria-label={t("config.settings.list_remove")}
              onClick={() => {
                entryKeys.current.splice(index, 1);
                onChange(entries.filter((_, i) => i !== index));
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          {fields.map((field) => (
            <EntryField
              key={field.key}
              field={field}
              value={entry[field.key]}
              onChange={(raw) => update(index, field.key, raw)}
            />
          ))}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-fit gap-1 text-xs"
        onClick={() => onChange([...entries, {}])}
      >
        <Plus className="size-3.5" />
        {t("config.settings.channel_entry_add")}
      </Button>
    </div>
  );
}

/** 单个条目字段;数字输入保留中间态,避免打到一半就被规范化 */
function EntryField({
  field,
  value,
  onChange,
}: {
  field: EntryFieldSpec;
  value: unknown;
  onChange: (raw: unknown) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const external = value === undefined || value === null ? "" : String(value);
  const [text, setText] = useState(external);
  const emitted = useRef(external);
  if (external !== emitted.current) {
    emitted.current = external;
    setText(external);
  }

  const label = t(`config.settings.entry_${field.key}`);

  if (field.kind === "list") {
    const lines = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").join("\n")
      : "";
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <ListField
          id={id}
          labelId={id}
          text={lines}
          invalid={false}
          onChange={(next) =>
            onChange(
              next
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
    );
  }

  if (field.kind === "select") {
    const options = field.options ?? [];
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select
          items={options.map((option) => ({ value: option, label: option }))}
          value={external || null}
          onValueChange={(next) => next && onChange(next)}
        >
          <SelectTrigger id={id} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  const numeric = field.kind === "int";
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={numeric ? "numeric" : undefined}
        value={numeric ? text : external}
        onChange={(e) => {
          if (!numeric) {
            onChange(e.target.value);
            return;
          }
          setText(e.target.value);
          const raw = e.target.value.trim();
          if (raw === "") {
            emitted.current = "";
            onChange("");
          } else if (/^-?\d+$/.test(raw)) {
            emitted.current = String(Number(raw));
            onChange(Number(raw));
          }
          // 非法中间态只留在输入框,不写进 JSON
        }}
        className={numeric ? "font-mono text-xs" : "text-xs"}
      />
    </div>
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
      <h3 className="text-sm font-medium">{t(`config.sections.${groupId}.${section.id}`)}</h3>
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
      <p className="text-sm text-muted-foreground">{t(`config.groups.${group.id}`)}</p>
      <SettingsState>
        {nested ? (
          <Tabs defaultValue={sections[0].id} className="gap-4">
            {/* 窄屏小节名单行横向滚动，避免折行破坏下划线样式；首个 tab 左内边距清零与上方描述对齐 */}
            <div className="overflow-x-auto no-scrollbar">
              <TabsList variant="line" className="h-8 w-max min-w-full justify-start">
                {sections.map((section) => (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    className="h-8 px-2.5 text-xs sm:text-sm shrink-0 first:pl-0"
                  >
                    {t(`config.sections.${group.id}.${section.id}`)}
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
          {t(group.link.labelKey)}
        </Link>
      )}
    </div>
  );
}
