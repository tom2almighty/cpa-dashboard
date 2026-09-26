import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zipSync } from "fflate";
import {
  Boxes,
  ChevronDown,
  Download,
  Ellipsis,
  FileKey,
  Info,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useDeferredValue, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Pagination, paginate } from "@/components/pagination";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { api, download, fetchBlob, saveBlob } from "@/lib/api";
import { formatDateTime, formatInteger, formatRelative } from "@/lib/format";
import type { AuthFile } from "@/lib/types";

const QUERY_KEY = ["cpa", "auth-files"];
const file = (name: string) => encodeURIComponent(name);
const PAGE_SIZE = 50;

const COOLDOWN_REASONS: Record<string, string> = {
  quota: "额度超限",
  credential_quota: "凭据额度限制",
  cloudflare_challenge: "Cloudflare 验证拦截",
  invalid_grant: "凭据授权失效",
  unauthorized: "未授权 (401)",
  payment_required: "需要付费 (402)",
  not_found: "资源不存在 (404)",
  model_not_supported: "模型不受支持",
  transient_error: "临时网络错误",
};

function StatusCell({ file: f }: { file: AuthFile }) {
  if (f.disabled) return <Badge variant="outline">已停用</Badge>;

  if (f.cooldowns && f.cooldowns.length > 0) {
    const credWide = f.cooldowns.some((c) => c.scope === "credential");
    const modelCount = f.cooldowns.filter((c) => c.scope === "model").length;
    const earliestSec = Math.min(...f.cooldowns.map((c) => c.remaining_seconds || 0));
    const title = f.cooldowns
      .map(
        (c) =>
          `${c.scope === "credential" ? "凭据级" : c.model_key}: ${COOLDOWN_REASONS[c.reason] || c.reason} (剩余约 ${c.remaining_seconds}s)`,
      )
      .join("\n");

    return (
      <span className="grid gap-0.5" title={title}>
        <Badge variant="destructive" className="w-fit">
          {credWide ? "凭据级冷却" : `${modelCount} 个模型冷却`}
        </Badge>
        {earliestSec > 0 && <span className="text-xs text-muted-foreground">约 {earliestSec}s 后恢复</span>}
      </span>
    );
  }

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

function DetailsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>凭证详情 - {accountName(target)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
            <div>
              <span className="text-muted-foreground">文件名：</span>
              <p className="font-mono font-medium">{target.name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">提供商：</span>
              <p className="font-medium">{target.provider || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">账号标识：</span>
              <p className="font-medium">{target.email || target.account || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Auth Index：</span>
              <p className="font-mono">{target.auth_index || "—"}</p>
            </div>
            {target.project_id && (
              <div>
                <span className="text-muted-foreground">项目 ID：</span>
                <p className="font-mono">{target.project_id}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">状态：</span>
              <p className="font-medium">
                {target.disabled ? "已禁用" : target.unavailable ? "冷却中" : target.status || "正常"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">最近刷新：</span>
              <p>{target.last_refresh ? formatDateTime(Date.parse(target.last_refresh)) : "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">更新时间：</span>
              <p>{target.updated_at ? formatDateTime(Date.parse(target.updated_at)) : "—"}</p>
            </div>
          </div>

          {target.cooldowns && target.cooldowns.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <span className="font-medium text-warning">当前冷却限制（{target.cooldowns.length} 项）</span>
              <div className="mt-2 grid gap-1.5">
                {target.cooldowns.map((c) => (
                  <div
                    key={`${c.scope}-${c.model_key ?? "cred"}-${c.reason}`}
                    className="flex items-center justify-between border-b pb-1 last:border-0 last:pb-0"
                  >
                    <div>
                      <span className="font-medium">{c.scope === "credential" ? "整个凭据限制" : c.model_key}</span>
                      <span className="ml-2 text-muted-foreground">（{COOLDOWN_REASONS[c.reason] || c.reason}）</span>
                    </div>
                    <span className="font-mono tabular-nums text-muted-foreground">剩余 ~{c.remaining_seconds}s</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(target.prefix || target.proxy_url || target.priority !== undefined || target.note) && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
              {target.prefix && (
                <div>
                  <span className="text-muted-foreground">前缀路由：</span>
                  <p className="font-mono">{target.prefix}</p>
                </div>
              )}
              {target.proxy_url && (
                <div>
                  <span className="text-muted-foreground">代理地址：</span>
                  <p className="font-mono">{target.proxy_url}</p>
                </div>
              )}
              {target.priority !== undefined && (
                <div>
                  <span className="text-muted-foreground">优先级：</span>
                  <p>{target.priority}</p>
                </div>
              )}
              {target.note && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">备注：</span>
                  <p>{target.note}</p>
                </div>
              )}
            </div>
          )}

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
              查看原始元数据 (JSON)
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
              {JSON.stringify(target, null, 2)}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Dialogs =
  | { kind: "models" | "fields" | "delete" | "details"; target: AuthFile }
  | { kind: "vertex" | "delete-all" | "batch-delete" }
  | null;

export function AuthFilesPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState("");
  const [tab, setTab] = useState<"list" | "quota">("list");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "cooldown" | "disabled">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const deferredKeyword = useDeferredValue(keyword);
  // 页码跟筛选条件绑定,条件一变自动回到第一页
  const filterKey = `${deferredKeyword}|${provider}|${statusFilter}`;
  const [pager, setPager] = useState({ filterKey, page: 1 });
  const page = pager.filterKey === filterKey ? pager.page : 1;
  const setPage = (next: number) => setPager({ filterKey, page: next });

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

  const manualRefresh = useMutation({
    mutationFn: (f: AuthFile) =>
      api("/v0/management/auth-files/refresh", {
        method: "POST",
        body: { name: f.name, ...(f.auth_index ? { auth_index: f.auth_index } : {}) },
      }),
    onSuccess: (_, f) => {
      toast.success(`已刷新 ${accountName(f)} 的凭证`);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(`刷新失败：${err.message}`);
    },
  });

  const batchDelete = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) {
        await api(`/v0/management/auth-files?name=${file(name)}`, { method: "DELETE" });
      }
      return names.length;
    },
    onSuccess: (count) => {
      toast.success(`已批量删除 ${count} 个认证文件`);
      setSelected([]);
      setDialog(null);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(`批量删除失败：${err.message}`);
    },
  });

  const batchToggle = useMutation({
    mutationFn: async (disabled: boolean) => {
      for (const name of selected) {
        await api("/v0/management/auth-files/status", {
          method: "PATCH",
          body: { name, disabled },
        });
      }
      return { count: selected.length, disabled };
    },
    onSuccess: ({ count, disabled }) => {
      toast.success(`已批量${disabled ? "停用" : "启用"} ${count} 个认证文件`);
      setSelected([]);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(`批量设置状态失败：${err.message}`);
    },
  });
  // 选中的文件打包成一个 zip 下载,仅存在于内存的凭据没有文件,跳过
  const batchDownload = useMutation({
    mutationFn: async (names: string[]) => {
      const targets = (data ?? []).filter((f) => names.includes(f.name) && !f.runtime_only);
      if (targets.length === 0) throw new Error("选中的凭据没有可下载的文件");
      const entries = await Promise.all(
        targets.map(async (f) => {
          const blob = await fetchBlob(`/v0/management/auth-files/download?name=${file(f.name)}`);
          return [f.name, new Uint8Array(await blob.arrayBuffer())] as const;
        }),
      );
      saveBlob(new Blob([zipSync(Object.fromEntries(entries))]), `auth-files-${Date.now()}.zip`);
      return { count: targets.length, skipped: names.length - targets.length };
    },
    onSuccess: ({ count, skipped }) =>
      toast.success(`已打包下载 ${count} 个认证文件${skipped ? `，跳过 ${skipped} 个无文件的凭据` : ""}`),
    onError: (err: Error) => toast.error(`批量下载失败：${err.message}`),
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
    return (data ?? []).filter((f) => {
      if (provider && f.provider !== provider) return false;
      const isCooldown = f.unavailable || (f.cooldowns && f.cooldowns.length > 0);
      if (statusFilter === "disabled" && !f.disabled) return false;
      if (statusFilter === "cooldown" && !isCooldown) return false;
      if (statusFilter === "active" && (f.disabled || isCooldown)) return false;
      if (k) {
        const match = [f.name, f.email, f.label, f.note, f.provider].some((v) => v?.toLowerCase().includes(k));
        if (!match) return false;
      }
      return true;
    });
  }, [data, deferredKeyword, provider, statusFilter]);

  const { pageItems, current, pageCount } = paginate(files, page, PAGE_SIZE);
  const allSelected = pageItems.length > 0 && pageItems.every((f) => selected.includes(f.name));
  const toggleAll = () => {
    const names = pageItems.map((f) => f.name);
    setSelected((prev) => (allSelected ? prev.filter((n) => !names.includes(n)) : [...new Set([...prev, ...names])]));
  };
  const toggleOne = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const cooling = data?.filter((f) => f.unavailable && !f.disabled).length ?? 0;

  return (
    <>
      <PageHeader
        title="认证文件"
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
        <Tabs value={tab} onValueChange={(v) => setTab((v as typeof tab) ?? "list")}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <TabsList variant="line">
              <TabsTrigger value="list">列表</TabsTrigger>
              <TabsTrigger value="quota">额度</TabsTrigger>
            </TabsList>
            {tab === "list" && (
              <div className="flex flex-wrap gap-2">
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter((v as typeof statusFilter) ?? "all")}
                >
                  <SelectTrigger className="w-28" aria-label="按状态筛选">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="active">正常</SelectItem>
                    <SelectItem value="cooldown">冷却中</SelectItem>
                    <SelectItem value="disabled">已停用</SelectItem>
                  </SelectContent>
                </Select>
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
            )}
          </div>
          <TabsContent value="quota">
            <QuotaPanel files={data ?? []} />
          </TabsContent>
          <TabsContent value="list">
            {selected.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs">
                <span>
                  已选择 <strong className="font-semibold text-foreground">{selected.length}</strong> 个认证文件
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={batchToggle.isPending}
                    onClick={() => batchToggle.mutate(false)}
                  >
                    {batchToggle.isPending && !batchToggle.variables ? <Spinner className="size-3" /> : null}
                    批量启用
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={batchToggle.isPending}
                    onClick={() => batchToggle.mutate(true)}
                  >
                    {batchToggle.isPending && batchToggle.variables ? <Spinner className="size-3" /> : null}
                    批量停用
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={batchDownload.isPending}
                    onClick={() => batchDownload.mutate(selected)}
                  >
                    {batchDownload.isPending ? <Spinner className="size-3" /> : <Download className="size-3" />}
                    批量下载
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setDialog({ kind: "batch-delete" })}
                  >
                    <Trash2 className="size-3" />
                    批量删除
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                    取消选择
                  </Button>
                </div>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="全选本页" />
                  </TableHead>
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
                  <SkeletonRows columns={9} />
                ) : files.length === 0 ? (
                  <EmptyRow columns={9}>
                    {keyword || provider || statusFilter !== "all"
                      ? "没有匹配的账号"
                      : "还没有认证文件，可以上传 JSON 文件或在 OAuth 登录页添加。"}
                  </EmptyRow>
                ) : (
                  pageItems.map((f) => (
                    <TableRow key={f.id || f.name} className={f.disabled ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.includes(f.name)}
                          onCheckedChange={() => toggleOne(f.name)}
                          aria-label={`选择 ${accountName(f)}`}
                        />
                      </TableCell>
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
                            <DropdownMenuItem onClick={() => setDialog({ kind: "details", target: f })}>
                              <Info />
                              查看详情
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={manualRefresh.isPending}
                              onClick={() => manualRefresh.mutate(f)}
                            >
                              <RefreshCw className={manualRefresh.isPending ? "animate-spin" : undefined} />
                              刷新凭证
                            </DropdownMenuItem>
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
            <Pagination page={current} pageCount={pageCount} total={files.length} onChange={setPage} />
          </TabsContent>
        </Tabs>
      )}

      {dialog?.kind === "models" && <ModelsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "fields" && <FieldsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "details" && <DetailsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "vertex" && <VertexDialog onClose={() => setDialog(null)} />}

      <AlertDialog
        open={dialog?.kind === "delete" || dialog?.kind === "delete-all" || dialog?.kind === "batch-delete"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === "delete-all"
                ? "删除全部认证文件"
                : dialog?.kind === "batch-delete"
                  ? `批量删除认证文件（共 ${selected.length} 项）`
                  : "删除认证文件"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "delete"
                ? `${dialog.target.name} 会从 CPA 的认证目录中删除，删除后无法恢复。`
                : dialog?.kind === "batch-delete"
                  ? `选中的 ${selected.length} 个文件将从 CPA 认证目录彻底删除，删除后无法恢复。`
                  : "认证目录下的所有 JSON 文件都会被删除，对应账号立即停止使用，无法恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || removeAll.isPending || batchDelete.isPending}
              onClick={() => {
                if (dialog?.kind === "delete") remove.mutate(dialog.target);
                else if (dialog?.kind === "batch-delete") batchDelete.mutate(selected);
                else removeAll.mutate();
              }}
            >
              {(remove.isPending || removeAll.isPending || batchDelete.isPending) && <Spinner />}
              {dialog?.kind === "delete-all" ? "全部删除" : dialog?.kind === "batch-delete" ? "确认删除" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
