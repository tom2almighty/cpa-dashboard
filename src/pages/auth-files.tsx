import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zipSync } from "fflate";
import {
  Boxes,
  ChevronDown,
  Download,
  Ellipsis,
  FileKey,
  Info,
  Link2,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import i18n from "@/i18n";
import { useI18n } from "@/i18n/context";
import { api, download, errorText, fetchBlob, saveBlob } from "@/lib/api";
import { accountName, CREDENTIALS_KEY, useCredentials } from "@/lib/credentials";
import { formatInteger, formatRelative } from "@/lib/format";
import { showErrorToast } from "@/lib/toast";
import { type AuthFile, authState } from "@/lib/types";
import {
  DetailsDialog,
  FieldsDialog,
  ModelsDialog,
  SiwcBindDialog,
  StatusCell,
  VertexDialog,
} from "./auth-files/dialogs";
import { file } from "./auth-files/shared";

const DEFAULT_PAGE_SIZE = 50;

// 同一文件展开的插件虚拟凭据共用 name,行标识必须带上 auth_index
function rowKey(f: AuthFile): string {
  return f.id || `${f.name}#${f.auth_index ?? ""}`;
}

type BatchResult = { files?: string[]; failed?: { name: string; error: string }[] };

// 批量接口部分失败时返回 207 和 failed 列表,逐条列出
function reportFailed(failed: BatchResult["failed"]) {
  if (!failed?.length) return;
  showErrorToast(
    i18n.t("auth_files.batch_partial_failed", { count: failed.length }),
    failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
  );
}

type Dialogs =
  | { kind: "models" | "fields" | "delete" | "details" | "siwc"; target: AuthFile }
  | { kind: "vertex" | "delete-all" | "batch-delete" }
  | null;

export function AuthFilesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [provider, setProvider] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "cooldown" | "error" | "disabled">("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const deferredKeyword = useDeferredValue(keyword);
  // 页码跟筛选条件绑定,条件一变自动回到第一页
  const filterKey = `${deferredKeyword}|${provider}|${statusFilter}|${pageSize}`;
  const [pager, setPager] = useState({ filterKey, page: 1 });
  const page = pager.filterKey === filterKey ? pager.page : 1;
  const setPage = (next: number) => setPager({ filterKey, page: next });

  const { files: data, isPending, isError, error } = useCredentials();
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });

  // 同一文件展开的插件虚拟凭据共用 name,带上 auth_index 才能定位
  const patchStatus = (f: AuthFile, disabled: boolean) =>
    api("/v8/management/credentials/status", {
      method: "PATCH",
      body: { name: f.name, auth_index: f.auth_index, disabled },
    });

  const toggle = useMutation({
    mutationFn: (f: AuthFile) => patchStatus(f, !f.disabled),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (f: AuthFile) => api(`/v8/management/credentials?name=${file(f.name)}`, { method: "DELETE" }),
    onSuccess: (_, f) => {
      toast.success(t("auth_files.deleted_one", { name: f.name }));
      setDialog(null);
      refresh();
    },
  });

  const removeAll = useMutation({
    mutationFn: () => api<{ deleted?: number }>("/v8/management/credentials?all=true", { method: "DELETE" }),
    onSuccess: (res) => {
      toast.success(t("auth_files.deleted_count", { count: res.deleted ?? 0 }));
      setSelected([]);
      setDialog(null);
      refresh();
    },
  });

  const resetQuota = useMutation({
    mutationFn: (f: AuthFile) =>
      api<{ models?: string[] }>("/v8/management/routing/cooldown/reset", {
        method: "POST",
        body: { auth_index: f.auth_index },
      }),
    onSuccess: (res, f) => {
      toast.success(
        t("auth_files.cooldown_reset_done", {
          name: accountName(f),
          models: res.models?.length
            ? t("auth_files.cooldown_reset_models", { models: res.models.join(t("overview.list_separator")) })
            : "",
        }),
      );
      refresh();
    },
  });
  const manualRefresh = useMutation({
    mutationFn: (f: AuthFile) =>
      api("/v8/management/credentials/refresh", {
        method: "POST",
        body: { name: f.name, ...(f.auth_index ? { auth_index: f.auth_index } : {}) },
      }),
    onSuccess: (_, f) => {
      toast.success(t("auth_files.refreshed", { name: accountName(f) }));
      refresh();
    },
    onError: (err: Error) => {
      toast.error(t("auth_files.refresh_failed", { message: errorText(err) }));
    },
    meta: { quiet: true },
  });

  // 多个 name 一次请求删除,部分失败返回 207;失败的保持选中方便重试
  const batchDelete = useMutation({
    mutationFn: (names: string[]) =>
      api<BatchResult>("/v8/management/credentials", { method: "DELETE", body: { names } }),
    onSuccess: (res, names) => {
      const count = res.files?.length ?? names.length;
      if (count) toast.success(t("auth_files.batch_deleted", { count }));
      reportFailed(res.failed);
      // 删除接口按文件名工作;失败的文件可能对应多个虚拟凭据,按 name 重新映射回行
      const failedNames = new Set(res.failed?.map((f) => f.name) ?? []);
      setSelected(data.filter((f) => failedNames.has(f.name)).map(rowKey));
      setDialog(null);
    },
    onError: (err: Error) => {
      toast.error(t("auth_files.batch_delete_failed", { message: errorText(err) }));
    },
    onSettled: refresh,
    meta: { quiet: true },
  });

  // 状态没有批量接口,并发逐个设置
  const batchToggle = useMutation({
    mutationFn: async (disabled: boolean) => {
      const targets = data.filter((f) => selectedSet.has(rowKey(f)));
      const results = await Promise.allSettled(targets.map((f) => patchStatus(f, disabled)));
      const failed = results.flatMap((r, i) =>
        r.status === "rejected" ? [{ name: targets[i].name, error: errorText(r.reason) }] : [],
      );
      return { count: targets.length - failed.length, failed, disabled };
    },
    onSuccess: ({ count, failed, disabled }) => {
      if (count) toast.success(t(disabled ? "auth_files.batch_disabled" : "auth_files.batch_enabled", { count }));
      reportFailed(failed);
      const failedNames = new Set(failed.map((f) => f.name));
      setSelected(data.filter((f) => failedNames.has(f.name)).map(rowKey));
    },
    onSettled: refresh,
  });
  // 选中的文件打包成一个 zip 下载,仅存在于内存的凭据没有文件,跳过
  const batchDownload = useMutation({
    mutationFn: async (keys: string[]) => {
      const targets = data.filter((f) => keys.includes(rowKey(f)) && !f.runtime_only);
      // 同一个文件展开的多个虚拟凭据只下载一次
      const unique = [...new Map(targets.map((f) => [f.name, f])).values()];
      if (unique.length === 0) throw new Error(t("auth_files.no_downloadable"));
      const entries = await Promise.all(
        unique.map(async (f) => {
          const blob = await fetchBlob(`/v8/management/credentials/download?name=${file(f.name)}`);
          return [f.name, new Uint8Array(await blob.arrayBuffer())] as const;
        }),
      );
      saveBlob(new Blob([zipSync(Object.fromEntries(entries))]), `auth-files-${Date.now()}.zip`);
      return { count: unique.length, skipped: keys.length - unique.length };
    },
    onSuccess: ({ count, skipped }) =>
      toast.success(
        t("auth_files.batch_downloaded", {
          count,
          skipped: skipped ? t("auth_files.batch_download_skipped", { skipped }) : "",
        }),
      ),
    onError: (err: Error) => toast.error(t("auth_files.batch_download_failed", { message: errorText(err) })),
    meta: { quiet: true },
  });

  // 多个文件放在同一个 multipart 请求里上传,部分失败返回 207
  const upload = useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      return api<BatchResult>("/v8/management/credentials", { method: "POST", body: form, raw: true });
    },
    onSuccess: (res, files) => {
      const count = res.files?.length ?? files.length;
      if (count) toast.success(t("auth_files.uploaded", { count }));
      reportFailed(res.failed);
    },
    onSettled: refresh,
  });

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length) upload.mutate(files);
  }

  const providers = useMemo(() => [...new Set(data.map((f) => f.provider ?? "").filter(Boolean))].sort(), [data]);

  const matchFilters = useCallback(
    (f: AuthFile) => {
      const k = deferredKeyword.trim().toLowerCase();
      const wanted = statusFilter === "active" ? "ok" : statusFilter;
      if (provider && f.provider !== provider) return false;
      if (wanted !== "all" && authState(f) !== wanted) return false;
      if (k) {
        const match = [f.name, f.email, f.label, f.note, f.provider].some((v) => v?.toLowerCase().includes(k));
        if (!match) return false;
      }
      return true;
    },
    [deferredKeyword, provider, statusFilter],
  );

  const filtered = useMemo(() => data.filter(matchFilters), [data, matchFilters]);
  const listTotal = filtered.length;
  const pageCount = Math.max(1, Math.ceil(listTotal / pageSize));
  const current = Math.min(page, pageCount);
  const pageItems = filtered.slice((current - 1) * pageSize, current * pageSize);
  const allSelected = pageItems.length > 0 && pageItems.every((f) => selectedSet.has(rowKey(f)));
  const toggleAll = () => {
    const keys = pageItems.map(rowKey);
    setSelected((prev) => (allSelected ? prev.filter((key) => !keys.includes(key)) : [...new Set([...prev, ...keys])]));
  };
  const toggleOne = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const cooling = data.filter((f) => authState(f) === "cooldown").length;
  const erroring = data.filter((f) => authState(f) === "error").length;

  return (
    <>
      <PageHeader
        title={t("auth_files.title")}
        description={
          isPending
            ? undefined
            : t("auth_files.summary_desc", {
                total: data.length,
                disabled: data.filter((f) => f.disabled).length,
                cooling:
                  (cooling ? t("auth_files.cooling_suffix", { cooling }) : "") +
                  (erroring ? t("auth_files.error_suffix", { count: erroring }) : ""),
              })
        }
        actions={
          <div className="flex">
            <Button className="rounded-r-none" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner /> : <Upload />}
              {t("auth_files.upload_files")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="rounded-l-none border-l border-l-primary-foreground/20 px-2"
                    aria-label={t("common.actions")}
                  />
                }
              >
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onClick={() => setDialog({ kind: "vertex" })}>
                  <FileKey />
                  {t("auth_files.import_vertex")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete-all" })}>
                  <Trash2 />
                  {t("auth_files.delete_all")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileInput} type="file" accept=".json,application/json" multiple hidden onChange={onFiles} />
          </div>
        }
      />

      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("auth_files.load_accounts_failed", { message: errorText(error) })}
        </p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter((v as typeof statusFilter) ?? "all")}>
                <SelectTrigger className="w-28" aria-label={t("auth_files.filter_status_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("auth_files.status_all")}</SelectItem>
                  <SelectItem value="active">{t("auth_files.status_active")}</SelectItem>
                  <SelectItem value="cooldown">{t("auth_files.status_cooldown")}</SelectItem>
                  <SelectItem value="error">{t("auth_files.status_auth_error")}</SelectItem>
                  <SelectItem value="disabled">{t("auth_files.status_disabled")}</SelectItem>
                </SelectContent>
              </Select>
              <Select
                items={[
                  { value: "", label: t("auth_files.filter_provider") },
                  ...providers.map((p) => ({ value: p, label: p })),
                ]}
                value={provider}
                onValueChange={(v) => setProvider(v ?? "")}
              >
                <SelectTrigger className="w-36" aria-label={t("auth_files.filter_provider_label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("auth_files.filter_provider")}</SelectItem>
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
                  placeholder={t("auth_files.search_short_placeholder")}
                  aria-label={t("auth_files.search_label")}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-56 pl-8"
                />
              </div>
            </div>
          </div>
          {selected.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs">
              <span>{t("auth_files.selected_count", { count: selected.length })}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={batchToggle.isPending}
                  onClick={() => batchToggle.mutate(false)}
                >
                  {batchToggle.isPending && !batchToggle.variables ? <Spinner className="size-3" /> : null}
                  {t("auth_files.batch_enable")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={batchToggle.isPending}
                  onClick={() => batchToggle.mutate(true)}
                >
                  {batchToggle.isPending && batchToggle.variables ? <Spinner className="size-3" /> : null}
                  {t("auth_files.batch_disable")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={batchDownload.isPending}
                  onClick={() => batchDownload.mutate(selected)}
                >
                  {batchDownload.isPending ? <Spinner className="size-3" /> : <Download className="size-3" />}
                  {t("auth_files.batch_download")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setDialog({ kind: "batch-delete" })}
                >
                  <Trash2 className="size-3" />
                  {t("auth_files.batch_delete")}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected([])}>
                  {t("auth_files.clear_selection")}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label={t("auth_files.select_page")}
                  />
                </TableHead>
                <TableHead>{t("auth_files.th_account")}</TableHead>
                <TableHead>{t("auth_files.th_provider")}</TableHead>
                <TableHead>{t("auth_files.th_status")}</TableHead>
                <TableHead>{t("auth_files.th_recent")}</TableHead>
                <TableHead className="text-right">{t("auth_files.th_requests")}</TableHead>
                <TableHead>{t("auth_files.th_last_refresh")}</TableHead>
                <TableHead className="w-16">{t("common.enabled")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <SkeletonRows columns={9} />
              ) : filtered.length === 0 ? (
                <EmptyRow columns={9}>
                  {keyword || provider || statusFilter !== "all" ? t("auth_files.no_match") : t("auth_files.empty")}
                </EmptyRow>
              ) : (
                pageItems.map((f) => (
                  <TableRow key={rowKey(f)} className={f.disabled ? "text-muted-foreground" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selectedSet.has(rowKey(f))}
                        onCheckedChange={() => toggleOne(rowKey(f))}
                        aria-label={t("auth_files.select_item", { name: accountName(f) })}
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
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.provider ? <Badge variant="secondary">{f.provider}</Badge> : "—"}
                        {(f.siwc_status === "valid" || f.siwc_status === "invalid") && (
                          <Badge
                            variant={f.siwc_status === "invalid" ? "destructive" : "outline"}
                            className="font-normal"
                          >
                            {t(`auth_files.siwc_status_${f.siwc_status}` as never)}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusCell file={f} />
                    </TableCell>
                    <TableCell>
                      <RequestSparkline buckets={f.recent_requests ?? []} label={accountName(f)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatInteger(f.success ?? 0)}
                      <span className="text-muted-foreground"> / </span>
                      <span className={f.failed ? "text-destructive" : undefined}>{formatInteger(f.failed ?? 0)}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {f.last_refresh ? formatRelative(Date.parse(f.last_refresh)) : "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={!f.disabled}
                        disabled={toggle.isPending && toggle.variables?.id === f.id}
                        onCheckedChange={() => toggle.mutate(f)}
                        aria-label={t(f.disabled ? "auth_files.enable_item" : "auth_files.disable_item", {
                          name: accountName(f),
                        })}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("auth_files.item_actions", { name: accountName(f) })}
                            />
                          }
                        >
                          <Ellipsis />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem onClick={() => setDialog({ kind: "details", target: f })}>
                            <Info />
                            {t("auth_files.view_details")}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={manualRefresh.isPending} onClick={() => manualRefresh.mutate(f)}>
                            <RefreshCw className={manualRefresh.isPending ? "animate-spin" : undefined} />
                            {t("auth_files.refresh_credential")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDialog({ kind: "models", target: f })}>
                            <Boxes />
                            {t("auth_files.view_models")}
                          </DropdownMenuItem>
                          {f.provider?.toLowerCase() === "codex" && f.siwc_bind_supported && (
                            <DropdownMenuItem onClick={() => setDialog({ kind: "siwc", target: f })}>
                              <Link2 />
                              {f.siwc_bound ? t("auth_files.siwc_rebind") : t("auth_files.siwc_bind")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={f.runtime_only}
                            onClick={() => setDialog({ kind: "fields", target: f })}
                          >
                            <PencilLine />
                            {t("auth_files.edit_properties")}
                          </DropdownMenuItem>
                          {f.auth_index && (
                            <DropdownMenuItem onClick={() => resetQuota.mutate(f)}>
                              <RotateCcw />
                              {t("auth_files.cooldown_reset")}
                            </DropdownMenuItem>
                          )}
                          {!f.runtime_only && (
                            <>
                              <DropdownMenuItem
                                onClick={() =>
                                  download(`/v8/management/credentials/download?name=${file(f.name)}`, f.name).catch(
                                    (e: Error) => toast.error(errorText(e)),
                                  )
                                }
                              >
                                <Download />
                                {t("auth_files.download_file")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDialog({ kind: "delete", target: f })}
                              >
                                <Trash2 />
                                {t("common.delete")}
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
          <Pagination
            page={current}
            pageCount={pageCount}
            total={listTotal}
            onChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      {dialog?.kind === "models" && <ModelsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "fields" && <FieldsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "details" && <DetailsDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "siwc" && <SiwcBindDialog target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.kind === "vertex" && <VertexDialog onClose={() => setDialog(null)} />}

      <AlertDialog
        open={dialog?.kind === "delete" || dialog?.kind === "delete-all" || dialog?.kind === "batch-delete"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === "delete-all"
                ? t("auth_files.delete_all")
                : dialog?.kind === "batch-delete"
                  ? t("auth_files.batch_delete_title", { count: selected.length })
                  : t("auth_files.delete_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "delete"
                ? t("auth_files.delete_desc", { name: dialog.target.name })
                : dialog?.kind === "batch-delete"
                  ? t("auth_files.batch_delete_desc", { count: selected.length })
                  : t("auth_files.delete_all_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || removeAll.isPending || batchDelete.isPending}
              onClick={() => {
                if (dialog?.kind === "delete") remove.mutate(dialog.target);
                else if (dialog?.kind === "batch-delete") {
                  const names = data.filter((f) => selectedSet.has(rowKey(f))).map((f) => f.name);
                  batchDelete.mutate([...new Set(names)]);
                } else removeAll.mutate();
              }}
            >
              {(remove.isPending || removeAll.isPending || batchDelete.isPending) && <Spinner />}
              {dialog?.kind === "delete-all"
                ? t("auth_files.delete_all_btn")
                : dialog?.kind === "batch-delete"
                  ? t("auth_files.confirm_delete")
                  : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
