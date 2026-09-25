import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode, Layers, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    title: "基础与代理",
    items: [
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
        endpoint: "routing/session-affinity-ttl",
        label: "会话粘性保留时长",
        hint: "例如 1h、30m",
        type: "text",
        fallback: "1h",
      },
      { endpoint: "request-retry", label: "请求重试轮数", hint: "所有凭据都失败后再重试的轮数", type: "int" },
      { endpoint: "max-retry-credentials", label: "每轮最大重试凭据数", hint: "0 表示尝试所有可用凭据", type: "int" },
      { endpoint: "max-retry-interval", label: "最大重试等待（秒）", type: "int" },
      {
        endpoint: "disable-cooling",
        label: "全局禁用冷却",
        hint: "禁用凭据或模型失败后的拉黑冷却机制",
        type: "bool",
      },
      {
        endpoint: "transient-error-cooldown-seconds",
        label: "瞬态错误冷却（秒）",
        hint: "408/500/502/503/504 等临时网络错误的冷却秒数，0 为默认（60秒），-1 为禁用",
        type: "int",
      },
      { endpoint: "quota-exceeded/switch-project", label: "超额时切换项目", type: "bool" },
      { endpoint: "quota-exceeded/switch-preview-model", label: "超额时切换预览模型", type: "bool" },
      {
        endpoint: "quota-exceeded/antigravity-credits",
        label: "Antigravity 超额使用 Credits",
        hint: "当所有免费账号额度耗尽时，允许使用付费积分兜底",
        type: "bool",
      },
    ],
  },
  {
    title: "日志与统计",
    items: [
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
      { endpoint: "logging-to-file", label: "日志写入文件", hint: "日志页查看日志需要开启", type: "bool" },
      { endpoint: "request-log", label: "请求日志", hint: "记录完整的请求和响应体，排查问题时再开启", type: "bool" },
      { endpoint: "logs-max-total-size-mb", label: "日志总大小上限（MB）", hint: "0 表示不限制", type: "int" },
      { endpoint: "error-logs-max-files", label: "错误日志保留个数", type: "int" },
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
        <SelectTrigger id={id} className="w-44">
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

function SettingsForm() {
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
  return (
    <div className="max-w-3xl">
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title} className="mb-8">
          <h2 className="font-medium">{group.title}</h2>
          <div className="divide-y">
            {group.items.map((s) => (
              <SettingRow key={s.endpoint} setting={s} value={read(data, s.endpoint) ?? s.fallback} />
            ))}
          </div>
        </section>
      ))}
      <section aria-labelledby="api-keys-entry" className="mt-8 rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="api-keys-entry" className="font-medium">
              客户端 API Key
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              客户端调用 CPA 的 /v1 接口密钥已移至侧边栏独立页面管理。
            </p>
          </div>
          <Button variant="outline" size="sm" render={<Link to="/api-keys" />}>
            前往管理 API Key
          </Button>
        </div>
      </section>
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
  "default-raw"?: PayloadRuleItem[];
  override?: PayloadRuleItem[];
  "override-raw"?: PayloadRuleItem[];
  filter?: PayloadRuleItem[];
};

function RuleCard({
  title,
  description,
  badge,
  rules,
}: {
  title: string;
  description: string;
  badge: string;
  rules: PayloadRuleItem[] | undefined;
}) {
  if (!rules?.length) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Badge variant="outline">{badge}</Badge>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.map((rule) => {
          const ruleKey = `${rule.models?.map((m) => `${m.name}:${m.protocol ?? ""}`).join("|") || "all"}-${JSON.stringify(rule.params)}`;
          return (
            <div key={ruleKey} className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2">
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
                  <span className="text-muted-foreground">全部匹配</span>
                )}
              </div>

              {rule.params && (
                <div>
                  <span className="text-muted-foreground font-medium">参数规则:</span>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs text-foreground">
                    {typeof rule.params === "object" ? JSON.stringify(rule.params, null, 2) : String(rule.params)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PayloadRules({ onGoYaml }: { onGoYaml: () => void }) {
  const { data, isPending } = useQuery({
    queryKey: ["cpa", "config"],
    queryFn: () => api<Json>("/v0/management/config"),
  });

  const payload = (data?.payload as PayloadConfig | undefined) ?? {};
  const hasRules = Boolean(
    payload.default?.length ||
      payload["default-raw"]?.length ||
      payload.override?.length ||
      payload["override-raw"]?.length ||
      payload.filter?.length,
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">请求 Payload 规则可视化</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            控制 CPA 在向上游转发请求时自动缺省注入（Default）、强行覆盖（Override）或移除指定参数（Filter）。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onGoYaml}>
          <FileCode />
          在源文件中编辑 Payload
        </Button>
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : !hasRules ? (
        <Card className="border-dashed p-8 text-center">
          <Layers className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium">尚未配置 Payload 规则</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            通过配置 Payload 规则，可以给指定模型默认开启思考预算（thinkingBudget）、设定温度、或者移除客户端私有字段。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onGoYaml}>
              前往源文件添加规则
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <RuleCard
            title="缺省参数规则 (Default)"
            description="当客户端请求中缺失该参数时自动注入。"
            badge="Default"
            rules={payload.default}
          />
          <RuleCard
            title="原始 JSON 缺省规则 (Default Raw)"
            description="以原始 JSON 格式缺省注入复杂参数。"
            badge="Default Raw"
            rules={payload["default-raw"]}
          />
          <RuleCard
            title="强行覆盖规则 (Override)"
            description="始终覆盖客户端传参，强行指定对应参数值。"
            badge="Override"
            rules={payload.override}
          />
          <RuleCard
            title="原始 JSON 覆盖规则 (Override Raw)"
            description="以原始 JSON 强行覆盖客户端复杂参数。"
            badge="Override Raw"
            rules={payload["override-raw"]}
          />
          <RuleCard
            title="参数过滤移除 (Filter)"
            description="将客户端请求中的指定 JSON 路径字段剔除。"
            badge="Filter"
            rules={payload.filter}
          />
        </div>
      )}
    </div>
  );
}

export function ConfigPage() {
  const [tab, setTab] = useState("settings");
  return (
    <>
      <PageHeader title="配置" description="修改会写回 CPA 的 config.yaml 并立即生效。" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="settings">常用设置</TabsTrigger>
          <TabsTrigger value="payload">Payload 规则</TabsTrigger>
          <TabsTrigger value="yaml">源文件</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <SettingsForm />
        </TabsContent>
        <TabsContent value="payload">
          <PayloadRules onGoYaml={() => setTab("yaml")} />
        </TabsContent>
        <TabsContent value="yaml">
          <YamlEditor />
        </TabsContent>
      </Tabs>
    </>
  );
}
