import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatInteger, formatRelative } from "@/lib/format";
import type { AuthFile } from "@/lib/types";

const QUERY_KEY = ["cpa", "auth-files"];

function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

function StatusCell({ file }: { file: AuthFile }) {
  if (file.disabled) return <Badge variant="outline">已停用</Badge>;
  if (file.unavailable) {
    return (
      <Badge variant="destructive" title={file.status_message}>
        不可用
      </Badge>
    );
  }
  if (file.status && file.status !== "ready" && file.status !== "active") {
    return (
      <Badge variant="secondary" title={file.status_message}>
        {file.status}
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

export function AccountsPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [deleting, setDeleting] = useState<AuthFile | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api<{ files: AuthFile[] }>("/v0/management/auth-files"),
    select: (res) => res.files ?? [],
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const toggle = useMutation({
    mutationFn: (file: AuthFile) =>
      api("/v0/management/auth-files/status", { method: "PATCH", body: { name: file.name, disabled: !file.disabled } }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (file: AuthFile) =>
      api(`/v0/management/auth-files?name=${encodeURIComponent(file.name)}`, { method: "DELETE" }),
    onSuccess: (_, file) => {
      toast.success(`已删除 ${file.name}`);
      setDeleting(null);
      refresh();
    },
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
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

  const files = useMemo(() => {
    const list = data ?? [];
    const k = keyword.trim().toLowerCase();
    if (!k) return list;
    return list.filter((f) => [f.name, f.email, f.label, f.provider].some((v) => v?.toLowerCase().includes(k)));
  }, [data, keyword]);

  return (
    <>
      <PageHeader
        title="账号"
        description={
          data ? `共 ${data.length} 个认证文件，${data.filter((f) => f.disabled).length} 个已停用。` : undefined
        }
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="搜索账号或提供商"
                aria-label="搜索账号"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-56 pl-8"
              />
            </div>
            <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner /> : <Upload />}
              上传认证文件
            </Button>
            <input ref={fileInput} type="file" accept=".json,application/json" multiple hidden onChange={onFiles} />
          </>
        }
      />

      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          读取账号失败：{error.message}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead>提供商</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">成功 / 失败</TableHead>
              <TableHead>最近刷新</TableHead>
              <TableHead className="w-24">启用</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <SkeletonRows columns={7} />
            ) : files.length === 0 ? (
              <EmptyRow columns={7}>{keyword ? "没有匹配的账号" : "还没有认证文件，可以上传 JSON 文件添加。"}</EmptyRow>
            ) : (
              files.map((file) => (
                <TableRow key={file.id || file.name} className={file.disabled ? "text-muted-foreground" : undefined}>
                  <TableCell className="max-w-72">
                    <div className="truncate font-medium" title={accountName(file)}>
                      {accountName(file)}
                    </div>
                    {accountName(file) !== file.name && (
                      <div className="truncate text-xs text-muted-foreground" title={file.name}>
                        {file.name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{file.provider ? <Badge variant="secondary">{file.provider}</Badge> : "—"}</TableCell>
                  <TableCell>
                    <StatusCell file={file} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInteger(file.success ?? 0)}
                    <span className="text-muted-foreground"> / </span>
                    <span className={file.failed ? "text-destructive" : undefined}>
                      {formatInteger(file.failed ?? 0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {file.last_refresh ? formatRelative(Date.parse(file.last_refresh)) : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={!file.disabled}
                      disabled={toggle.isPending && toggle.variables?.name === file.name}
                      onCheckedChange={() => toggle.mutate(file)}
                      aria-label={`${file.disabled ? "启用" : "停用"} ${accountName(file)}`}
                    />
                  </TableCell>
                  <TableCell>
                    {!file.runtime_only && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除 ${file.name}`}
                        onClick={() => setDeleting(file)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除认证文件</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} 会从 CPA 的认证目录中删除，删除后无法恢复。
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
