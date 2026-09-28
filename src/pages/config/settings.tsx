import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import type React from "react";
import { createContext, useCallback, useContext, useId, useState } from "react";
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
import { api, CONFIG_KEY, configPath, configQuery, orNotFound, replaceKey } from "@/lib/api";

export type Json = Record<string, unknown>;

// 文案取自 i18n：config.fields.<endpoint>.{label,hint,options.<value>}，config.groups.<id>
// list 为每行一项的字符串数组，json 为 JSON 对象
export type Setting = {
  endpoint: string;
  type: "bool" | "int" | "text" | "password" | "select" | "list" | "json";
  options?: string[];
  fallback?: string | boolean;
};

export type ConfigGroup = {
  id: string;
  items: Setting[];
};

/**
 * 严格参照 CPA 8.0 官方文档 (configuration/options) 与 internal/config 结构体构建的分组结构
 */
export const GROUPS: ConfigGroup[] = [
  {
    id: "server",
    items: [
      { endpoint: "server/host", type: "text", fallback: "" },
      { endpoint: "server/port", type: "int", fallback: "8317" },
      { endpoint: "server/trusted-proxies", type: "list" },
      { endpoint: "server/commercial-mode", type: "bool" },
      { endpoint: "server/discovery/enabled", type: "bool" },
      { endpoint: "server/tls/enable", type: "bool" },
      { endpoint: "server/tls/cert", type: "text" },
      { endpoint: "server/tls/key", type: "text" },
    ],
  },
  {
    id: "management",
    items: [
      { endpoint: "management/allow-remote", type: "bool" },
      { endpoint: "management/secret-key", type: "password" },
      { endpoint: "management/disable-control-panel", type: "bool" },
      { endpoint: "management/disable-auto-update-panel", type: "bool" },
      { endpoint: "management/panel-github-repository", type: "text" },
    ],
  },
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
      { endpoint: "routing/retry/request-retry", type: "int" },
      { endpoint: "routing/retry/max-retry-credentials", type: "int" },
      { endpoint: "routing/retry/max-retry-interval", type: "int" },
      { endpoint: "routing/cooldown/disable-cooling", type: "bool" },
      { endpoint: "routing/cooldown/save-cooldown-status", type: "bool" },
      { endpoint: "routing/cooldown/transient-error-cooldown-seconds", type: "int" },
    ],
  },
  {
    id: "requests",
    items: [
      { endpoint: "requests/proxy-url", type: "text" },
      { endpoint: "requests/passthrough-headers", type: "bool" },
      { endpoint: "requests/streaming/keepalive-seconds", type: "int" },
      { endpoint: "requests/streaming/bootstrap-retries", type: "int" },
      { endpoint: "requests/nonstream-keepalive-interval", type: "int" },
    ],
  },
  {
    id: "oauth",
    items: [
      { endpoint: "oauth/auth-dir", type: "text", fallback: "~/.cli-proxy-api" },
      { endpoint: "oauth/auth-auto-refresh-workers", type: "int", fallback: "16" },
      { endpoint: "oauth/request-scoped-errors", type: "json" },
      { endpoint: "oauth/providers/aistudio/ws-auth", type: "bool", fallback: true },
      { endpoint: "oauth/providers/codex/identity-confuse", type: "bool" },
      { endpoint: "oauth/providers/codex/disable-codex-cloaking", type: "bool" },
      { endpoint: "oauth/providers/codex/model-level-cooling", type: "bool" },
      { endpoint: "oauth/providers/codex/stream-bootstrap-buffering", type: "bool" },
      { endpoint: "oauth/providers/codex/stream-bootstrap-timeout", type: "text", fallback: "0" },
      { endpoint: "oauth/providers/codex/response-steering", type: "bool" },
      { endpoint: "oauth/providers/codex/optimize-multi-agent-v2", type: "bool" },
      { endpoint: "oauth/providers/codex/header-defaults/user-agent", type: "text" },
      { endpoint: "oauth/providers/claude/disable-claude-cloak-mode", type: "bool" },
      { endpoint: "oauth/providers/claude/model-level-cooling", type: "bool" },
      { endpoint: "oauth/providers/claude/claude-code/disable-cloaking-model-list", type: "bool" },
      { endpoint: "oauth/providers/claude/header-defaults/stabilize-device-profile", type: "bool" },
      { endpoint: "oauth/providers/claude/header-defaults/user-agent", type: "text" },
      { endpoint: "oauth/providers/xai/inject-x-search", type: "bool" },
      { endpoint: "oauth/providers/antigravity/antigravity-credits", type: "bool" },
      { endpoint: "oauth/providers/antigravity/signature-cache-enabled", type: "bool", fallback: true },
      { endpoint: "oauth/providers/antigravity/signature-bypass-strict", type: "bool" },
      { endpoint: "oauth/providers/antigravity/connection-pool/enabled", type: "bool" },
      { endpoint: "oauth/providers/antigravity/connection-pool/idle-conn-timeout", type: "text", fallback: "30s" },
      { endpoint: "oauth/providers/antigravity/connection-pool/max-idle-conns-per-host", type: "int", fallback: "2" },
    ],
  },
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
  {
    id: "observability",
    items: [
      { endpoint: "observability/logs/debug", type: "bool" },
      { endpoint: "observability/logs/logging-to-file", type: "bool" },
      { endpoint: "observability/logs/request-log", type: "bool" },
      { endpoint: "observability/logs/logs-max-total-size-mb", type: "int" },
      { endpoint: "observability/logs/error-logs-max-files", type: "int", fallback: "10" },
      { endpoint: "observability/usage/usage-statistics-enabled", type: "bool" },
      { endpoint: "observability/usage/redis-usage-queue-retention-seconds", type: "int", fallback: "60" },
      { endpoint: "observability/pprof/enable", type: "bool" },
      { endpoint: "observability/pprof/addr", type: "text", fallback: "127.0.0.1:8316" },
    ],
  },
  {
    id: "plugins",
    items: [
      { endpoint: "plugins/enabled", type: "bool" },
      { endpoint: "plugins/dir", type: "text", fallback: "plugins" },
      { endpoint: "plugins/store-sources", type: "list" },
    ],
  },
];

const SETTINGS = GROUPS.flatMap((g) => g.items);

function readPath(config: Json | undefined, endpoint: string): unknown {
  let node: unknown = config;
  for (const key of endpoint.split("/")) node = node && typeof node === "object" ? (node as Json)[key] : undefined;
  return node ?? undefined;
}

// 输入框里的文本转成写入值,非法返回 undefined
function parseValue(type: Setting["type"], text: string): unknown {
  if (type === "int") return /^-?\d+$/.test(text.trim()) ? Number(text) : undefined;
  if (type === "list")
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  if (type === "json") {
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
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
      toast.error(t("config.save_failed", { message: err.message }));
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
export function SettingsGroup({ groupId }: { groupId: string }) {
  const { t } = useI18n();
  const { isPending, error } = useConfigSettings();
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`config.groups.${group.id}`)}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("config.yaml.load_failed", { message: error.message })}
        </p>
      ) : isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="divide-y border-y">
          {group.items.map((setting) => (
            <SettingField key={setting.endpoint} setting={setting} />
          ))}
        </div>
      )}
    </div>
  );
}
