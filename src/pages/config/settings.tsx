import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export type Json = Record<string, unknown>;

type Setting = {
  // 对应 /v0/management/<endpoint>,请求体 {value}
  endpoint: string;
  label: string;
  hint?: string;
  type: "bool" | "int" | "text" | "select";
  options?: { value: string; label: string }[];
  // 配置里没写这一项时 CPA 使用的默认值
  fallback?: string;
};

type ConfigGroup = {
  id: string;
  title: string;
  items: Setting[];
};

export const GROUPS: ConfigGroup[] = [
  {
    id: "connectivity",
    title: "服务与连接",
    items: [
      {
        endpoint: "host",
        label: "监听主机",
        hint: "CPA 绑定的主机 IP 地址，例如 0.0.0.0 或 127.0.0.1",
        type: "text",
        fallback: "0.0.0.0",
      },
      {
        endpoint: "port",
        label: "服务端口",
        hint: "CPA 服务监听端口，默认 8317",
        type: "int",
        fallback: "8317",
      },
      {
        endpoint: "auth-dir",
        label: "认证凭证目录",
        hint: "认证文件存储目录路径，支持 ~ 路径，默认 ~/.cli-proxy-api",
        type: "text",
        fallback: "~/.cli-proxy-api",
      },
      {
        endpoint: "remote-management/allow-remote",
        label: "允许远程管理",
        hint: "允许非本机（如局域网、公网反代）访问 /v0/management 接口与管理面板",
        type: "bool",
      },
      {
        endpoint: "remote-management/secret-key",
        label: "管理密钥 (Secret Key)",
        hint: "管理接口访问密钥，修改保存后需以新密钥重新登录",
        type: "text",
      },
      {
        endpoint: "remote-management/disable-control-panel",
        label: "禁用管理面板",
        hint: "禁用 CPA 内置管理面板资源托管与前端路由",
        type: "bool",
      },
      {
        endpoint: "remote-management/disable-auto-update-panel",
        label: "禁用面板后台自动更新",
        hint: "禁用 CPA 在后台定时自动拉取并更新 management.html",
        type: "bool",
      },
      {
        endpoint: "remote-management/panel-github-repository",
        label: "面板更新发布仓库",
        hint: "管理面板发布的 GitHub 仓库地址，用于自动拉取更新",
        type: "text",
      },
      {
        endpoint: "tls/enable",
        label: "启用 HTTPS (TLS)",
        hint: "开启内置 HTTPS 服务",
        type: "bool",
      },
      {
        endpoint: "tls/cert",
        label: "TLS 证书路径",
        hint: "服务器 SSL/TLS 证书路径（.crt 或 .pem）",
        type: "text",
      },
      {
        endpoint: "tls/key",
        label: "TLS 私钥路径",
        hint: "服务器 SSL/TLS 私钥路径（.key）",
        type: "text",
      },
    ],
  },
  {
    id: "network",
    title: "网络与路由",
    items: [
      {
        endpoint: "proxy-url",
        label: "全局代理",
        hint: "上游请求走的代理，例如 socks5://127.0.0.1:1080，留空表示直连",
        type: "text",
      },
      {
        endpoint: "force-model-prefix",
        label: "强制模型前缀",
        hint: "只允许用带前缀的模型名访问配置了前缀的凭据",
        type: "bool",
      },
      { endpoint: "ws-auth", label: "WebSocket 鉴权", hint: "/ws 路由要求携带 API Key", type: "bool" },
      {
        endpoint: "routing/strategy",
        label: "凭据选择策略",
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
        label: "会话粘性路由 (Session Affinity)",
        hint: "针对同一会话固定路由到同一账号/凭据，最大化 Prompt Cache 命中率",
        type: "bool",
      },
      {
        endpoint: "routing/session-affinity-subagents",
        label: "子代理会话继承",
        hint: "子会话继承父会话绑定的凭据，优化 Prompt Cache",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "routing/session-affinity-ttl",
        label: "会话粘性保留时长",
        hint: "例如 1h、30m",
        type: "text",
        fallback: "1h",
      },
      {
        endpoint: "request-retry",
        label: "每轮请求重试次数",
        hint: "请求失败后向上游重试的最大次数，默认 3",
        type: "int",
        fallback: "3",
      },
      { endpoint: "max-retry-credentials", label: "每轮最大重试凭据数", hint: "0 表示尝试所有可用凭据", type: "int" },
      { endpoint: "max-retry-interval", label: "最大重试等待（秒）", type: "int" },
      {
        endpoint: "passthrough-headers",
        label: "透传客户端请求头",
        hint: "将客户端请求中携带的自定义 Header 原样透传给上游",
        type: "bool",
      },
      {
        endpoint: "disable-image-generation",
        label: "生图行为控制",
        hint: "控制模型图片生成行为",
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
        endpoint: "gpt-image-2-base-model",
        label: "生图转基础模型",
        hint: "例如 gpt-5.4-mini，该模型用于解析与理解生图指令",
        type: "text",
      },
      { endpoint: "disable-cooling", label: "全局禁用冷却", hint: "禁用凭据或模型失败后的拉黑冷却机制", type: "bool" },
      {
        endpoint: "save-cooldown-status",
        label: "持久化冷却状态",
        hint: "将凭据冷却状态以 .cds 文件保存在认证目录",
        type: "bool",
      },
      {
        endpoint: "transient-error-cooldown-seconds",
        label: "瞬态错误冷却（秒）",
        hint: "408/500/502/503/504 等临时网络错误的冷却秒数，0 为默认（60秒），-1 为禁用",
        type: "int",
      },
      {
        endpoint: "auth-auto-refresh-workers",
        label: "认证自动刷新线程数",
        hint: "后台自动刷新 OAuth Token 的并发线程数，默认 16",
        type: "int",
      },
      {
        endpoint: "codex/identity-confuse",
        label: "Codex 身份混淆映射",
        hint: "使用 fill-first 或会话粘性时，按选定凭据重映射 Codex 缓存和安装标识",
        type: "bool",
      },
      { endpoint: "debug", label: "调试模式", hint: "输出更详细的调试日志", type: "bool" },
      {
        endpoint: "commercial-mode",
        label: "高并发模式（Commercial Mode）",
        hint: "关闭高开销日志以最小化内存占用，适合高并发生产环境",
        type: "bool",
      },
      {
        endpoint: "disable-claude-cloak-mode",
        label: "禁用 Claude 伪装",
        hint: "不伪装 Claude Code 客户端指纹和系统提示词，原样透传",
        type: "bool",
      },
      {
        endpoint: "video-result-auth-cache-ttl",
        label: "视频凭据绑定缓存时效",
        hint: "视频 ID 与创建凭据的绑定时长，默认 3h",
        type: "text",
        fallback: "3h",
      },
    ],
  },
  {
    id: "quota",
    title: "配额回退",
    items: [
      {
        endpoint: "quota-exceeded/switch-project",
        label: "超额时自动切换项目",
        hint: "配额耗尽时自动切换凭据对应的 GCP / 服务项目",
        type: "bool",
      },
      {
        endpoint: "quota-exceeded/switch-preview-model",
        label: "超额时自动切换预览模型",
        hint: "配额耗尽时自动降级切换至轻量/预览模型",
        type: "bool",
      },
      {
        endpoint: "quota-exceeded/antigravity-credits",
        label: "Antigravity 超额使用 Credits",
        hint: "当所有免费账号额度耗尽时，允许使用付费积分兜底",
        type: "bool",
      },
    ],
  },
  {
    id: "streaming",
    title: "流式保活",
    items: [
      {
        endpoint: "streaming/keepalive-seconds",
        label: "流式心跳保持（秒）",
        hint: "SSE 流式响应保活心跳发送间隔，0 表示禁用心跳",
        type: "int",
      },
      {
        endpoint: "streaming/bootstrap-retries",
        label: "流式启动重试次数",
        hint: "流式连接建立阶段发生网络或协议错误时的重试次数",
        type: "int",
      },
      {
        endpoint: "nonstream-keepalive-interval",
        label: "非流式保活间隔",
        hint: "非流式长请求心跳保活间隔，例如 10s、30s",
        type: "text",
      },
    ],
  },
  {
    id: "logging",
    title: "日志与性能",
    items: [
      {
        endpoint: "logging-to-file",
        label: "日志写入文件",
        hint: "将应用日志输出到日志目录中的文件",
        type: "bool",
      },
      {
        endpoint: "request-log",
        label: "请求详细日志",
        hint: "记录完整的 HTTP 请求报文与响应体，排查错误时开启",
        type: "bool",
      },
      {
        endpoint: "usage-statistics-enabled",
        label: "用量统计",
        hint: "开启后 CPA 会将请求推入用量队列供面板采集；若关闭则面板无法统计用量",
        type: "bool",
      },
      {
        endpoint: "redis-usage-queue-retention-seconds",
        label: "用量队列内存保留时间（秒）",
        hint: "用量记录在内存队列中的保留时限，最大 3600 秒",
        type: "int",
      },
      { endpoint: "logs-max-total-size-mb", label: "日志总大小上限（MB）", hint: "0 表示不限制", type: "int" },
      { endpoint: "error-logs-max-files", label: "错误日志保留个数", type: "int" },
      {
        endpoint: "pprof/enable",
        label: "启用 pprof 性能分析",
        hint: "开启内置 Go 运行时性能分析 HTTP 服务",
        type: "bool",
      },
      {
        endpoint: "pprof/addr",
        label: "pprof 监听地址",
        hint: "建议仅绑定本机如 127.0.0.1:8316",
        type: "text",
        fallback: "127.0.0.1:8316",
      },
    ],
  },
  {
    id: "advanced",
    title: "高级与默认头",
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
      {
        endpoint: "antigravity/signature-cache",
        label: "Antigravity 签名缓存",
        hint: "开启后缓存会话签名以提升多并发请求吞吐与凭据稳定性",
        type: "bool",
        fallback: "true",
      },
      {
        endpoint: "antigravity/signature-bypass-strict",
        label: "Antigravity 严格签名绕过",
        hint: "绕过严格签名校验（实验性），用于兼容特定上游调用",
        type: "bool",
      },
      {
        endpoint: "claude-header-defaults/user-agent",
        label: "Claude 默认 User-Agent",
        hint: "客户端未携带时填补的默认 User-Agent",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/package-version",
        label: "Claude 默认 Package Version",
        hint: "如 0.74.0",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/runtime-version",
        label: "Claude 默认 Runtime Version",
        hint: "如 v24.3.0",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/os",
        label: "Claude 默认操作系统基准",
        hint: "如 MacOS，配合设备配置稳定化生效",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/arch",
        label: "Claude 默认架构基准",
        hint: "如 arm64",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/timeout",
        label: "Claude 默认超时（秒）",
        type: "text",
      },
      {
        endpoint: "claude-header-defaults/stabilize-device-profile",
        label: "Claude 设备配置指纹稳定化",
        hint: "为每个凭据固定 OS/架构为配置的基准值以降低风控",
        type: "bool",
      },
      {
        endpoint: "codex-header-defaults/user-agent",
        label: "Codex 默认 User-Agent",
        type: "text",
      },
      {
        endpoint: "codex-header-defaults/beta-features",
        label: "Codex 默认 Beta Features",
        hint: "如 multi_agent，仅适用于 WebSocket 请求",
        type: "text",
      },
    ],
  },
];

// /config 返回的 JSON 键与 endpoint 路径一一对应,例如 routing/strategy -> routing.strategy
function read(config: Json | undefined, endpoint: string): unknown {
  return endpoint.split("/").reduce<unknown>((node, key) => (node as Json | undefined)?.[key], config);
}

function SettingRow({ setting, value }: { setting: Setting; value: unknown }) {
  const queryClient = useQueryClient();
  const initial = value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);

  const save = useMutation({
    mutationFn: (next: unknown) =>
      setting.endpoint === "proxy-url" && next === ""
        ? api("/v0/management/proxy-url", { method: "DELETE" })
        : api(`/v0/management/${setting.endpoint}`, { method: "PUT", body: { value: next } }),
    onSuccess: () => {
      toast.success(`已更新${setting.label}`);
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
    },
  });

  const id = `setting-${setting.endpoint.replace("/", "-")}`;
  let control: React.ReactNode;
  if (setting.type === "bool") {
    control = (
      <Switch id={id} checked={value === true} disabled={save.isPending} onCheckedChange={(v) => save.mutate(v)} />
    );
  } else if (setting.type === "select") {
    control = (
      <Select items={setting.options} value={initial || null} onValueChange={(v) => v && save.mutate(v)}>
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
  } else {
    const isInt = setting.type === "int";
    const invalid = isInt && draft !== "" && !/^\d+$/.test(draft);
    control = (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate(isInt ? Number(draft || 0) : draft.trim());
        }}
      >
        <Input
          id={id}
          value={draft}
          inputMode={isInt ? "numeric" : undefined}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={invalid || undefined}
          className={isInt ? "w-28" : "w-full sm:w-80"}
        />
        {draft !== initial && (
          <Button type="submit" size="default" disabled={invalid || save.isPending}>
            保存
          </Button>
        )}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {setting.label}
        </label>
        {setting.hint && <p className="mt-0.5 text-sm text-muted-foreground">{setting.hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function SettingsGroup({ groupId }: { groupId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "config"],
    queryFn: () => api<Json>("/v0/management/config"),
  });
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取配置失败：{error.message}
      </p>
    );
  }
  if (isPending) return <Skeleton className="h-96" />;
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return null;
  return (
    <div className="max-w-3xl">
      <div className="divide-y">
        {group.items.map((s) => (
          <SettingRow key={s.endpoint} setting={s} value={read(data, s.endpoint) ?? s.fallback} />
        ))}
      </div>
    </div>
  );
}
