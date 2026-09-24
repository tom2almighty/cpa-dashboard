import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  ChevronDown,
  Download,
  Ellipsis,
  FileKey,
  PencilLine,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useDeferredValue, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { accountName, QuotaPanel } from "@/components/quota-panel";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, download } from "@/lib/api";
import { formatDateTime, formatInteger, formatRelative } from "@/lib/format";
import type { AuthFile } from "@/lib/types";

const QUERY_KEY = ["cpa", "auth-files"];
const file = (name: string) => encodeURIComponent(name);

function StatusCell({ file: f }: { file: AuthFile }) {
  if (f.disabled) return <Badge variant="outline">已停用</Badge>;
  if (f.unavailable) {
    const retry = f.next_retry_after ? Date.parse(f.next_retry_after) : Number.NaN;
    return (
      <span className="grid gap-0.5">
        <Badge variant="destructive" title={f.status_message}>
          冷却中
        </Badge>
        {Number.isFinite(retry) && retry > Date.now() && (
          <span className="text-xs text-muted-foreground">{formatDateTime(retry)} 恢复</span>
        )}
      </span>
    );
  }
  if (f.status && f.status !== "ready" && f.status !== "active") {
    return (
      <Badge variant="secondary" title={f.status_message}>
        {f.status}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      正常
    </span>
  );
}

function ModelsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "auth-file-models", target.name],
    queryFn: () =>
      api<{ models?: { id: string; display_name?: string; owned_by?: string }[] }>(
        `/v0/management/auth-files/models?name=${file(target.name)}`,
      ),
    select: (res) => res.models ?? [],
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{accountName(target)} 可用的模型</DialogTitle>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-48" />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            读取失败：{error.message}
          </p>
        ) : data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">这个账号没有可用的模型</p>
        ) : (
          <ul className="max-h-[60svh] divide-y overflow-y-auto rounded-lg border">
            {data.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <code className="font-mono">{m.id}</code>
                {m.display_name && m.display_name !== m.id && (
                  <span className="truncate text-muted-foreground">{m.display_name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Fields = { note: string; prefix: string; proxy_url: string; priority: string; headers: string };

function readFields(source: Record<string, unknown>): Fields {
  const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const headers = (source.headers ?? {}) as Record<string, string>;
  return {
    note: text(source.note),
    prefix: text(source.prefix),
    proxy_url: text(source.proxy_url),
    priority: text(source.priority),
    headers: Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
  };
}

function parseHeaders(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes(":"))
      .map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
}

// 只提交改动的字段;清空的文本写成空字符串,清空的优先级写成 null,删掉的请求头写成空值
function diffFields(before: Fields, after: Fields): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["note", "prefix", "proxy_url"] as const) {
    if (before[key] !== after[key]) patch[key] = after[key].trim();
  }
  if (before.priority !== after.priority) patch.priority = after.priority.trim() ? Number(after.priority) : null;
  if (before.headers !== after.headers) {
    const old = parseHeaders(before.headers);
    const next = parseHeaders(after.headers);
    patch.headers = { ...Object.fromEntries(Object.keys(old).map((k) => [k, ""])), ...next };
  }
  return patch;
}

function FieldsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const queryClient = useQueryClient();
  // 列表里不含前缀、代理等字段,文件型账号读取原文件拿到完整值
  const source = useQuery({
    queryKey: ["cpa", "auth-file-content", target.name],
    queryFn: () =>
      target.runtime_only
        ? Promise.resolve(target as unknown as Record<string, unknown>)
        : api<Record<string, unknown>>(`/v0/management/auth-files/download?name=${file(target.name)}`),
    select: readFields,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<Fields | null>(null);
  const form = draft ?? source.data;

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api("/v0/management/auth-files/fields", { method: "PATCH", body: { name: target.name, ...patch } }),
    onSuccess: () => {
      toast.success("已保存");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["cpa", "auth-file-content", target.name] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || !source.data) return;
    if (form.priority.trim() && !/^-?\d+$/.test(form.priority.trim())) {
      toast.error("优先级必须是整数");
      return;
    }
    const patch = diffFields(source.data, form);
    if (Object.keys(patch).length === 0) onClose();
    else save.mutate(patch);
  }

  const update = (patch: Partial<Fields>) => form && setDraft({ ...form, ...patch });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑 {accountName(target)}</DialogTitle>
        </DialogHeader>
        {!form ? (
          <Skeleton className="h-72" />
        ) : (
          <form id="fields-form" onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="f-note">备注</Label>
              <Input id="f-note" value={form.note} onChange={(e) => update({ note: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="f-prefix">模型前缀</Label>
                <Input id="f-prefix" value={form.prefix} onChange={(e) => update({ prefix: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-priority">优先级</Label>
                <Input
                  id="f-priority"
                  inputMode="numeric"
                  value={form.priority}
                  onChange={(e) => update({ priority: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-proxy">代理</Label>
              <Input
                id="f-proxy"
                value={form.proxy_url}
                placeholder="留空使用全局代理"
                onChange={(e) => update({ proxy_url: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-headers">额外请求头</Label>
              <Textarea
                id="f-headers"
                value={form.headers}
                onChange={(e) => update({ headers: e.target.value })}
                className="min-h-20 font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">每行一个，格式为 名称: 值</p>
            </div>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="fields-form" disabled={!form || save.isPending}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VertexDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<File | null>(null);
  const [location, setLocation] = useState("us-central1");
  const importKey = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (picked) form.append("file", picked);
      if (location.trim()) form.append("location", location.trim());
      return api<{ project_id?: string }>("/v0/management/vertex/import", { method: "POST", body: form, raw: true });
    },
    onSuccess: (res) => {
      toast.success(`已导入 Vertex 项目 ${res.project_id ?? ""}`);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入 Vertex 服务账号</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="v-file">服务账号密钥</Label>
            <Input
              id="v-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Google Cloud 控制台下载的 JSON，需包含 project_id 和 private_key。
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-location">区域</Label>
            <Input id="v-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!picked || importKey.isPending} onClick={() => importKey.mutate()}>
            {importKey.isPending && <Spinner />}
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Dialogs = { kind: "models" | "fields" | "delete"; target: AuthFile } | { kind: "vertex" | "delete-all" } | null;

export function AccountsPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState("");
  const [dialog, setDialog] = useState<Dialogs>(null);
  const deferredKeyword = useDeferredValue(keyword);

  const { data, isPending, isError, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<{ files: AuthFile[] }>("/v0/management/auth-files"),
    select: (res) => res.files ?? [],
    refetchInterval: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const toggle = useMutation({
    mutationFn: (f: AuthFile) =>
      api("/v0/management/auth-files/status", { method: "PATCH", body: { name: f.name, disabled: !f.disabled } }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (f: AuthFile) => api(`/v0/management/auth-files?name=${file(f.name)}`, { method: "DELETE" }),
    onSuccess: (_, f) => {
      toast.success(`已删除 ${f.name}`);
      setDialog(null);
      refresh();
    },
  });

  const removeAll = useMutation({
    mutationFn: () => api<{ deleted?: number }>("/v0/management/auth-files?all=true", { method: "DELETE" }),
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted ?? 0} 个认证文件`);
      setDialog(null);
      refresh();
    },
  });

  const resetQuota = useMutation({
    mutationFn: (f: AuthFile) =>
      api<{ models?: string[] }>("/v0/management/reset-quota", { method: "POST", body: { auth_index: f.auth_index } }),
    onSuccess: (res, f) => {
      toast.success(`已重置 ${accountName(f)} 的冷却状态${res.models?.length ? `（${res.models.join("、")}）` : ""}`);
      refresh();
    },
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) {
        const form = new FormData();
        form.append("file", f);
        await api("/v0/management/auth-files", { method: "POST", body: form, raw: true });
      }
      return files.length;
    },
    onSuccess: (count) => toast.success(`已上传 ${count} 个认证文件`),
    onSettled: refresh,
  });

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length) upload.mutate(files);
  }

  const providers = useMemo(
    () => [...new Set((data ?? []).map((f) => f.provider ?? "").filter(Boolean))].sort(),
    [data],
  );

  const files = useMemo(() => {
    const k = deferredKeyword.trim().toLowerCase();
    return (data ?? []).filter(
      (f) =>
        (!provider || f.provider === provider) &&
        (!k || [f.name, f.email, f.label, f.note, f.provider].some((v) => v?.toLowerCase().includes(k))),
    );
  }, [data, deferredKeyword, provider]);

  const cooling = data?.filter((f) => f.unavailable && !f.disabled).length ?? 0;

  return (
    <>
      <PageHeader
        title="账号"
        description={
          data
            ? `共 ${data.length} 个认证文件，${data.filter((f) => f.disabled).length} 个已停用${cooling ? `，${cooling} 个冷却中` : ""}。`
            : undefined
        }
        actions={
          <div className="flex">
            <Button className="rounded-r-none" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner /> : <Upload />}
              上传认证文件
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="rounded-l-none border-l border-l-primary-foreground/20 px-2"
                    aria-label="更多操作"
                  />
                }
              >
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onClick={() => setDialog({ kind: "vertex" })}>
                  <FileKey />
                  导入 Vertex 服务账号
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete-all" })}>
                  <Trash2 />
                  删除全部认证文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileInput} type="file" accept=".json,application/json" multiple hidden onChange={onFiles} />
          </div>
        }
      />

      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          读取账号失败：{error.message}
        </p>
      ) : (
        <Tabs defaultValue="list">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <TabsList variant="line">
              <TabsTrigger value="list">列表</TabsTrigger>
              <TabsTrigger value="quota">额度</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <Select
                items={[{ value: "", label: "全部提供商" }, ...providers.map((p) => ({ value: p, label: p }))]}
                value={provider}
                onValueChange={(v) => setProvider(v ?? "")}
              >
                <SelectTrigger className="w-36" aria-label="按提供商筛选">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">全部提供商</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="搜索账号、备注"
                  aria-label="搜索账号"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-56 pl-8"
                />
              </div>
            </div>
          </div>
          <TabsContent value="quota">
            <QuotaPanel files={files} />
          </TabsContent>
          <TabsContent value="list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>提供商</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近 200 分钟</TableHead>
                  <TableHead className="text-right">累计成功 / 失败</TableHead>
                  <TableHead>最近刷新</TableHead>
                  <TableHead className="w-16">启用</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <SkeletonRows columns={8} />
                ) : files.length === 0 ? (
                  <EmptyRow columns={8}>
                    {keyword || provider
                      ? "没有匹配的账号"
                      : "还没有认证文件，可以上传 JSON 文件或在 OAuth 登录页添加。"}
                  </EmptyRow>
                ) : (
                  files.map((f) => (
                    <TableRow key={f.id || f.name} className={f.disabled ? "text-muted-foreground" : undefined}>
                      <TableCell className="max-w-72">
                        <div className="truncate font-medium" title={accountName(f)}>
                          {accountName(f)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" title={f.note || f.name}>
                          {f.note || (accountName(f) !== f.name ? f.name : "")}
                        </div>
                      </TableCell>
                      <TableCell>{f.provider ? <Badge variant="secondary">{f.provider}</Badge> : "—"}</TableCell>
                      <TableCell>
                        <StatusCell file={f} />
                      </TableCell>
                      <TableCell>
                        <RequestSparkline buckets={f.recent_requests ?? []} label={accountName(f)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatInteger(f.success ?? 0)}
                        <span className="text-muted-foreground"> / </span>
                        <span className={f.failed ? "text-destructive" : undefined}>
                          {formatInteger(f.failed ?? 0)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.last_refresh ? formatRelative(Date.parse(f.last_refresh)) : "—"}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={!f.disabled}
                          disabled={toggle.isPending && toggle.variables?.name === f.name}
                          onCheckedChange={() => toggle.mutate(f)}
                          aria-label={`${f.disabled ? "启用" : "停用"} ${accountName(f)}`}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" aria-label={`${accountName(f)} 的操作`} />}
                          >
                            <Ellipsis />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuItem onClick={() => setDialog({ kind: "models", target: f })}>
                              <Boxes />
                              查看可用模型
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ kind: "fields", target: f })}>
                              <PencilLine />
                              编辑属性
                            </DropdownMenuItem>
                            {f.auth_index && (
                              <DropdownMenuItem onClick={() => resetQuota.mutate(f)}>
                                <RotateCcw />
                                重置冷却
                              </DropdownMenuItem>
                            )}
                            {!f.runtime_only && (
                              <>
                                <DropdownMenuItem
                                  onClick={() =>
                                    download(`/v0/management/auth-files/download?name=${file(f.name)}`, f.name).catch(
                                      (e: Error) => toast.error(e.message),
                                    )
                                  }
                                >
                                  <Download />
                                  下载认证文件
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setDialog({ kind: "delete", target: f })}
                                >
                                  <Trash2 />
                                  删除
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      )}

      {dialog?.kind === "models" && <ModelsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "fields" && <FieldsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "vertex" && <VertexDialog onClose={() => setDialog(null)} />}

      <AlertDialog
        open={dialog?.kind === "delete" || dialog?.kind === "delete-all"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog?.kind === "delete-all" ? "删除全部认证文件" : "删除认证文件"}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "delete"
                ? `${dialog.target.name} 会从 CPA 的认证目录中删除，删除后无法恢复。`
                : "认证目录下的所有 JSON 文件都会被删除，对应账号立即停止使用，无法恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || removeAll.isPending}
              onClick={() => (dialog?.kind === "delete" ? remove.mutate(dialog.target) : removeAll.mutate())}
            >
              {(remove.isPending || removeAll.isPending) && <Spinner />}
              {dialog?.kind === "delete-all" ? "全部删除" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
