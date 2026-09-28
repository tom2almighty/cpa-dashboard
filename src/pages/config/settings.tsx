import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, RotateCcw, Save } from "lucide-react";
import React, { createContext, useCallback, useContext, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import * as YAML from "yaml";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, saveKey } from "@/lib/api";

export type Json = Record<string, unknown>;

export type Setting = {
  endpoint: string;
  label: string;
  hint?: string;
  type: "bool" | "int" | "text" | "password" | "select";
  options?: { value: string; label: string }[];
  fallback?: string;
};

export type ConfigGroup = {
  id: string;
  title: string;
  description?: string;
  items: Setting[];
};

/**
 * 严格参照 CPA 8.0 官方文档 (configuration/options) 与生产实践构建的分组结构
 */
export const GROUPS: ConfigGroup[] = [
  {
    id: "server",
    title: "服务器 (Server)",
    description: "HTTP/HTTPS 监听地址、端口与通用服务行为",
    items: [
      {
        endpoint: "server/host",
        label: "监听主机 (Host)",
        hint: "绑定地址，空值或 0.0.0.0 监听所有接口，127.0.0.1 仅限本机",
        type: "text",
        fallback: "",
      },
      {
        endpoint: "server/port",
        label: "服务端口 (Port)",
        hint: "CPA 核心监听端口，默认 8317",
        type: "int",
        fallback: "8317",
      },
      {
        endpoint: "server/commercial-mode",
        label: "高并发模式 (Commercial Mode)",
        hint: "关闭高开销请求日志与非必要中间件以最小化内存占用",
        type: "bool",
      },
      {
        endpoint: "server/tls/enable",
        label: "启用 HTTPS (TLS)",
        hint: "开启内置 HTTPS 服务",
        type: "bool",
      },
      {
        endpoint: "server/tls/cert",
        label: "TLS 证书路径",
        hint: "服务器 SSL/TLS 证书文件路径（.crt 或 .pem）",
        type: "text",
      },
      {
        endpoint: "server/tls/key",
        label: "TLS 私钥路径",
        hint: "服务器 SSL/TLS 私钥文件路径（.key）",
        type: "text",
      },
    ],
  },
  {
    id: "management",
    title: "管理 API (Management)",
    description: "管理接口权限与内置管理面板控制",
    items: [
      {
        endpoint: "management/allow-remote",
        label: "允许远程管理 (Allow Remote)",
        hint: "允许来自非 localhost 的客户端访问管理 API。注：环境变量 MANAGEMENT_PASSWORD 即使在此处为 false 也允许远程访问",
        type: "bool",
      },
      {
        endpoint: "management/secret-key",
        label: "管理密钥 (Secret Key)",
        hint: "管理密钥原文。保存后由 CPA 进行 bcrypt 哈希存储，留空保持不变",
        type: "password",
      },
      {
        endpoint: "management/disable-control-panel",
        label: "禁用管理面板",
        hint: "禁用 CPA 内置管理面板资源托管与前端路由",
        type: "bool",
      },
      {
        endpoint: "management/disable-auto-update-panel",
        label: "禁用面板后台自动更新",
        hint: "禁用 CPA 在后台定时检查并下载管理面板最新 Release",
        type: "bool",
      },
      {
        endpoint: "management/panel-github-repository",
        label: "面板更新发布仓库",
        hint: "管理面板自动拉取的 GitHub 仓库，默认 tom2almighty/cpa-dashboard",
        type: "text",
      },
    ],
  },
  {
    id: "routing",
    title: "凭据路由与容灾 (Routing)",
    description: "负载均衡算法、会话粘性、轮次重试与冷却熔断机制",
    items: [
      {
        endpoint: "routing/strategy",
        label: "凭据选择策略 (Strategy)",
        hint: "支持轮询、加权轮询以及贪婪用满单凭据 (fill-first)",
        type: "select",
        options: [
          { value: "round-robin", label: "轮询 (round-robin)" },
          { value: "weighted-round-robin", label: "加权轮询 (weighted-round-robin)" },
          { value: "fill-first", label: "优先用满一个 (fill-first)" },
        ],
        fallback: "round-robin",
      },
      {
        endpoint: "routing/session-affinity",
        label: "会话粘性 (Session Affinity)",
        hint: "将会话固定路由到同一账号以最大化 Prompt Cache 命中率",
        type: "bool",
      },
      {
        endpoint: "routing/session-affinity-subagents",
        label: "子代理会话继承",
        hint: "子会话继承父级绑定的凭据，优化 Claude、Codex 多 Agent 缓存",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "routing/session-affinity-ttl",
        label: "会话粘性保留时长 (TTL)",
        hint: "例如 1h、30m",
        type: "text",
        fallback: "1h",
      },
      {
        endpoint: "routing/force-model-prefix",
        label: "强制模型前缀匹配",
        hint: "无前缀请求仅使用无前缀凭据，防止模型名污染",
        type: "bool",
      },
      {
        endpoint: "routing/retry/request-retry",
        label: "故障重试轮次",
        hint: "发生 429/500/503 时的额外重试轮次，默认 3",
        type: "int",
        fallback: "3",
      },
      {
        endpoint: "routing/retry/max-retry-credentials",
        label: "每轮最大重试凭据数",
        hint: "0 表示尝试所有符合条件的可用凭据",
        type: "int",
      },
      {
        endpoint: "routing/retry/max-retry-interval",
        label: "两轮间最大冷却等待（秒）",
        hint: "两轮重试之间等待凭据冷却的最大秒数",
        type: "int",
      },
      {
        endpoint: "routing/cooldown/disable-cooling",
        label: "全局禁用冷却",
        hint: "完全关闭凭据或模型失败后的拉黑与冷却等待",
        type: "bool",
      },
      {
        endpoint: "routing/cooldown/save-cooldown-status",
        label: "持久化冷却状态",
        hint: "将凭据冷却状态以 .cds 文件持久化保存在凭据目录",
        type: "bool",
      },
      {
        endpoint: "routing/cooldown/transient-error-cooldown-seconds",
        label: "瞬态网络错误冷却时间（秒）",
        hint: "408/500/502/504 等临时错误的冷却秒数，0 为 60 秒，-1 为禁用",
        type: "int",
      },
    ],
  },
  {
    id: "requests",
    title: "出站请求与流式 (Requests)",
    description: "上游全局代理、响应头透传与长连接心跳保活",
    items: [
      {
        endpoint: "requests/proxy-url",
        label: "全局出站代理 (Proxy URL)",
        hint: "所有上游请求默认走的网络代理，例如 socks5://127.0.0.1:1080 或 http://proxy:7890，留空直连",
        type: "text",
      },
      {
        endpoint: "requests/passthrough-headers",
        label: "透传上游响应头",
        hint: "将筛选后的上游响应 Header 原样转发给客户端",
        type: "bool",
      },
      {
        endpoint: "requests/streaming/keepalive-seconds",
        label: "流式 SSE 保活心跳（秒）",
        hint: "SSE 流式连接保活注释发送间隔，0 表示禁用",
        type: "int",
      },
      {
        endpoint: "requests/streaming/bootstrap-retries",
        label: "流式启动安全重试次数",
        hint: "首字节发送前发生网络协议错误时的重试次数",
        type: "int",
      },
      {
        endpoint: "requests/nonstream-keepalive-interval",
        label: "非流式长请求保活间隔",
        hint: "为非流式长请求定期发送空行保活，例如 10s、30s",
        type: "text",
      },
    ],
  },
  {
    id: "oauth",
    title: "OAuth 与凭据存储 (OAuth & Credentials)",
    description: "认证文件目录、自动刷新并发及各大官方上游参数",
    items: [
      {
        endpoint: "oauth/auth-dir",
        label: "凭据存储目录 (Auth Dir)",
        hint: "存放账号 JSON 认证文件的目录，支持 ~ 路径。默认 ~/.cli-proxy-api",
        type: "text",
        fallback: "~/.cli-proxy-api",
      },
      {
        endpoint: "oauth/auth-auto-refresh-workers",
        label: "凭据自动刷新工作线程数",
        hint: "后台自动刷新 OAuth Token 的并发并发数，默认 16",
        type: "int",
        fallback: "16",
      },
      {
        endpoint: "oauth/providers/aistudio/ws-auth",
        label: "AI Studio /ws 路由鉴权",
        hint: "为 /v1/ws 路由强制要求客户端携带有效密钥",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/codex/identity-confuse",
        label: "Codex 身份混淆映射",
        hint: "按选定凭据重映射 Codex 缓存 key 与安装标识",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/disable-claude-cloak-mode",
        label: "禁用 Claude 伪装",
        hint: "不伪装 Claude Code 客户端指纹和系统提示词，原样透传",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/antigravity/antigravity-credits",
        label: "Antigravity 超额使用 Credits",
        hint: "免费额度耗尽（429/503）时，允许使用带有付费积分的凭据重试",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/antigravity/signature-cache-enabled",
        label: "Antigravity 思考签名缓存",
        hint: "缓存并验证思考块签名以大幅提升多并发吞吐与稳定性",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "oauth/providers/antigravity/signature-bypass-strict",
        label: "Antigravity 严格签名绕过",
        hint: "绕过严格 Protobuf 签名校验（实验性），用于兼容特定调用",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/header-defaults/stabilize-device-profile",
        label: "Claude 设备配置指纹稳定化",
        hint: "为每个凭据将 OS 与系统架构固定为基准值，降低风控概率",
        type: "bool",
      },
      {
        endpoint: "oauth/providers/claude/header-defaults/user-agent",
        label: "Claude 默认 User-Agent",
        hint: "客户端未携带时填补的 Claude Code CLI 基准 User-Agent",
        type: "text",
      },
      {
        endpoint: "oauth/providers/codex/header-defaults/user-agent",
        label: "Codex 默认 User-Agent",
        hint: "客户端未提供时使用的官方 Codex User-Agent",
        type: "text",
      },
    ],
  },
  {
    id: "multimedia",
    title: "多媒体 (Multimedia)",
    description: "图像与视频生成的重定向与缓存参数",
    items: [
      {
        endpoint: "multimedia/disable-image-generation",
        label: "图像生成行为控制",
        hint: "控制模型图片生成行为：允许、全局禁用、仅允许图像接口或原样透传",
        type: "select",
        options: [
          { value: "false", label: "允许生图（默认）" },
          { value: "true", label: "全局禁用生图" },
          { value: "chat", label: "仅允许独立生图接口" },
          { value: "passthrough", label: "原样透传" },
        ],
        fallback: "false",
      },
      {
        endpoint: "multimedia/gpt-image-2-base-model",
        label: "生图基础模型",
        hint: "用于解析与理解生图指令的模型，默认 gpt-5.4-mini",
        type: "text",
        fallback: "gpt-5.4-mini",
      },
      {
        endpoint: "multimedia/video-result-auth-cache-ttl",
        label: "视频凭据绑定缓存时效",
        hint: "视频 ID 与创建凭据的绑定时长，默认 3h",
        type: "text",
        fallback: "3h",
      },
    ],
  },
  {
    id: "observability",
    title: "可观测性 (Observability)",
    description: "调试日志、滚动文件日志、用量统计及性能分析",
    items: [
      {
        endpoint: "observability/logs/debug",
        label: "调试模式 (Debug)",
        hint: "输出更详细的网关内部运行与路由调度日志",
        type: "bool",
      },
      {
        endpoint: "observability/logs/logging-to-file",
        label: "应用日志写入文件",
        hint: "将应用日志输出到日志目录中的滚动文件",
        type: "bool",
      },
      {
        endpoint: "observability/logs/request-log",
        label: "记录完整请求报文",
        hint: "记录完整的 HTTP 请求报文与响应体，排查错误时建议临时开启",
        type: "bool",
      },
      {
        endpoint: "observability/logs/logs-max-total-size-mb",
        label: "日志总大小上限（MB）",
        hint: "0 表示不限制",
        type: "int",
      },
      {
        endpoint: "observability/logs/error-logs-max-files",
        label: "错误日志保留个数",
        hint: "请求日志关闭时保留的 error-*.log 文件数",
        type: "int",
        fallback: "10",
      },
      {
        endpoint: "observability/usage/usage-statistics-enabled",
        label: "启用用量统计",
        hint: "开启后 CPA 会将请求推入用量队列供面板采集；若关闭则面板无法统计用量",
        type: "bool",
      },
      {
        endpoint: "observability/usage/redis-usage-queue-retention-seconds",
        label: "用量队列内存保留时间（秒）",
        hint: "用量记录在内存队列中的保留时限，最大 3600 秒",
        type: "int",
        fallback: "60",
      },
      {
        endpoint: "observability/pprof/enable",
        label: "启用 pprof 性能分析",
        hint: "开启内置 Go 运行时性能分析 HTTP 服务",
        type: "bool",
      },
      {
        endpoint: "observability/pprof/addr",
        label: "pprof 监听地址",
        hint: "建议仅绑定本机例如 127.0.0.1:8316",
        type: "text",
        fallback: "127.0.0.1:8316",
      },
    ],
  },
  {
    id: "plugins",
    title: "插件系统 (Plugins)",
    description: "动态二进制插件发现与受信任执行控制",
    items: [
      {
        endpoint: "plugins/enabled",
        label: "启用插件功能",
        hint: "开启受信任的进程内动态二进制插件系统",
        type: "bool",
      },
      {
        endpoint: "plugins/dir",
        label: "插件发现目录",
        hint: "插件动态库或二进制发现目录，默认 plugins",
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
      toast.success("配置已保存，CPA 会自动重新加载生效");
    },
    onError: (err: Error) => {
      toast.error(`保存失败：${err.message}`);
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
        toast.success("已复制配置值");
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("复制失败"),
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
    control = (
      <Select
        items={setting.options}
        value={initial || null}
        onValueChange={(val) => val && setValue(setting.endpoint, val)}
      >
        <SelectTrigger id={id} className="min-w-44 w-auto max-w-xs sm:max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.options?.map((o) => (
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
        ? "已设置管理密钥（留空保持不变，输入新密钥覆盖）"
        : "未设置管理密钥（输入以配置）"
      : currentValue
        ? "••••••••"
        : "未设置密码";

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
              title={showPassword ? "隐藏密钥" : "显示明文密钥"}
              aria-label={showPassword ? "隐藏密钥" : "显示明文密钥"}
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
            title="复制"
            aria-label="复制配置值"
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
            {setting.label}
          </Label>
          {isModified && (
            <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 text-primary border-primary/30 font-normal">
              已修改
            </Badge>
          )}
        </div>
        {setting.hint && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{setting.hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
export function SettingsGroup({ groupId }: { groupId: string }) {
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;

  return (
    <div className="space-y-4">
      {group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}
      <div className="divide-y border-y">
        {group.items.map((setting) => (
          <SettingField key={setting.endpoint} setting={setting} />
        ))}
      </div>
    </div>
  );
}
export function SettingsForm() {
  const { dirtyCount, resetPatch, saveAll, isSaving } = useConfigYaml();

  return (
    <div className="space-y-10">
      {dirtyCount > 0 && (
        <div className="sticky top-16 z-20 flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-background/95 p-4 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium">有 {dirtyCount} 项配置已修改</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetPatch} disabled={isSaving}>
              <RotateCcw className="size-3.5" />
              放弃修改
            </Button>
            <Button size="sm" onClick={() => saveAll()} disabled={isSaving}>
              {isSaving ? <Spinner className="size-3.5" /> : <Save className="size-3.5" />}
              保存并热加载
            </Button>
          </div>
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.id} aria-labelledby={`group-${g.id}`} className="space-y-2">
          <div className="border-b pb-2">
            <h2 id={`group-${g.id}`} className="text-lg font-semibold tracking-tight">
              {g.title}
            </h2>
            {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
          </div>
          <div className="divide-y">
            {g.items.map((setting) => (
              <SettingField key={setting.endpoint} setting={setting} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
