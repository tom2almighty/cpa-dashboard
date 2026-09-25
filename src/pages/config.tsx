import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
    title: "基础",
    items: [
      {
        endpoint: "proxy-url",
        label: "全局代理",
        hint: "上游请求走的代理，例如 socks5://127.0.0.1:1080，留空表示直连",
        type: "text",
      },
      { endpoint: "debug", label: "调试模式", hint: "输出更详细的日志", type: "bool" },
      {
        endpoint: "force-model-prefix",
        label: "强制模型前缀",
        hint: "只允许用带前缀的模型名访问配置了前缀的凭据",
        type: "bool",
      },
      { endpoint: "ws-auth", label: "WebSocket 鉴权", hint: "/ws 路由要求携带 API Key", type: "bool" },
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
          { value: "round-robin", label: "轮询" },
          { value: "fill-first", label: "优先用满一个" },
        ],
        fallback: "round-robin",
      },
      { endpoint: "request-retry", label: "请求重试轮数", hint: "所有凭据都失败后再重试的轮数", type: "int" },
      { endpoint: "max-retry-interval", label: "最大重试等待（秒）", type: "int" },
      { endpoint: "quota-exceeded/switch-project", label: "超额时切换项目", type: "bool" },
      { endpoint: "quota-exceeded/switch-preview-model", label: "超额时切换预览模型", type: "bool" },
    ],
  },
  {
    title: "日志与统计",
    items: [
      { endpoint: "usage-statistics-enabled", label: "用量统计", hint: "关闭后本面板不会再记录新的请求", type: "bool" },
      { endpoint: "logging-to-file", label: "日志写入文件", hint: "日志页需要开启", type: "bool" },
      { endpoint: "request-log", label: "请求日志", hint: "记录完整的请求和响应，排查问题时再开", type: "bool" },
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

export function ConfigPage() {
  return (
    <>
      <PageHeader title="配置" description="修改会写回 CPA 的 config.yaml 并立即生效。" />
      <Tabs defaultValue="settings">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="settings">常用设置</TabsTrigger>
          <TabsTrigger value="yaml">源文件</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <SettingsForm />
        </TabsContent>
        <TabsContent value="yaml">
          <YamlEditor />
        </TabsContent>
      </Tabs>
    </>
  );
}
