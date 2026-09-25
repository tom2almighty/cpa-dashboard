import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { RequestSparkline } from "@/components/sparkline";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  type Form,
  fetchProviderModels,
  formatModelRows,
  fromForm,
  identity,
  type Json,
  KINDS,
  type Kind,
  lines,
  list,
  mask,
  parseModelRows,
  str,
  toForm,
  validate,
} from "@/lib/provider-form";
import type { RecentBucket } from "@/lib/types";

type KeyUsage = { success: number; failed: number; recent_requests?: RecentBucket[] };

// /api-key-usage 按 provider -> "base-url|api-key" 分组,这里摊平成一张表
function useKeyUsage() {
  return useQuery({
    queryKey: ["cpa", "api-key-usage"],
    queryFn: () => api<Record<string, Record<string, KeyUsage>>>("/v0/management/api-key-usage"),
    select: (res) => new Map(Object.values(res ?? {}).flatMap((group) => Object.entries(group ?? {}))),
    refetchInterval: 60_000,
    retry: false,
  });
}

// 一个条目可能有多个 Key(OpenAI 兼容),把它们的桶按位置相加
function usageOf(kind: Kind, item: Json, usage: Map<string, KeyUsage> | undefined): RecentBucket[] {
  if (!usage) return [];
  const base = str(item["base-url"]);
  const keys = kind.openai ? list(item["api-key-entries"]).map((e) => str(e["api-key"])) : [str(item["api-key"])];
  const found = keys.map((k) => usage.get(`${base}|${k}`)).filter((u): u is KeyUsage => Boolean(u));
  const buckets: RecentBucket[] = [];
  for (const u of found) {
    (u.recent_requests ?? []).forEach((b, i) => {
      const acc = buckets[i] ?? { time: b.time, success: 0, failed: 0 };
      buckets[i] = { time: acc.time, success: acc.success + b.success, failed: acc.failed + b.failed };
    });
  }
  return buckets;
}

// 先取最新列表再整表写回,避免覆盖别处的改动
async function mutateList(kind: Kind, change: (items: Json[]) => Json[]) {
  const res = await api<Json>(`/v0/management/${kind.endpoint}`);
  const items = list(res[kind.endpoint]).map(({ "auth-index": _, ...rest }) => rest);
  await api(`/v0/management/${kind.endpoint}`, { method: "PUT", body: change(items) });
}

function findIndex(kind: Kind, items: Json[], target: Json): number {
  const i = items.findIndex((x) => identity(kind, x) === identity(kind, target));
  if (i < 0) throw new Error("该条目已被修改或删除，请刷新后重试");
  return i;
}

type EditorRow = { id: string; name: string; alias: string };

const newRow = (name: string, alias = ""): EditorRow => ({ id: Math.random().toString(36).slice(2), name, alias });

function ModelMappingEditor({
  kind,
  form,
  update,
}: {
  kind: Kind;
  form: Form;
  update: (patch: Partial<Form>) => void;
}) {
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<EditorRow[]>(() => parseModelRows(form.models).map((r) => newRow(r.name, r.alias)));

  const syncToForm = (nextRows: EditorRow[]) => {
    setRows(nextRows);
    update({ models: formatModelRows(nextRows) });
  };

  const handleFetch = async () => {
    setIsFetching(true);
    try {
      const key = kind.openai ? lines(form.keys)[0] || "" : form.apiKey.trim();
      if ((kind.openai || kind.baseUrlRequired) && !form.baseUrl.trim()) {
        toast.error("请先填写 Base URL");
        return;
      }
      const list = await fetchProviderModels(kind, form.baseUrl, key, form.headers);
      if (list.length === 0) {
        toast.info("未获取到可用模型，请确认地址与密钥，或直接输入模型名");
      } else {
        setFetchedModels(list);
        toast.success(`成功获取 ${list.length} 个模型`);
      }
    } catch (err) {
      toast.error((err as Error).message || "获取模型失败");
    } finally {
      setIsFetching(false);
    }
  };

  // 已添加的模型在下拉里打勾;输入的名字不在列表里时追加为一项,选中即作为自定义模型添加
  const selected = [...new Set(rows.map((r) => r.name))];
  const known = [...new Set([...fetchedModels, ...selected])];
  const typed = query.trim();
  const creatable = typed && !known.includes(typed) ? typed : "";
  const items = creatable ? [...known, creatable] : known;

  const select = (names: string[]) => {
    const kept = rows.filter((r) => names.includes(r.name));
    syncToForm([...kept, ...names.filter((n) => !kept.some((r) => r.name === n)).map((n) => newRow(n))]);
  };

  const handleAddAll = () => {
    const toAdd = fetchedModels.filter((m) => !selected.includes(m));
    select([...selected, ...toAdd]);
    toast.success(`已添加 ${toAdd.length} 个模型`);
  };

  const setAlias = (id: string, alias: string) => {
    syncToForm(rows.map((r) => (r.id === id ? { ...r, alias } : r)));
  };

  const removeRow = (id: string) => {
    syncToForm(rows.filter((r) => r.id !== id));
  };

  const handleToggleMode = () => {
    if (textMode) setRows(parseModelRows(form.models).map((r) => newRow(r.name, r.alias)));
    setTextMode(!textMode);
  };

  const p = kind.endpoint;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label htmlFor={`${p}-models`}>模型与映射</Label>
          <p className="text-xs text-muted-foreground">不添加则使用全部默认模型，客户端按别名请求时转发到上游模型</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleFetch}
            disabled={isFetching}
            className="h-7 text-xs"
          >
            {isFetching ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
            {fetchedModels.length > 0 ? `重新获取 (${fetchedModels.length})` : "获取模型"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleMode}
            className="h-7 text-xs text-muted-foreground"
          >
            {textMode ? "列表编辑" : "文本编辑"}
          </Button>
        </div>
      </div>

      {textMode ? (
        <>
          <Textarea
            id={`${p}-models`}
            value={form.models}
            onChange={(e) => update({ models: e.target.value })}
            className="min-h-24 font-mono text-sm"
            placeholder={"gpt-4o => 4o\ngpt-4o-mini"}
          />
          <p className="text-xs text-muted-foreground">每行一个，起别名写成 上游模型 =&gt; 别名</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Combobox
              multiple
              autoHighlight
              items={items}
              // 默认过滤不去空格,粘贴的模型名常带尾随空格
              filter={(m: string, q) => m.toLowerCase().includes(q.trim().toLowerCase())}
              value={selected}
              onValueChange={select}
              inputValue={query}
              onInputValueChange={setQuery}
              onOpenChange={(open, details) => {
                // 勾选后不收起,方便连续选多个
                if (!open && details.reason === "item-press") details.cancel();
              }}
            >
              <ComboboxInput
                id={`${p}-models`}
                placeholder={
                  fetchedModels.length > 0 ? `搜索 ${fetchedModels.length} 个模型，或输入模型名` : "输入模型名添加"
                }
                className="flex-1"
                onKeyDown={(e) => {
                  // 没有高亮项时回车会提交外层表单
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                }}
              />
              <ComboboxContent>
                <ComboboxEmpty>点击「获取模型」拉取上游模型，或直接输入模型名</ComboboxEmpty>
                <ComboboxList>
                  {(m: string) => (
                    <ComboboxItem key={m} value={m} className="font-mono text-xs">
                      {m === creatable ? (
                        <>
                          <Plus className="size-3.5" />
                          添加「{m}」
                        </>
                      ) : (
                        m
                      )}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {fetchedModels.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={handleAddAll}
                disabled={fetchedModels.every((m) => selected.includes(m))}
                className="shrink-0"
              >
                全部添加
              </Button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span>上游模型</span>
                <span>映射别名</span>
                <span className="w-6" />
              </div>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <span className="truncate px-1 font-mono text-xs" title={r.name}>
                      {r.name}
                    </span>
                    <Input
                      aria-label={`${r.name} 的映射别名`}
                      value={r.alias}
                      placeholder="留空保持原名"
                      onChange={(e) => setAlias(r.id, e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeRow(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`移除 ${r.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditDialog({
  kind,
  target,
  onClose,
}: {
  kind: Kind;
  // null 表示新增
  target: Json | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(target ?? {}));
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      mutateList(kind, (items) => {
        if (!target) return [...items, fromForm(kind, form, {})];
        const i = findIndex(kind, items, target);
        items[i] = fromForm(kind, form, items[i]);
        return items;
      }),
    onSuccess: () => {
      toast.success(target ? "已保存" : "已添加");
      queryClient.invalidateQueries({ queryKey: ["cpa", "providers"] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = validate(kind, form);
    setError(message);
    if (!message) save.mutate();
  }

  const p = kind.endpoint;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {target ? "编辑" : "添加"} {kind.label}
          </DialogTitle>
        </DialogHeader>
        <form id={`form-${p}`} onSubmit={submit} className="grid gap-4">
          {kind.openai ? (
            <>
              <Field id={`${p}-name`} label="名称" hint="用于区分提供商，也会作为模型前缀">
                <Input id={`${p}-name`} value={form.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field id={`${p}-keys`} label="API Key" hint="每行一个，请求时轮流使用">
                <Textarea
                  id={`${p}-keys`}
                  value={form.keys}
                  onChange={(e) => update({ keys: e.target.value })}
                  className="min-h-20 font-mono text-sm"
                />
              </Field>
            </>
          ) : (
            <Field id={`${p}-key`} label="API Key">
              <Input
                id={`${p}-key`}
                value={form.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                className="font-mono"
              />
            </Field>
          )}
          <Field
            id={`${p}-base`}
            label="Base URL"
            hint={kind.openai || kind.baseUrlRequired ? undefined : "留空使用官方地址"}
          >
            <Input id={`${p}-base`} value={form.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} />
          </Field>
          <Field id={`${p}-proxy`} label="代理" hint="留空使用全局代理">
            <Input
              id={`${p}-proxy`}
              value={form.proxyUrl}
              onChange={(e) => update({ proxyUrl: e.target.value })}
              placeholder="socks5://127.0.0.1:1080"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${p}-prefix`} label="模型前缀" hint="设置后用 前缀/模型名 访问">
              <Input id={`${p}-prefix`} value={form.prefix} onChange={(e) => update({ prefix: e.target.value })} />
            </Field>
            <Field id={`${p}-priority`} label="优先级" hint="数值越大越优先">
              <Input
                id={`${p}-priority`}
                inputMode="numeric"
                value={form.priority}
                onChange={(e) => update({ priority: e.target.value })}
              />
            </Field>
          </div>
          {kind.websockets && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`${p}-ws`}>使用 WebSocket</Label>
                <p className="text-xs text-muted-foreground">上游支持时通过 WebSocket 发起请求</p>
              </div>
              <Switch id={`${p}-ws`} checked={form.websockets} onCheckedChange={(v) => update({ websockets: v })} />
            </div>
          )}
          <ModelMappingEditor kind={kind} form={form} update={update} />
          <Field id={`${p}-excluded`} label="排除的模型" hint="每行或逗号分隔一个，支持 * 通配">
            <Textarea
              id={`${p}-excluded`}
              value={form.excluded}
              onChange={(e) => update({ excluded: e.target.value })}
              className="min-h-16 font-mono text-sm"
            />
          </Field>
          <Field id={`${p}-headers`} label="额外请求头" hint="每行一个，格式为 名称: 值">
            <Textarea
              id={`${p}-headers`}
              value={form.headers}
              onChange={(e) => update({ headers: e.target.value })}
              className="min-h-16 font-mono text-sm"
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={`form-${p}`} disabled={save.isPending}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTable({ kind, items, isPending }: { kind: Kind; items: Json[]; isPending: boolean }) {
  const queryClient = useQueryClient();
  const usage = useKeyUsage();
  const [editing, setEditing] = useState<Json | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Json | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["cpa", "providers"] });

  const remove = useMutation({
    mutationFn: (target: Json) =>
      mutateList(kind, (all) => {
        const i = findIndex(kind, all, target);
        return all.filter((_, j) => j !== i);
      }),
    onSuccess: () => {
      toast.success("已删除");
      setDeleting(null);
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: (target: Json) =>
      mutateList(kind, (all) => {
        const i = findIndex(kind, all, target);
        const next = { ...all[i] };
        if (next.disabled) delete next.disabled;
        else next.disabled = true;
        all[i] = next;
        return all;
      }),
    onSuccess: refresh,
  });

  const columns = kind.openai ? 7 : 6;
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus />
          添加 {kind.label}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{kind.openai ? "名称" : "API Key"}</TableHead>
            <TableHead>Base URL</TableHead>
            {kind.openai && <TableHead className="text-right">Key</TableHead>}
            <TableHead className="text-right">模型</TableHead>
            {!kind.openai && <TableHead>代理</TableHead>}
            <TableHead>最近 200 分钟</TableHead>
            {kind.openai && <TableHead className="w-20">启用</TableHead>}
            <TableHead className="w-24">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={columns} />
          ) : items.length === 0 ? (
            <EmptyRow columns={columns}>还没有配置 {kind.label}</EmptyRow>
          ) : (
            items.map((item) => {
              const title = kind.openai ? str(item.name) : mask(str(item["api-key"]));
              return (
                <TableRow key={identity(kind, item)} className={item.disabled ? "text-muted-foreground" : undefined}>
                  <TableCell className={kind.openai ? "font-medium" : "font-mono text-sm"}>
                    {title}
                    {str(item.prefix) && (
                      <Badge variant="outline" className="ml-2 font-sans">
                        {str(item.prefix)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={str(item["base-url"])}>
                    {str(item["base-url"]) || "官方地址"}
                  </TableCell>
                  {kind.openai && (
                    <TableCell className="text-right tabular-nums">{list(item["api-key-entries"]).length}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {list(item.models).length || "全部"}
                    {list(item["excluded-models"]).length > 0 && (
                      <span className="text-muted-foreground">，排除 {list(item["excluded-models"]).length}</span>
                    )}
                  </TableCell>
                  {!kind.openai && (
                    <TableCell className="max-w-48 truncate text-muted-foreground">
                      {str(item["proxy-url"]) || "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <RequestSparkline buckets={usageOf(kind, item, usage.data)} label={title} />
                  </TableCell>
                  {kind.openai && (
                    <TableCell>
                      <Switch
                        checked={!item.disabled}
                        disabled={toggle.isPending}
                        onCheckedChange={() => toggle.mutate(item)}
                        aria-label={`${item.disabled ? "启用" : "停用"} ${title}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`编辑 ${title}`}
                      onClick={() => setEditing(item)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除 ${title}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {editing !== undefined && <EditDialog kind={kind} target={editing} onClose={() => setEditing(undefined)} />}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {kind.label} 配置</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (kind.openai ? str(deleting.name) : mask(str(deleting["api-key"])))} 会从 CPA 配置中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending && <Spinner />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ProvidersPage() {
  const results = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: ["cpa", "providers", kind.endpoint],
      queryFn: () => api<Json>(`/v0/management/${kind.endpoint}`),
    })),
  });

  return (
    <>
      <PageHeader title="提供商" description="通过 API Key 接入的上游。OAuth 登录的账号在账号页管理。" />
      <Tabs defaultValue={KINDS[0].endpoint}>
        <TabsList variant="line" className="mb-6 flex-wrap">
          {KINDS.map((kind, i) => (
            <TabsTrigger key={kind.endpoint} value={kind.endpoint}>
              {kind.label}
              {list(results[i].data?.[kind.endpoint]).length > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {list(results[i].data?.[kind.endpoint]).length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {KINDS.map((kind, i) => (
          <TabsContent key={kind.endpoint} value={kind.endpoint}>
            {results[i].isError ? (
              <p role="alert" className="text-sm text-destructive">
                读取失败：{results[i].error?.message}
              </p>
            ) : (
              <ProviderTable
                kind={kind}
                items={list(results[i].data?.[kind.endpoint])}
                isPending={results[i].isPending}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
