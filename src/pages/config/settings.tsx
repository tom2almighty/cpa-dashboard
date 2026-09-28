import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import React, { createContext, useCallback, useContext, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import * as YAML from "yaml";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/context";
import { api, saveKey } from "@/lib/api";

export type Json = Record<string, unknown>;

// 文案取自 i18n：config.fields.<endpoint>.{label,hint,options.<value>}，config.groups.<id>
export type Setting = {
  endpoint: string;
  type: "bool" | "int" | "text" | "password" | "select";
  options?: string[];
  fallback?: string;
};

export type ConfigGroup = {
  id: string;
  items: Setting[];
};

/**
 * 严格参照 CPA 8.0 官方文档 (configuration/options) 与生产实践构建的分组结构
 */
export const GROUPS: ConfigGroup[] = [
  {
    id: "server",
    items: [
      {
        endpoint: "server/host",
        type: "text",
        fallback: "",
      },
      {
        endpoint: "server/port",
        type: "int",
        fallback: "8317",
      },
      {
        endpoint: "server/commercial-mode",
        type: "bool",
      },
      {
        endpoint: "server/tls/enable",
        type: "bool",
      },
      {
        endpoint: "server/tls/cert",
        type: "text",
      },
      {
        endpoint: "server/tls/key",
        type: "text",
      },
    ],
  },
  {
    id: "management",
    items: [
      {
        endpoint: "management/allow-remote",
        type: "bool",
      },
      {
        endpoint: "management/secret-key",
        type: "password",
      },
      {
        endpoint: "management/disable-control-panel",
        type: "bool",
      },
      {
        endpoint: "management/disable-auto-update-panel",
        type: "bool",
      },
      {
        endpoint: "management/panel-github-repository",
        type: "text",
      },
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
      {
        endpoint: "routing/session-affinity",
        type: "bool",
      },
      {
        endpoint: "routing/session-affinity-subagents",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "routing/session-affinity-ttl",
        type: "text",
        fallback: "1h",
      },
      {
        endpoint: "routing/force-model-prefix",
        type: "bool",
      },
      {
        endpoint: "routing/retry/request-retry",
        type: "int",
        fallback: "3",
      },
      {
        endpoint: "routing/retry/max-retry-credentials",
        type: "int",
      },
      {
        endpoint: "routing/retry/max-retry-interval",
        type: "int",
      },
      {
        endpoint: "routing/cooldown/disable-cooling",
        type: "bool",
      },
      {
        endpoint: "routing/cooldown/save-cooldown-status",
        type: "bool",
      },
      {
        endpoint: "routing/cooldown/transient-error-cooldown-seconds",
        type: "int",
      },
    ],
  },
  {
    id: "requests",
    items: [
      {
        endpoint: "requests/proxy-url",
        type: "text",
      },
      {
        endpoint: "requests/passthrough-headers",
        type: "bool",
      },
      {
        endpoint: "requests/streaming/keepalive-seconds",
        type: "int",
      },
      {
        endpoint: "requests/streaming/bootstrap-retries",
        type: "int",
      },
      {
        endpoint: "requests/nonstream-keepalive-interval",
        type: "text",
      },
    ],
  },
  {
    id: "oauth",
    items: [
      {
        endpoint: "oauth/auth-dir",
        type: "text",
        fallback: "~/.cli-proxy-api",
      },
      {
        endpoint: "oauth/auth-auto-refresh-workers",
        type: "int",
        fallback: "16",
      },
      {
        endpoint: "oauth/providers/aistudio/ws-auth",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/codex/identity-confuse",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/disable-claude-cloak-mode",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/antigravity/antigravity-credits",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/antigravity/signature-cache-enabled",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/antigravity/signature-bypass-strict",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/header-defaults/stabilize-device-profile",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/header-defaults/user-agent",
        type: "text",
      },
      {
        endpoint: "oauth/providers/codex/header-defaults/user-agent",
        type: "text",
      },
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
      {
        endpoint: "multimedia/gpt-image-2-base-model",
        type: "text",
        fallback: "gpt-5.4-mini",
      },
      {
        endpoint: "multimedia/video-result-auth-cache-ttl",
        type: "text",
        fallback: "3h",
      },
    ],
  },
  {
    id: "observability",
    items: [
      {
        endpoint: "observability/logs/debug",
        type: "bool",
      },
      {
        endpoint: "observability/logs/logging-to-file",
        type: "bool",
      },
      {
        endpoint: "observability/logs/request-log",
        type: "bool",
      },
      {
        endpoint: "observability/logs/logs-max-total-size-mb",
        type: "int",
      },
      {
        endpoint: "observability/logs/error-logs-max-files",
        type: "int",
        fallback: "10",
      },
      {
        endpoint: "observability/usage/usage-statistics-enabled",
        type: "bool",
      },
      {
        endpoint: "observability/usage/redis-usage-queue-retention-seconds",
        type: "int",
        fallback: "60",
      },
      {
        endpoint: "observability/pprof/enable",
        type: "bool",
      },
      {
        endpoint: "observability/pprof/addr",
        type: "text",
        fallback: "127.0.0.1:8316",
      },
    ],
  },
  {
    id: "plugins",
    items: [
      {
        endpoint: "plugins/enabled",
        type: "bool",
      },
      {
        endpoint: "plugins/dir",
        type: "text",
        fallback: "plugins",
      },
    ],
  },
];

type ConfigYamlContextType = {
  rawYaml: string | undefined;
  doc: YAML.Document | null;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  patch: Record<string, unknown>;
  dirtyCount: number;
  getValue: (endpoint: string, fallback?: string) => unknown;
  setValue: (endpoint: string, value: unknown) => void;
  resetPatch: () => void;
  saveAll: () => Promise<void>;
  isSaving: boolean;
};

const ConfigYamlContext = createContext<ConfigYamlContextType | null>(null);

export function useConfigYaml() {
  const ctx = useContext(ConfigYamlContext);
  if (!ctx) throw new Error("useConfigYaml must be used within ConfigYamlProvider");
  return ctx;
}

export function ConfigYamlProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const {
    data: rawYaml,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["cpa", "config.yaml"],
    queryFn: () => api<string>("/v8/management/config.yaml"),
    refetchOnWindowFocus: false,
  });

  const doc = useMemo(() => {
    if (rawYaml === undefined) return null;
    try {
      return YAML.parseDocument(rawYaml);
    } catch {
      return null;
    }
  }, [rawYaml]);

  const [patch, setPatch] = useState<Record<string, unknown>>({});

  const readDocNode = useCallback((d: YAML.Document | null, endpoint: string): unknown => {
    if (!d) return undefined;
    const keys = endpoint.split("/");
    const val = d.getIn(keys);
    if (val === undefined || val === null) return undefined;
    if (val && typeof val === "object" && "toJSON" in val && typeof val.toJSON === "function") {
      return val.toJSON();
    }
    return val;
  }, []);

  const getValue = useCallback(
    (endpoint: string, fallback?: string): unknown => {
      if (Object.hasOwn(patch, endpoint)) {
        return patch[endpoint];
      }
      const fromDoc = readDocNode(doc, endpoint);
      return fromDoc !== undefined ? fromDoc : fallback;
    },
    [patch, doc, readDocNode],
  );

  const setValue = useCallback(
    (endpoint: string, nextVal: unknown) => {
      setPatch((prev) => {
        const orig = readDocNode(doc, endpoint);
        if (String(orig ?? "") === String(nextVal ?? "")) {
          const next = { ...prev };
          delete next[endpoint];
          return next;
        }
        return { ...prev, [endpoint]: nextVal };
      });
    },
    [doc, readDocNode],
  );

  const resetPatch = useCallback(() => {
    setPatch({});
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const [endpoint, value] of Object.entries(patch)) {
        const path = endpoint;
        if (value === undefined || value === null || value === "") {
          await api(`/v8/management/config/${path}`, { method: "DELETE" }).catch(() => {});
        } else {
          await api(`/v8/management/config/${path}`, {
            method: "PUT",
            body: value,
          });
        }
      }

      if (patch["management/secret-key"]) {
        saveKey(String(patch["management/secret-key"]), true);
      }
    },
    onSuccess: () => {
      setPatch({});
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success(t("config.save_success"));
    },
    onError: (err: Error) => {
      toast.error(t("config.save_failed", { message: err.message }));
    },
  });

  const dirtyCount = Object.keys(patch).length;

  return (
    <ConfigYamlContext.Provider
      value={{
        rawYaml,
        doc,
        isPending,
        isError,
        error: error as Error | null,
        patch,
        dirtyCount,
        getValue,
        setValue,
        resetPatch,
        saveAll: async () => {
          await saveMutation.mutateAsync();
        },
        isSaving: saveMutation.isPending,
      }}
    >
      {children}
    </ConfigYamlContext.Provider>
  );
}

export function SettingField({ setting }: { setting: Setting }) {
  const { t } = useI18n();
  const { getValue, setValue, patch } = useConfigYaml();
  const id = useId();
  const isSecretKey = setting.endpoint === "management/secret-key";
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const isModified = Object.hasOwn(patch, setting.endpoint);
  const currentValue = getValue(setting.endpoint, setting.fallback);

  const initial = currentValue !== undefined && currentValue !== null ? String(currentValue) : "";
  const [draft, setDraft] = useState(initial);

  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const copyValue = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft).then(
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
        checked={currentValue === true}
        onCheckedChange={(checked) => setValue(setting.endpoint, checked)}
      />
    );
  } else if (setting.type === "select") {
    const options = setting.options?.map((value) => ({
      value,
      label: t(`config.fields.${setting.endpoint}.options.${value}`),
    }));
    control = (
      <Select items={options} value={initial || null} onValueChange={(val) => val && setValue(setting.endpoint, val)}>
        <SelectTrigger id={id} className="min-w-44 w-auto max-w-xs sm:max-w-sm">
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
    const hasConfigured = Boolean(currentValue);
    const placeholder = isSecretKey
      ? hasConfigured
        ? t("config.settings.secret_key_set")
        : t("config.settings.secret_key_unset")
      : currentValue
        ? "••••••••"
        : t("config.settings.password_unset");

    control = (
      <div className="relative w-full sm:w-80">
        <Input
          id={id}
          type={showPassword ? "text" : "password"}
          value={draft}
          onChange={(e) => {
            const val = e.target.value;
            setDraft(val);
            if (isSecretKey) {
              setValue(setting.endpoint, val.trim() ? val : "");
            } else {
              setValue(setting.endpoint, val);
            }
          }}
          placeholder={placeholder}
          className="w-full pr-9 text-xs font-mono"
        />
        {draft && (
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
  } else {
    const isInt = setting.type === "int";
    const invalid = isInt && draft !== "" && !/^\d+$/.test(draft);
    control = (
      <div className="flex items-center gap-1.5 w-full sm:w-80">
        <Input
          id={id}
          value={draft}
          inputMode={isInt ? "numeric" : undefined}
          onChange={(e) => {
            const val = e.target.value;
            setDraft(val);
            if (isInt) {
              if (val === "" || /^\d+$/.test(val)) {
                setValue(setting.endpoint, val === "" ? "" : Number(val));
              }
            } else {
              setValue(setting.endpoint, val);
            }
          }}
          className={`flex-1 text-xs ${isInt ? "font-mono" : ""} ${invalid ? "border-destructive focus-visible:ring-destructive" : ""}`}
        />
        {draft && setting.type === "text" && (
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
          <Label htmlFor={id} className="cursor-pointer font-medium text-sm">
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
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`config.groups.${group.id}`)}</p>
      <div className="divide-y border-y">
        {group.items.map((setting) => (
          <SettingField key={setting.endpoint} setting={setting} />
        ))}
      </div>
    </div>
  );
}
