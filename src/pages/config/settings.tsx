import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import type React from "react";
import { createContext, useCallback, useContext, useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound, replaceKey } from "@/lib/api";

export type Json = Record<string, unknown>;

// 文案取自 i18n：config.fields.<endpoint>.{label,hint,options.<value>}，config.groups.<id>
// list 为每行一项的字符串数组，json 为 JSON 对象
export type Setting = {
  endpoint: string;
  type: "bool" | "int" | "text" | "password" | "select" | "list" | "json";
  options?: string[];
  fallback?: string | boolean;
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

/**
 * 对照 CPA v8 路径表(internal/config/config_v8.go 的 buildV8Paths)、config.example.yaml 与官方文档
 * configuration/options 构建。分组与 config.example.yaml 的根节点一一对应，组内再按用途分小节；
 * 官方文档的「管理 API」「访问控制」是 management / access 两个根节点，因此独立成组而不是并入服务器。
 * 不暴露 Home 管理契约(credentials.concurrency/in-flight、plugins.auth-revision)与无 v8 对应的旧字段
 * (quota-exceeded.switch-project/switch-preview-model)。
 */
export const GROUPS: ConfigGroup[] = [
  {
    id: "server",
    sections: [
      {
        id: "listening",
        items: [
          { endpoint: "server/host", type: "text", fallback: "" },
          { endpoint: "server/port", type: "int", fallback: "8317" },
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
    id: "access",
    link: { to: "/api-keys", labelKey: "config.links.api_keys" },
    sections: [
      {
        id: "access",
        items: [{ endpoint: "access/api-keys", type: "list" }],
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
    id: "oauth",
    sections: [
      {
        id: "oauth",
        items: [
          { endpoint: "oauth/auth-dir", type: "text", fallback: "~/.cli-proxy-api" },
          { endpoint: "oauth/auth-auto-refresh-workers", type: "int", fallback: "16" },
          { endpoint: "oauth/settings", type: "json" },
          { endpoint: "oauth/request-scoped-errors", type: "json" },
        ],
      },
      {
        id: "aistudio",
        items: [{ endpoint: "oauth/providers/aistudio/ws-auth", type: "bool", fallback: true }],
      },
      {
        id: "codex",
        items: [
          { endpoint: "oauth/providers/codex/disable-codex-cloaking", type: "bool" },
          { endpoint: "oauth/providers/codex/header-defaults/user-agent", type: "text" },
          { endpoint: "oauth/providers/codex/header-defaults/beta-features", type: "text" },
          { endpoint: "oauth/providers/codex/model-level-cooling", type: "bool" },
          { endpoint: "oauth/providers/codex/response-steering", type: "bool" },
          { endpoint: "oauth/providers/codex/optimize-multi-agent-v2", type: "bool" },
          { endpoint: "oauth/providers/codex/orphan-delegation-compatibility", type: "bool" },
          { endpoint: "oauth/providers/codex/stream-bootstrap-buffering", type: "bool" },
          { endpoint: "oauth/providers/codex/stream-bootstrap-timeout", type: "text", fallback: "0" },
          { endpoint: "oauth/providers/codex/live-media-relay/enabled", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/max-sessions", type: "int", fallback: "32" },
          { endpoint: "oauth/providers/codex/live-media-relay/disable-private-remote-ips", type: "bool" },
          { endpoint: "oauth/providers/codex/live-media-relay/public-ip", type: "text" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-min", type: "int" },
          { endpoint: "oauth/providers/codex/live-media-relay/udp-port-max", type: "int" },
        ],
      },
      {
        id: "claude",
        items: [
          { endpoint: "oauth/providers/claude/disable-claude-cloak-mode", type: "bool" },
          { endpoint: "oauth/providers/claude/model-level-cooling", type: "bool" },
          { endpoint: "oauth/providers/claude/claude-code/disable-cloaking-model-list", type: "bool" },
          { endpoint: "oauth/providers/claude/header-defaults/user-agent", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/package-version", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/runtime-version", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/os", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/arch", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/timeout", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/timezone", type: "text" },
          { endpoint: "oauth/providers/claude/header-defaults/stabilize-device-profile", type: "bool" },
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
        id: "xai",
        items: [{ endpoint: "oauth/providers/xai/inject-x-search", type: "bool" }],
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
          { endpoint: "plugins/store-auth", type: "json" },
        ],
      },
    ],
  },
];

const SETTINGS = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items));
const SETTING_BY_ENDPOINT: Record<string, Setting> = Object.fromEntries(
  SETTINGS.map((setting) => [setting.endpoint, setting]),
);

/** 常用 tab:只引用 GROUPS 里已有的字段,不重复定义 */
const COMMON_ENDPOINTS = [
  "server/port",
  "management/secret-key",
  "oauth/auth-dir",
  "routing/strategy",
  "routing/session-affinity",
  "routing/retry/request-retry",
  "requests/proxy-url",
  "multimedia/disable-image-generation",
  "observability/logs/debug",
];

export const COMMON: Setting[] = COMMON_ENDPOINTS.map((endpoint) => {
  const setting = SETTING_BY_ENDPOINT[endpoint];
  if (!setting) throw new Error(`config.common 引用了不存在的配置项: ${endpoint}`);
  return setting;
});

function readPath(config: Json | undefined, endpoint: string): unknown {
  let node: unknown = config;
  for (const key of endpoint.split("/")) node = node && typeof node === "object" ? (node as Json)[key] : undefined;
  return node ?? undefined;
}

// 输入框里的文本转成写入值,非法返回 undefined
export function parseValue(type: Setting["type"], text: string): unknown {
  if (type === "int") return /^-?\d+$/.test(text.trim()) ? Number(text) : undefined;
  if (type === "list")
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  if (type === "json") {
    try {
      const value: unknown = JSON.parse(text);
      // json 字段既可存对象(如 oauth/settings),也可存数组(如 plugins/store-auth)
      return value !== null && typeof value === "object" ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return text;
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
      if (setting.type === "json") return JSON.stringify(value, null, 2);
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
        if (setting.type === "json") {
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
  } else if (setting.type === "list" || setting.type === "json") {
    control = (
      <Textarea
        id={id}
        aria-labelledby={labelId}
        value={text}
        onChange={(e) => setValue(setting, e.target.value)}
        aria-invalid={invalid}
        className="w-full sm:w-80 max-h-64 font-mono text-xs md:text-xs"
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

  return (
    <div
      className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between transition-colors ${
        isModified ? "bg-primary/5 rounded-lg px-3 -mx-3" : ""
      }`}
    >
      <div className="min-w-0 pr-4">
        <div className="flex items-center gap-2">
          <Label id={labelId} className="font-medium text-sm">
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
      <div className="shrink-0">{control}</div>
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

export function SettingsCommon() {
  return (
    <SettingsState>
      <SettingList items={COMMON} />
    </SettingsState>
  );
}

export function SettingsGroup({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t(`config.groups.${group.id}`)}</p>
      <SettingsState>
        {group.sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <h3 className="text-sm font-medium">{t(`config.sections.${group.id}.${section.id}`)}</h3>
            <SettingList items={section.items} />
          </section>
        ))}
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
