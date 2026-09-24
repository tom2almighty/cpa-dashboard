import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

// OAuth 渠道名,与认证文件的 provider 一致
const CHANNELS = ["codex", "claude", "gemini-cli", "antigravity", "vertex", "aistudio", "kimi", "xai", "qwen", "iflow"];

type Alias = { name: string; alias: string; fork?: boolean; "display-name"?: string; "force-mapping"?: boolean };
type AliasMap = Record<string, Alias[]>;
type CatalogModel = { id: string; display_name?: string; owned_by?: string; context_length?: number };

function useCatalog(channel: string) {
  return useQuery({
    queryKey: ["cpa", "model-definitions", channel],
    queryFn: () => api<{ models?: CatalogModel[] }>(`/v0/management/model-definitions/${encodeURIComponent(channel)}`),
    select: (res) => res.models ?? [],
    enabled: Boolean(channel),
    retry: false,
    staleTime: 10 * 60_000,
  });
}

function ChannelInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <>
      <Input
        id={id}
        list={`${id}-options`}
        value={value}
        onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
        placeholder="例如 codex"
      />
      <datalist id={`${id}-options`}>
        {CHANNELS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

// ---------- 模型别名 ----------

type Row = Alias & { key: number };

function AliasDialog({
  channel: initial,
  aliases,
  onClose,
}: {
  channel: string;
  aliases: Alias[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [channel, setChannel] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() =>
    (aliases.length ? aliases : [{ name: "", alias: "" }]).map((a, i) => ({ ...a, key: i })),
  );
  const catalog = useCatalog(channel);
  const update = (key: number, patch: Partial<Alias>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => {
      const clean = rows
        .filter((r) => r.name.trim() && r.alias.trim())
        .map(({ key: _, ...r }) => {
          const out: Alias = { ...r, name: r.name.trim(), alias: r.alias.trim() };
          if (!out["display-name"]?.trim()) delete out["display-name"];
          if (!out.fork) delete out.fork;
          if (!out["force-mapping"]) delete out["force-mapping"];
          return out;
        });
      // 空数组会删除该渠道
      return api("/v0/management/oauth-model-alias", { method: "PATCH", body: { channel, aliases: clean } });
    },
    onSuccess: () => {
      toast.success("模型别名已保存");
      queryClient.invalidateQueries({ queryKey: ["cpa", "oauth-model-alias"] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (channel) save.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? `编辑 ${initial} 的模型别名` : "添加模型别名"}</DialogTitle>
        </DialogHeader>
        <form id={`${uid}-form`} onSubmit={submit} className="grid gap-4">
          {!initial && (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor={`${uid}-channel`}>渠道</Label>
              <ChannelInput id={`${uid}-channel`} value={channel} onChange={setChannel} />
            </div>
          )}
          <datalist id={`${uid}-models`}>
            {(catalog.data ?? []).map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
          <div className="grid gap-2">
            <div className="hidden grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-2 px-1 text-xs text-muted-foreground sm:grid">
              <span>上游模型</span>
              <span>别名</span>
              <span>显示名称</span>
              <span title="保留原模型名，同时新增别名">保留原名</span>
              <span title="响应里的模型名改写回别名">改写响应</span>
              <span className="w-8" />
            </div>
            {rows.map((r) => (
              <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto] sm:items-center">
                <Input
                  aria-label="上游模型"
                  list={`${uid}-models`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className="font-mono"
                />
                <Input
                  aria-label="别名"
                  value={r.alias}
                  onChange={(e) => update(r.key, { alias: e.target.value })}
                  className="font-mono"
                />
                <Input
                  aria-label="显示名称"
                  value={r["display-name"] ?? ""}
                  onChange={(e) => update(r.key, { "display-name": e.target.value })}
                />
                <Switch
                  aria-label="保留原名"
                  className="justify-self-center"
                  checked={r.fork === true}
                  onCheckedChange={(v) => update(r.key, { fork: v })}
                />
                <Switch
                  aria-label="改写响应"
                  className="justify-self-center"
                  checked={r["force-mapping"] === true}
                  onCheckedChange={(v) => update(r.key, { "force-mapping": v })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除这一行"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setRows((rs) => [...rs, { name: "", alias: "", key: Date.now() }])}
            >
              <Plus />
              添加一行
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            客户端用别名请求时，CPA 会改用上游模型。开启「保留原名」时两个名字都能用，清空所有行即删除该渠道的别名。
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={`${uid}-form`} disabled={!channel || save.isPending}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Aliases() {
  const [editing, setEditing] = useState<{ channel: string; aliases: Alias[] } | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "oauth-model-alias"],
    queryFn: () => api<{ "oauth-model-alias"?: AliasMap }>("/v0/management/oauth-model-alias"),
    select: (res) => Object.entries(res["oauth-model-alias"] ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取失败：{error.message}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">给 OAuth 账号的模型起别名，按渠道生效。</p>
        <Button onClick={() => setEditing({ channel: "", aliases: [] })}>
          <Plus />
          添加别名
        </Button>
      </div>
      {isPending ? (
        <Skeleton className="h-40" />
      ) : data.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          还没有模型别名
        </p>
      ) : (
        <div className="grid gap-8">
          {data.map(([channel, list]) => (
            <section key={channel} aria-label={channel}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">{channel}</h3>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ channel, aliases: list })}>
                  <Pencil />
                  编辑
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>别名</TableHead>
                    <TableHead>上游模型</TableHead>
                    <TableHead>显示名称</TableHead>
                    <TableHead>选项</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={`${a.name}-${a.alias}`}>
                      <TableCell className="font-mono text-sm">{a.alias}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{a.name}</TableCell>
                      <TableCell>{a["display-name"] || "—"}</TableCell>
                      <TableCell className="space-x-1.5">
                        {a.fork && <Badge variant="outline">保留原名</Badge>}
                        {a["force-mapping"] && <Badge variant="outline">改写响应</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
      {editing && <AliasDialog channel={editing.channel} aliases={editing.aliases} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- 排除模型 ----------

function ExcludedDialog({
  provider: initial,
  models,
  onClose,
}: {
  provider: string;
  models: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [provider, setProvider] = useState(initial);
  const [text, setText] = useState(models.join("\n"));
  const save = useMutation({
    mutationFn: () => {
      const list = text
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return list.length
        ? api("/v0/management/oauth-excluded-models", { method: "PATCH", body: { provider, models: list } })
        : api(`/v0/management/oauth-excluded-models?provider=${encodeURIComponent(provider)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success("排除模型已保存");
      queryClient.invalidateQueries({ queryKey: ["cpa", "oauth-excluded-models"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? `编辑 ${initial} 的排除模型` : "添加排除模型"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {!initial && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-provider`}>渠道</Label>
              <ChannelInput id={`${uid}-provider`} value={provider} onChange={setProvider} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-models`}>排除的模型</Label>
            <Textarea
              id={`${uid}-models`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-40 font-mono text-sm"
              placeholder={"gpt-5-codex-mini\n*-mini"}
            />
            <p className="text-xs text-muted-foreground">
              每行一个，支持 * 通配（如 gpt-5-*、*-mini）。清空后保存即删除该渠道的规则。
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!provider || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Excluded() {
  const [editing, setEditing] = useState<{ provider: string; models: string[] } | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "oauth-excluded-models"],
    queryFn: () => api<{ "oauth-excluded-models"?: Record<string, string[]> }>("/v0/management/oauth-excluded-models"),
    select: (res) => Object.entries(res["oauth-excluded-models"] ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取失败：{error.message}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">按渠道屏蔽 OAuth 账号的模型，客户端将看不到这些模型。</p>
        <Button onClick={() => setEditing({ provider: "", models: [] })}>
          <Plus />
          添加规则
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">渠道</TableHead>
            <TableHead>排除的模型</TableHead>
            <TableHead className="w-16">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>还没有排除规则</EmptyRow>
          ) : (
            data.map(([provider, models]) => (
              <TableRow key={provider}>
                <TableCell className="font-medium">{provider}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {models.map((m) => (
                      <Badge key={m} variant="secondary" className="font-mono">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`编辑 ${provider}`}
                    onClick={() => setEditing({ provider, models })}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {editing && (
        <ExcludedDialog provider={editing.provider} models={editing.models} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

// ---------- 模型目录 ----------

function Catalog() {
  const [channel, setChannel] = useState(CHANNELS[0]);
  const { data, isPending, isError, error } = useCatalog(channel);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">CPA 内置的模型定义，决定各渠道默认对外提供哪些模型。</p>
        <Select
          items={CHANNELS.map((c) => ({ value: c, label: c }))}
          value={channel}
          onValueChange={(v) => v && setChannel(v)}
        >
          <SelectTrigger className="w-44" aria-label="选择渠道">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型</TableHead>
            <TableHead>显示名称</TableHead>
            <TableHead>提供方</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : isError ? (
            <EmptyRow columns={3}>这个渠道没有内置模型定义（{error.message}）</EmptyRow>
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>没有模型</EmptyRow>
          ) : (
            data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-sm">{m.id}</TableCell>
                <TableCell>{m.display_name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{m.owned_by || "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

export function ModelsPage() {
  return (
    <>
      <PageHeader title="模型" description="OAuth 账号的模型别名与屏蔽规则。API Key 提供商的模型在提供商页单独配置。" />
      <Tabs defaultValue="alias">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="alias">别名</TabsTrigger>
          <TabsTrigger value="excluded">排除</TabsTrigger>
          <TabsTrigger value="catalog">内置目录</TabsTrigger>
        </TabsList>
        <TabsContent value="alias">
          <Aliases />
        </TabsContent>
        <TabsContent value="excluded">
          <Excluded />
        </TabsContent>
        <TabsContent value="catalog">
          <Catalog />
        </TabsContent>
      </Tabs>
    </>
  );
}
