import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, Pencil, Plus, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import YAML from "yaml";
import { CodeEditor } from "@/components/code-editor";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VersionCardContent } from "@/components/version-dialog";
import { api } from "@/lib/api";

type Json = Record<string, unknown>;

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

const GROUPS: { title: string; items: Setting[] }[] = [
  {
    title: "基础与服务",
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
        endpoint: "proxy-url",
        label: "全局代理",
        hint: "上游请求走的代理，例如 socks5://127.0.0.1:1080，留空表示直连",
        type: "text",
      },
      { endpoint: "debug", label: "调试模式", hint: "输出更详细的调试日志", type: "bool" },
      {
        endpoint: "force-model-prefix",
        label: "强制模型前缀",
        hint: "只允许用带前缀的模型名访问配置了前缀的凭据",
        type: "bool",
      },
      { endpoint: "ws-auth", label: "WebSocket 鉴权", hint: "/ws 路由要求携带 API Key", type: "bool" },
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
        endpoint: "video-result-auth-cache-ttl",
        label: "视频凭据绑定缓存时效",
        hint: "视频 ID 与创建凭据的绑定时长，默认 3h",
        type: "text",
        fallback: "3h",
      },
    ],
  },
  {
    title: "远程管理",
    items: [
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
    ],
  },
  {
    title: "TLS 与安全传输",
    items: [
      {
        endpoint: "tls/enable",
        label: "启用 HTTPS (TLS)",
        hint: "开启内置 HTTPS 服务",
        type: "bool",
      },
      {
        endpoint: "tls/cert",
        label: "TLS 证书文件路径",
        hint: "服务器 SSL/TLS 证书路径（.crt 或 .pem）",
        type: "text",
      },
      {
        endpoint: "tls/key",
        label: "TLS 私钥文件路径",
        hint: "服务器 SSL/TLS 私钥路径（.key）",
        type: "text",
      },
    ],
  },
  {
    title: "重试与路由",
    items: [
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
        endpoint: "gpt-image-2-base-model",
        label: "生图转基础模型",
        hint: "例如 gpt-5.4-mini，该模型用于解析与理解生图指令",
        type: "text",
      },
      {
        endpoint: "disable-cooling",
        label: "全局禁用冷却",
        hint: "禁用凭据或模型失败后的拉黑冷却机制",
        type: "bool",
      },
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
    ],
  },
  {
    title: "配额回退策略",
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
    title: "流式传输与保活",
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
    title: "高级与默认请求头",
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

function SettingsGroup({ groupIndex }: { groupIndex: number }) {
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
  const group = GROUPS[groupIndex];
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

function YamlEditor() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "config.yaml"],
    queryFn: () => api<string>("/v0/management/config.yaml"),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (data !== undefined) setDraft(data);
  }, [data]);
  const dirty = data !== undefined && draft !== data;

  const save = useMutation({
    mutationFn: () =>
      api("/v0/management/config.yaml", {
        method: "PUT",
        body: draft,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      }),
    onSuccess: () => {
      queryClient.setQueryData(["cpa", "config.yaml"], draft);
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      toast.success("配置已保存，CPA 会自动重新加载");
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取配置失败：{error.message}
      </p>
    );
  }
  if (isPending) return <Skeleton className="h-[65svh]" />;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">保存时 CPA 会先校验格式，Ctrl/⌘ + S 保存。</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(data)}>
            <RotateCcw />
            撤销修改
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Spinner /> : <Save />}
            保存
          </Button>
        </div>
      </div>
      <CodeEditor
        label="config.yaml"
        language="yaml"
        height="65svh"
        value={draft}
        onChange={setDraft}
        onSave={() => dirty && !save.isPending && save.mutate()}
      />
    </>
  );
}

type PayloadRuleItem = {
  models?: { name: string; protocol?: string; headers?: Record<string, string> }[];
  params?: Record<string, unknown> | string[];
};

type PayloadConfig = {
  default?: PayloadRuleItem[];
  override?: PayloadRuleItem[];
  filter?: PayloadRuleItem[];
};

type EditingRule = {
  section: "default" | "override" | "filter";
  index: number | null;
  modelName: string;
  protocol: string;
  paramsText: string;
};

function RuleDialog({
  rule,
  onClose,
  onSave,
  isSaving,
}: {
  rule: EditingRule;
  onClose: () => void;
  onSave: (rule: EditingRule) => void;
  isSaving: boolean;
}) {
  const [section, setSection] = useState<"default" | "override" | "filter">(rule.section);
  const [modelName, setModelName] = useState(rule.modelName);
  const [protocol, setProtocol] = useState(rule.protocol);
  const [paramsText, setParamsText] = useState(rule.paramsText);

  const applyPreset = (preset: {
    section: "default" | "override" | "filter";
    model: string;
    proto: string;
    params: string;
  }) => {
    setSection(preset.section);
    setModelName(preset.model);
    setProtocol(preset.proto);
    setParamsText(preset.params);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      section,
      index: rule.index,
      modelName: modelName.trim() || "*",
      protocol: protocol.trim(),
      paramsText: paramsText.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{rule.index !== null ? "编辑 Payload 规则" : "添加 Payload 规则"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs text-muted-foreground">快捷预设模板</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "default",
                      model: "gemini-*",
                      proto: "gemini",
                      params: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  Gemini 思考预算 32k
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "override",
                      model: "*",
                      proto: "",
                      params: '{\n  "temperature": 0.7\n}',
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  全局温度 0.7
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    applyPreset({
                      section: "filter",
                      model: "gemini-*",
                      proto: "gemini",
                      params: "generationConfig.thinkingConfig.thinkingBudget",
                    })
                  }
                >
                  <Wand2 className="size-3" />
                  过滤思考预算
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rule-section">规则类型</Label>
                <Select
                  items={[
                    { value: "default", label: "缺省注入 (Default - 缺失时补全)" },
                    { value: "override", label: "强制覆盖 (Override - 始终生效)" },
                    { value: "filter", label: "参数过滤 (Filter - 移除字段)" },
                  ]}
                  value={section}
                  onValueChange={(v) => v && setSection(v as "default" | "override" | "filter")}
                >
                  <SelectTrigger id="rule-section" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">缺省注入 (Default)</SelectItem>
                    <SelectItem value="override">强制覆盖 (Override)</SelectItem>
                    <SelectItem value="filter">参数过滤 (Filter)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="rule-protocol">协议限制 (可选)</Label>
                <Select
                  items={[
                    { value: "all", label: "全部协议 (不限制)" },
                    { value: "gemini", label: "Gemini" },
                    { value: "openai", label: "OpenAI" },
                    { value: "claude", label: "Claude" },
                    { value: "codex", label: "Codex" },
                    { value: "antigravity", label: "Antigravity" },
                  ]}
                  value={protocol || "all"}
                  onValueChange={(v) => setProtocol(v && v !== "all" ? v : "")}
                >
                  <SelectTrigger id="rule-protocol" className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部协议 (不限制)</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="antigravity">Antigravity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="rule-model">目标模型名称 / 通配符</Label>
              <Input
                id="rule-model"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="例如 gemini-*、gpt-4o、* (全部模型)"
                className="mt-1 font-mono text-sm"
                required
              />
            </div>

            <div>
              <Label htmlFor="rule-params">
                {section === "filter" ? "待移除的参数路径列表（每行一个）" : "注入/覆盖的参数（JSON 格式）"}
              </Label>
              <Textarea
                id="rule-params"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                placeholder={
                  section === "filter"
                    ? "generationConfig.thinkingConfig.thinkingBudget\ngenerationConfig.responseJsonSchema"
                    : '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}'
                }
                className="mt-1 min-h-32 font-mono text-xs"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {section === "filter"
                  ? "支持 gjson/sjson 路径语法，将指定字段从发往上游的请求中剔除。"
                  : "必须是合法的 JSON 对象，键为 JSON 路径，值为要注入的参数内容。"}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              取消
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Spinner />}
              保存规则
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleCard({
  title,
  description,
  badge,
  section,
  rules,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  description: string;
  badge: string;
  section: "default" | "override" | "filter";
  rules: PayloadRuleItem[] | undefined;
  onAdd: () => void;
  onEdit: (rule: PayloadRuleItem, index: number) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Badge variant="outline">{badge}</Badge>
          </div>
          <Button size="xs" variant="outline" onClick={onAdd}>
            <Plus className="size-3" />
            添加
          </Button>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rules?.length ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            暂未配置此类规则
          </div>
        ) : (
          rules.map((rule, idx) => {
            const ruleKey = `${section}-${idx}-${rule.models?.map((m) => `${m.name}:${m.protocol ?? ""}`).join("|") || "all"}`;
            return (
              <div key={ruleKey} className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground font-medium">目标模型:</span>
                    {rule.models?.length ? (
                      rule.models.map((m) => (
                        <Badge key={`${m.name}-${m.protocol ?? ""}`} variant="secondary" className="font-mono text-xs">
                          {m.name}
                          {m.protocol && <span className="ml-1 opacity-70">({m.protocol})</span>}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">全部匹配 (*)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button size="icon-xs" variant="ghost" aria-label="编辑规则" onClick={() => onEdit(rule, idx)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="删除规则"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(idx)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                {rule.params && (
                  <div>
                    <span className="text-muted-foreground font-medium">参数规则:</span>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-foreground">
                      {Array.isArray(rule.params) ? rule.params.join("\n") : JSON.stringify(rule.params, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function PayloadRules({ onGoYaml }: { onGoYaml: () => void }) {
  const queryClient = useQueryClient();
  const [dialogRule, setDialogRule] = useState<EditingRule | null>(null);

  const { data: configData, isPending } = useQuery({
    queryKey: ["cpa", "config"],
    queryFn: () => api<Json>("/v0/management/config"),
  });

  const saveMutation = useMutation({
    mutationFn: async (rule: EditingRule) => {
      let parsedParams: Record<string, unknown> | string[] = {};
      if (rule.section === "filter") {
        parsedParams = rule.paramsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        try {
          parsedParams = JSON.parse(rule.paramsText);
        } catch {
          throw new Error("参数格式错误：必须是合法的 JSON 对象");
        }
      }

      const currentYaml = await api<string>("/v0/management/config.yaml");
      const doc = YAML.parseDocument(currentYaml || "");
      const existing = doc.get("payload");
      const payloadObj =
        existing && typeof (existing as { toJSON?: () => unknown }).toJSON === "function"
          ? ((existing as { toJSON: () => unknown }).toJSON() as Record<string, unknown[]>)
          : {};

      if (!Array.isArray(payloadObj[rule.section])) {
        payloadObj[rule.section] = [];
      }

      const ruleItem: PayloadRuleItem = {
        models: [{ name: rule.modelName, ...(rule.protocol ? { protocol: rule.protocol } : {}) }],
        params: parsedParams,
      };

      if (rule.index !== null && rule.index < payloadObj[rule.section].length) {
        payloadObj[rule.section][rule.index] = ruleItem;
      } else {
        payloadObj[rule.section].push(ruleItem);
      }

      doc.set("payload", payloadObj);
      const newYaml = doc.toString();

      await api("/v0/management/config.yaml", {
        method: "PUT",
        body: newYaml,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      });
    },
    onSuccess: () => {
      toast.success("Payload 规则已更新并自动生效");
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
      setDialogRule(null);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const deleteRule = async (section: "default" | "override" | "filter", index: number) => {
    try {
      const currentYaml = await api<string>("/v0/management/config.yaml");
      const doc = YAML.parseDocument(currentYaml || "");
      const existing = doc.get("payload");
      const payloadObj =
        existing && typeof (existing as { toJSON?: () => unknown }).toJSON === "function"
          ? ((existing as { toJSON: () => unknown }).toJSON() as Record<string, unknown[]>)
          : {};

      if (Array.isArray(payloadObj[section])) {
        payloadObj[section].splice(index, 1);
        if (payloadObj[section].length === 0) {
          delete payloadObj[section];
        }
      }

      if (Object.keys(payloadObj).length === 0) {
        doc.delete("payload");
      } else {
        doc.set("payload", payloadObj);
      }

      const newYaml = doc.toString();
      await api("/v0/management/config.yaml", {
        method: "PUT",
        body: newYaml,
        raw: true,
        headers: { "Content-Type": "application/yaml" },
      });

      toast.success("规则已删除");
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "config.yaml"] });
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  };

  const payload = (configData?.payload as PayloadConfig | undefined) ?? {};

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">请求 Payload 参数规则可视化</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            可视化配置 CPA 向各上游转发请求时自动缺省注入（Default）、强行覆盖（Override）或移除指定参数（Filter）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() =>
              setDialogRule({
                section: "default",
                index: null,
                modelName: "gemini-*",
                protocol: "gemini",
                paramsText: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
              })
            }
          >
            <Plus className="size-4" />
            添加规则
          </Button>
          <Button variant="outline" size="sm" onClick={onGoYaml}>
            <FileCode className="size-4" />
            查看完整源文件
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <RuleCard
            title="缺省参数规则 (Default)"
            description="仅在客户端未传该参数时自动注入默认值。"
            badge="Default"
            section="default"
            rules={payload.default}
            onAdd={() =>
              setDialogRule({
                section: "default",
                index: null,
                modelName: "gemini-*",
                protocol: "gemini",
                paramsText: '{\n  "generationConfig.thinkingConfig.thinkingBudget": 32768\n}',
              })
            }
            onEdit={(rule, index) =>
              setDialogRule({
                section: "default",
                index,
                modelName: rule.models?.[0]?.name ?? "*",
                protocol: rule.models?.[0]?.protocol ?? "",
                paramsText: JSON.stringify(rule.params ?? {}, null, 2),
              })
            }
            onDelete={(index) => deleteRule("default", index)}
          />

          <RuleCard
            title="强制覆盖规则 (Override)"
            description="始终覆盖客户端传参，强制指定对应参数值。"
            badge="Override"
            section="override"
            rules={payload.override}
            onAdd={() =>
              setDialogRule({
                section: "override",
                index: null,
                modelName: "*",
                protocol: "",
                paramsText: '{\n  "temperature": 0.7\n}',
              })
            }
            onEdit={(rule, index) =>
              setDialogRule({
                section: "override",
                index,
                modelName: rule.models?.[0]?.name ?? "*",
                protocol: rule.models?.[0]?.protocol ?? "",
                paramsText: JSON.stringify(rule.params ?? {}, null, 2),
              })
            }
            onDelete={(index) => deleteRule("override", index)}
          />

          <div className="md:col-span-2">
            <RuleCard
              title="参数过滤移除 (Filter)"
              description="将客户端请求中的指定 JSON 路径字段剔除后转发。"
              badge="Filter"
              section="filter"
              rules={payload.filter}
              onAdd={() =>
                setDialogRule({
                  section: "filter",
                  index: null,
                  modelName: "gemini-*",
                  protocol: "gemini",
                  paramsText: "generationConfig.thinkingConfig.thinkingBudget",
                })
              }
              onEdit={(rule, index) =>
                setDialogRule({
                  section: "filter",
                  index,
                  modelName: rule.models?.[0]?.name ?? "*",
                  protocol: rule.models?.[0]?.protocol ?? "",
                  paramsText: Array.isArray(rule.params) ? rule.params.join("\n") : "",
                })
              }
              onDelete={(index) => deleteRule("filter", index)}
            />
          </div>
        </div>
      )}

      {dialogRule && (
        <RuleDialog
          rule={dialogRule}
          onClose={() => setDialogRule(null)}
          onSave={(updated) => saveMutation.mutate(updated)}
          isSaving={saveMutation.isPending}
        />
      )}
    </div>
  );
}

export function ConfigPage() {
  const [tab, setTab] = useState("basic");
  return (
    <>
      <PageHeader title="配置" description="修改会写回 CPA 的 config.yaml 并立即生效。" />
      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <TabsList variant="line" className="mb-6 flex-wrap">
          <TabsTrigger value="basic">基础与代理</TabsTrigger>
          <TabsTrigger value="routing">重试与路由</TabsTrigger>
          <TabsTrigger value="logging">日志与统计</TabsTrigger>
          <TabsTrigger value="payload">Payload 规则</TabsTrigger>
          <TabsTrigger value="yaml">源文件</TabsTrigger>
          <TabsTrigger value="about">关于与更新</TabsTrigger>
        </TabsList>
        <TabsContent value="basic">
          <SettingsGroup groupIndex={0} />
        </TabsContent>
        <TabsContent value="routing">
          <SettingsGroup groupIndex={1} />
        </TabsContent>
        <TabsContent value="logging">
          <SettingsGroup groupIndex={2} />
        </TabsContent>
        <TabsContent value="payload">
          <PayloadRules onGoYaml={() => setTab("yaml")} />
        </TabsContent>
        <TabsContent value="yaml">
          <YamlEditor />
        </TabsContent>
        <TabsContent value="about">
          <div className="max-w-3xl">
            <VersionCardContent />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
