import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import i18n from "@/i18n";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, orNotFound } from "@/lib/api";
import {
  type Form,
  fetchProviderModels,
  formatModelRows,
  fromForm,
  groupTitle,
  identity,
  type Json,
  KINDS,
  type Kind,
  lines,
  list,
  parseModelRows,
  str,
  testProviderConnectivity,
  toForm,
  usageGroup,
  validate,
} from "@/lib/provider-form";
import type { RecentBucket } from "@/lib/types";

type KeyUsage = { success: number; failed: number; recent_requests?: RecentBucket[] };

// /observability/usage/api-keys 按 provider 分组 -> "base_url|api_key"
function useKeyUsage() {
  return useQuery({
    queryKey: ["cpa", "api-key-usage"],
    queryFn: () => api<Record<string, Record<string, KeyUsage>>>("/v8/management/observability/usage/api-keys"),
    refetchInterval: 60_000,
    retry: false,
  });
}

// 一个分组可能有多个 Key,把它们的桶按位置相加
function usageOf(kind: Kind, item: Json, usage: Record<string, Record<string, KeyUsage>> | undefined): RecentBucket[] {
  const group = usage?.[usageGroup(kind, item)];
  if (!group) return [];
  const base = str(item["base-url"]).trim();
  const buckets: RecentBucket[] = [];
  for (const k of list(item.keys)) {
    (group[`${base}|${str(k["api-key"]).trim()}`]?.recent_requests ?? []).forEach((b, i) => {
      const acc = buckets[i] ?? { time: b.time, success: 0, failed: 0 };
      buckets[i] = { time: acc.time, success: acc.success + b.success, failed: acc.failed + b.failed };
    });
  }
  return buckets;
}

// v8: /config/api-keys/<provider> 整体替换;写前重新读取,只有 404 视为空列表,避免读失败后覆盖掉其它分组
async function mutateList(kind: Kind, change: (items: Json[]) => Json[]) {
  const path = configPath("api-keys", kind.endpoint);
  const updated = change(list(await api<Json[]>(path).catch(orNotFound([]))));
  if (updated.length > 0) await api(path, { method: "PUT", body: updated });
  else await api(path, { method: "DELETE" }).catch(orNotFound(null));
}

function findIndex(items: Json[], target: Json): number {
  const i = items.findIndex((x) => identity(x) === identity(target));
  if (i < 0) throw new Error(i18n.t("providers.err_stale"));
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
  const { t } = useI18n();
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
      const key = lines(form.keys)[0] ?? "";
      if ((kind.openai || kind.baseUrlRequired) && !form.baseUrl.trim()) {
        toast.error(t("providers.base_url_required"));
        return;
      }
      const list = await fetchProviderModels(kind, form.baseUrl, key, form.headers);
      if (list.length === 0) {
        toast.info(t("providers.no_models_fetched"));
      } else {
        setFetchedModels(list);
        toast.success(t("providers.fetch_models_success", { count: list.length }));
      }
    } catch (err) {
      toast.error((err as Error).message || t("providers.fetch_models_failed"));
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
    toast.success(t("providers.models_added", { count: toAdd.length }));
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
          <Label htmlFor={`${p}-models`}>{t("providers.mapping_label")}</Label>
          <p className="text-xs text-muted-foreground">{t("providers.mapping_hint")}</p>
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
            {fetchedModels.length > 0
              ? t("providers.refetch_models", { count: fetchedModels.length })
              : t("providers.fetch_models_short")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleMode}
            className="h-7 text-xs text-muted-foreground"
          >
            {textMode ? t("providers.list_mode") : t("providers.text_mode")}
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
          <p className="text-xs text-muted-foreground">{t("providers.mapping_text_hint")}</p>
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
                  fetchedModels.length > 0
                    ? t("providers.search_fetched", { count: fetchedModels.length })
                    : t("providers.enter_model")
                }
                className="flex-1"
                onKeyDown={(e) => {
                  // 没有高亮项时回车会提交外层表单
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                }}
              />
              <ComboboxContent>
                <ComboboxEmpty>{t("providers.combobox_empty")}</ComboboxEmpty>
                <ComboboxList>
                  {(m: string) => (
                    <ComboboxItem key={m} value={m} className="font-mono text-xs">
                      {m === creatable ? (
                        <>
                          <Plus className="size-3.5" />
                          {t("providers.add_custom", { name: m })}
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
                {t("providers.add_all")}
              </Button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
                <span>{t("providers.upstream_model")}</span>
                <span>{t("providers.mapped_alias")}</span>
                <span className="w-6" />
              </div>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {rows.map((r) => (
                  <li key={r.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <span className="truncate px-1 font-mono text-xs" title={r.name}>
                      {r.name}
                    </span>
                    <Input
                      aria-label={t("providers.alias_aria", { name: r.name })}
                      value={r.alias}
                      placeholder={t("providers.alias_placeholder")}
                      onChange={(e) => setAlias(r.id, e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeRow(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t("providers.remove_aria", { name: r.name })}
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
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(target ?? {}));
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testProviderConnectivity(kind, form);
      setTestResult(res);
      if (res.ok) toast.success(t("providers.test_ok", { message: res.message }));
      else toast.error(t("providers.test_failed_msg", { message: res.message }));
    } catch (err: unknown) {
      setTestResult({ ok: false, message: (err as Error).message });
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };
  const save = useMutation({
    mutationFn: () =>
      mutateList(kind, (items) => {
        if (!target) return [...items, fromForm(kind, form, {})];
        const i = findIndex(items, target);
        items[i] = fromForm(kind, form, items[i]);
        return items;
      }),
    onSuccess: () => {
      toast.success(target ? t("providers.saved") : t("providers.added"));
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
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
            {target ? t("providers.edit") : t("providers.add")} {kind.label}
          </DialogTitle>
        </DialogHeader>
        <form id={`form-${p}`} onSubmit={submit} className="grid gap-4">
          <Field
            id={`${p}-name`}
            label={t("common.name")}
            hint={kind.openai ? t("providers.name_hint") : t("providers.group_name_hint")}
          >
            <Input id={`${p}-name`} value={form.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field id={`${p}-keys`} label="API Key" hint={t("providers.keys_hint")}>
            <Textarea
              id={`${p}-keys`}
              value={form.keys}
              onChange={(e) => update({ keys: e.target.value })}
              className="min-h-20 font-mono text-sm"
            />
          </Field>
          <Field
            id={`${p}-base`}
            label="Base URL"
            hint={kind.openai || kind.baseUrlRequired ? undefined : t("providers.base_url_hint")}
          >
            <Input id={`${p}-base`} value={form.baseUrl} onChange={(e) => update({ baseUrl: e.target.value })} />
          </Field>
          {!kind.openai && (
            <Field id={`${p}-proxy`} label={t("providers.proxy")} hint={t("providers.proxy_hint")}>
              <Input
                id={`${p}-proxy`}
                value={form.proxyUrl}
                onChange={(e) => update({ proxyUrl: e.target.value })}
                placeholder="socks5://127.0.0.1:1080"
              />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${p}-prefix`} label={t("providers.prefix")} hint={t("providers.prefix_hint")}>
              <Input id={`${p}-prefix`} value={form.prefix} onChange={(e) => update({ prefix: e.target.value })} />
            </Field>
            <Field id={`${p}-priority`} label={t("providers.priority")} hint={t("providers.priority_hint")}>
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
                <Label htmlFor={`${p}-ws`}>{t("providers.websockets")}</Label>
                <p className="text-xs text-muted-foreground">{t("providers.websockets_hint")}</p>
              </div>
              <Switch id={`${p}-ws`} checked={form.websockets} onCheckedChange={(v) => update({ websockets: v })} />
            </div>
          )}
          <ModelMappingEditor kind={kind} form={form} update={update} />
          {!kind.openai && (
            <Field id={`${p}-excluded`} label={t("providers.excluded_models")} hint={t("providers.excluded_hint")}>
              <Textarea
                id={`${p}-excluded`}
                value={form.excluded}
                onChange={(e) => update({ excluded: e.target.value })}
                className="min-h-16 font-mono text-sm"
              />
            </Field>
          )}
          <Field id={`${p}-headers`} label={t("providers.extra_headers")} hint={t("providers.headers_hint")}>
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
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing}
              onClick={handleTest}
              className="h-8 text-xs"
            >
              {testing ? <Spinner className="size-3" /> : <Activity className="size-3" />}
              {testing ? t("providers.testing") : t("providers.test_connectivity")}
            </Button>
            {testResult && (
              <span
                className={`max-w-44 truncate text-[11px] ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                title={testResult.message}
              >
                {testResult.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" form={`form-${p}`} disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTable({ kind, items, isPending }: { kind: Kind; items: Json[]; isPending: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const usage = useKeyUsage();
  const [editing, setEditing] = useState<Json | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Json | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: CONFIG_KEY });

  const handleTestItem = async (item: Json) => {
    const id = identity(item);
    setTestingId(id);
    try {
      const f = toForm(item);
      const res = await testProviderConnectivity(kind, f);
      if (res.ok) toast.success(t("providers.test_ok", { message: res.message }));
      else toast.error(t("providers.test_failed_msg", { message: res.message }));
    } catch (e: unknown) {
      toast.error((e as Error).message || t("providers.test_failed"));
    } finally {
      setTestingId(null);
    }
  };
  const remove = useMutation({
    mutationFn: (target: Json) =>
      mutateList(kind, (all) => {
        const i = findIndex(all, target);
        return all.filter((_, j) => j !== i);
      }),
    onSuccess: () => {
      toast.success(t("providers.deleted"));
      setDeleting(null);
      refresh();
    },
  });

  // 只有 OpenAI 兼容分组支持 disabled
  const toggle = useMutation({
    mutationFn: (target: Json) =>
      mutateList(kind, (all) => {
        const i = findIndex(all, target);
        const next = { ...all[i] };
        if (next.disabled) delete next.disabled;
        else next.disabled = true;
        all[i] = next;
        return all;
      }),
    onSuccess: refresh,
  });

  // OpenAI 兼容显示启用开关,其它类型显示分组代理,列数相同
  const columns = 7;
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus />
          {t("providers.add")} {kind.label}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("providers.th_group")}</TableHead>
            <TableHead>Base URL</TableHead>
            <TableHead className="text-right">{t("providers.th_key_count")}</TableHead>
            <TableHead className="text-right">{t("providers.th_model_count")}</TableHead>
            {!kind.openai && <TableHead>{t("providers.proxy")}</TableHead>}
            <TableHead>{t("providers.th_recent")}</TableHead>
            {kind.openai && <TableHead className="w-16">{t("common.enabled")}</TableHead>}
            <TableHead className="w-28">
              <span className="sr-only">{t("common.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={columns} />
          ) : items.length === 0 ? (
            <EmptyRow columns={columns}>{t("providers.empty", { kind: kind.label })}</EmptyRow>
          ) : (
            items.map((item) => {
              const title = groupTitle(item) || t("providers.unnamed_group");
              return (
                <TableRow key={identity(item)} className={item.disabled ? "text-muted-foreground" : undefined}>
                  <TableCell className="font-medium">
                    {title}
                    {str(item.prefix) && (
                      <Badge variant="outline" className="ml-2 font-sans">
                        {str(item.prefix)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={str(item["base-url"])}>
                    {str(item["base-url"]) || t("providers.official_url")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{list(item.keys).length}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {list(item.models).length || t("common.all")}
                    {list(item["excluded-models"]).length > 0 && (
                      <span className="text-muted-foreground">
                        {t("providers.excluded_count", { count: list(item["excluded-models"]).length })}
                      </span>
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
                        aria-label={t(item.disabled ? "providers.enable_aria" : "providers.disable_aria", {
                          name: title,
                        })}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("providers.test_aria", { name: title })}
                      title={t("providers.test_connectivity")}
                      disabled={testingId === identity(item)}
                      onClick={() => handleTestItem(item)}
                    >
                      {testingId === identity(item) ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Activity className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("providers.edit_aria", { name: title })}
                      onClick={() => setEditing(item)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("providers.delete_aria", { name: title })}
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
            <AlertDialogTitle>{t("providers.delete_title", { kind: kind.label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting &&
                t("providers.delete_desc", {
                  name: groupTitle(deleting),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting)}
            >
              {remove.isPending && <Spinner />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ProvidersPage() {
  const { t } = useI18n();
  const { data, isPending, isError, error } = useQuery({
    ...configQuery,
    select: (c) => (c["api-keys"] ?? {}) as Record<string, unknown>,
  });

  return (
    <>
      <PageHeader title={t("providers.title")} description={t("providers.desc")} />
      {isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("providers.load_failed", { message: error.message })}
        </p>
      ) : (
        <Tabs defaultValue={KINDS[0].endpoint}>
          <TabsList className="mb-6 flex-wrap">
            {KINDS.map((kind) => (
              <TabsTrigger key={kind.endpoint} value={kind.endpoint}>
                {kind.label}
                {list(data?.[kind.endpoint]).length > 0 && (
                  <span className="text-muted-foreground tabular-nums">{list(data?.[kind.endpoint]).length}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map((kind) => (
            <TabsContent key={kind.endpoint} value={kind.endpoint}>
              <ProviderTable kind={kind} items={list(data?.[kind.endpoint])} isPending={isPending} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}
