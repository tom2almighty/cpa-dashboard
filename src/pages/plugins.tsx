import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Settings2, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

type ConfigField = { name: string; type?: string; enum_values?: string[] | null; description?: string };

type Plugin = {
  id: string;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  config_fields?: ConfigField[] | null;
  menus?: { path: string; menu?: string; description?: string }[] | null;
  metadata?: {
    name?: string;
    version?: string;
    author?: string;
    github_repository?: string;
    config_fields?: ConfigField[] | null;
  };
};

// 插件资源页挂在 /v0/resource/plugins/<id>/ 下,菜单路径可能已带前缀
function menuHref(pluginId: string, path: string): string {
  if (path.startsWith("/v0/")) return path;
  return `/v0/resource/plugins/${encodeURIComponent(pluginId)}${path.startsWith("/") ? "" : "/"}${path}`;
}

function fieldsOf(p: Plugin): ConfigField[] {
  return (p.config_fields?.length ? p.config_fields : p.metadata?.config_fields) ?? [];
}

function kindOf(f: ConfigField): "bool" | "number" | "enum" | "text" {
  if (f.enum_values?.length) return "enum";
  const t = (f.type ?? "").toLowerCase();
  if (t.startsWith("bool")) return "bool";
  if (/int|float|number|double/.test(t)) return "number";
  return "text";
}

type PluginsResponse = { plugins_enabled?: boolean; plugins_dir?: string; plugins?: Plugin[] };

type StorePlugin = {
  store_id: string;
  source_id: string;
  source_name?: string;
  id: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  installed?: boolean;
  installed_version?: string;
  update_available?: boolean;
};

type StoreResponse = { sources?: { id: string; name?: string; error?: string }[]; plugins?: StorePlugin[] };

const PLUGINS_KEY = ["cpa", "plugins"];

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `plugin-field-${field.name}`;
  const kind = kindOf(field);
  let control: React.ReactNode;
  if (kind === "bool") {
    control = <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
  } else if (kind === "enum") {
    const items = (field.enum_values ?? []).map((v) => ({ value: v, label: v }));
    control = (
      <Select
        items={items}
        value={value === undefined || value === null ? null : String(value)}
        onValueChange={onChange}
      >
        <SelectTrigger id={id} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else {
    control = (
      <Input
        id={id}
        inputMode={kind === "number" ? "decimal" : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(kind === "number" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw);
        }}
        className={kind === "number" ? "w-32" : "w-full sm:w-72"}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-mono text-sm">
          {field.name}
        </Label>
        {field.description && <p className="mt-0.5 text-sm text-muted-foreground">{field.description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function ConfigDialog({ plugin, onClose }: { plugin: Plugin | null; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const fields = plugin ? fieldsOf(plugin) : [];
  const [asJson, setAsJson] = useState(false);
  const useForm = fields.length > 0 && !asJson;
  const { data, isPending } = useQuery({
    queryKey: ["cpa", "plugin-config", plugin?.id],
    queryFn: () => api<unknown>(`/v0/management/plugins/${encodeURIComponent(plugin?.id ?? "")}/config`),
    enabled: plugin !== null,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (data === undefined) return;
    setDraft(JSON.stringify(data, null, 2));
    setValues(data && typeof data === "object" ? (data as Record<string, unknown>) : {});
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const value = useForm ? values : (JSON.parse(draft) as unknown);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是 JSON 对象");
      return api(`/v0/management/plugins/${encodeURIComponent(plugin?.id ?? "")}/config`, {
        method: "PUT",
        body: value,
      });
    },
    onSuccess: () => {
      toast.success("插件配置已保存");
      onClose();
    },
  });

  return (
    <Dialog open={plugin !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plugin?.metadata?.name || plugin?.id} 配置</DialogTitle>
        </DialogHeader>
        {fields.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => {
                if (!asJson) setDraft(JSON.stringify(values, null, 2));
                else {
                  try {
                    setValues(JSON.parse(draft) as Record<string, unknown>);
                  } catch {
                    return;
                  }
                }
                setAsJson((v) => !v);
              }}
            >
              {asJson ? "用表单编辑" : "编辑 JSON"}
            </Button>
          </div>
        )}
        {isPending ? (
          <Skeleton className="h-80" />
        ) : useForm ? (
          <div className="max-h-[60svh] divide-y overflow-y-auto">
            {fields.map((f) => (
              <FieldControl
                key={f.name}
                field={f}
                value={values[f.name]}
                onChange={(v) => setValues((cur) => ({ ...cur, [f.name]: v }))}
              />
            ))}
          </div>
        ) : (
          <CodeEditor
            label="插件配置"
            language="json"
            height="20rem"
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate()}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} disabled={isPending || save.isPending}>
            {save.isPending && <Spinner />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Installed() {
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState<Plugin | null>(null);
  const [deleting, setDeleting] = useState<Plugin | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: () => api<PluginsResponse>("/v0/management/plugins"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: PLUGINS_KEY });

  const toggle = useMutation({
    mutationFn: (p: Plugin) =>
      api(`/v0/management/plugins/${encodeURIComponent(p.id)}/enabled`, {
        method: "PATCH",
        body: { enabled: !p.enabled },
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (p: Plugin) =>
      api<{ restart_required?: boolean }>(`/v0/management/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }),
    onSuccess: (res, p) => {
      toast.success(res.restart_required ? `已删除 ${p.id}，重启 CPA 后生效` : `已删除 ${p.id}`);
      setDeleting(null);
      refresh();
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取插件失败：{error.message}
      </p>
    );
  }

  return (
    <>
      {data?.plugins_enabled === false && (
        <p role="alert" className="mb-4 text-sm text-muted-foreground">
          CPA 没有开启插件功能，需要在 config.yaml 的 plugins 里开启后才会加载插件。
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>插件</TableHead>
            <TableHead>版本</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="w-24">启用</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">操作</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={5} />
          ) : !data?.plugins?.length ? (
            <EmptyRow columns={5}>还没有插件，可以从插件商店安装。</EmptyRow>
          ) : (
            data.plugins.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.metadata?.name || p.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.id}
                    {p.metadata?.author && `，作者 ${p.metadata.author}`}
                  </div>
                  {p.effective_enabled && (p.menus?.length ?? 0) > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {p.menus?.map((m) => (
                        <a
                          key={m.path}
                          href={menuHref(p.id, m.path)}
                          target="_blank"
                          rel="noreferrer"
                          title={m.description}
                          className="inline-flex items-center gap-1 text-xs text-chart-1 hover:underline"
                        >
                          {m.menu || m.path}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{p.metadata?.version || "—"}</TableCell>
                <TableCell>
                  {p.effective_enabled ? (
                    <Badge variant="secondary">运行中</Badge>
                  ) : p.registered ? (
                    <Badge variant="outline">已停用</Badge>
                  ) : (
                    <Badge variant="outline">未加载</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={p.enabled === true}
                    disabled={toggle.isPending && toggle.variables?.id === p.id}
                    onCheckedChange={() => toggle.mutate(p)}
                    aria-label={`${p.enabled ? "停用" : "启用"} ${p.metadata?.name || p.id}`}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={`配置 ${p.id}`} onClick={() => setConfiguring(p)}>
                    <Settings2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`删除 ${p.id}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleting(p)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {configuring && <ConfigDialog plugin={configuring} onClose={() => setConfiguring(null)} />}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除插件</AlertDialogTitle>
            <AlertDialogDescription>会删除 {deleting?.id} 的插件文件和已保存的配置。</AlertDialogDescription>
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

function Store() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [installingTarget, setInstallingTarget] = useState<StorePlugin | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "plugin-store"],
    queryFn: () => api<StoreResponse>("/v0/management/plugin-store"),
  });

  const install = useMutation({
    mutationFn: (p: StorePlugin) =>
      api<{ restart_required?: boolean; version?: string }>(
        `/v0/management/plugin-store/${encodeURIComponent(p.id)}/install?source=${encodeURIComponent(p.source_id)}`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res, p) => {
      toast.success(`已安装 ${p.name || p.id} ${res.version ?? ""}${res.restart_required ? "，重启 CPA 后生效" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["cpa", "plugin-store"] });
      queryClient.invalidateQueries({ queryKey: PLUGINS_KEY });
      setInstallingTarget(null);
    },
  });

  const sourceErrors = data?.sources?.filter((s) => s.error) ?? [];
  const plugins = useMemo(() => {
    const list = data?.plugins ?? [];
    if (!search.trim()) return list;
    const term = search.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name?.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term) ||
        p.description?.toLowerCase().includes(term) ||
        p.author?.toLowerCase().includes(term),
    );
  }, [data?.plugins, search]);

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        读取插件商店失败：{error.message}
      </p>
    );
  }

  return (
    <>
      {sourceErrors.map((s) => (
        <p key={s.id} role="alert" className="mb-2 text-sm text-destructive">
          商店源 {s.name || s.id} 读取失败：{s.error}
        </p>
      ))}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">插件会以宿主进程二进制形式运行，请仅从受信任的来源安装。</p>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索插件名称、描述或 ID..."
          className="w-56 sm:w-64"
        />
      </div>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : plugins.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          {search.trim() ? "未找到符合搜索条件的插件" : "商店里没有插件"}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => (
            <Card
              key={p.store_id}
              className="flex flex-col justify-between transition-colors hover:border-foreground/20"
            >
              <CardHeader className="pb-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <CardTitle className="truncate text-base font-semibold" title={p.name || p.id}>
                        {p.name || p.id}
                      </CardTitle>
                      {p.installed && !p.update_available && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          已安装
                        </Badge>
                      )}
                      {p.update_available && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                          可更新
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground truncate" title={p.id}>
                      {p.id}
                      {p.author && <span> · {p.author}</span>}
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 pb-3 text-sm text-muted-foreground">
                <p className="line-clamp-3 leading-relaxed whitespace-pre-wrap break-words text-xs sm:text-sm">
                  {p.description || "暂无描述"}
                </p>
              </CardContent>

              <CardFooter className="flex items-center justify-between border-t bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
                <div className="flex flex-col gap-0.5">
                  <span className="truncate max-w-[120px]" title={p.source_name || p.source_id}>
                    {p.source_name || p.source_id}
                  </span>
                  <span className="font-mono text-[11px]">
                    {p.installed && p.installed_version && p.installed_version !== p.version
                      ? `${p.installed_version} → ${p.version}`
                      : `v${p.version || "0.0.0"}`}
                  </span>
                </div>

                <div>
                  {p.installed && !p.update_available ? (
                    <Button size="sm" variant="ghost" disabled className="h-8 text-xs text-muted-foreground">
                      已安装
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={p.update_available ? "default" : "outline"}
                      disabled={install.isPending}
                      onClick={() => setInstallingTarget(p)}
                    >
                      {install.isPending && install.variables?.store_id === p.store_id ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {p.update_available ? "更新" : "安装"}
                    </Button>
                  )}
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={installingTarget !== null} onOpenChange={(open) => !open && setInstallingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5 shrink-0" />
              <AlertDialogTitle>插件安装安全风险确认</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-3 pt-2 text-sm leading-relaxed">
              <p>
                您准备安装/更新插件：<strong>「{installingTarget?.name || installingTarget?.id}」</strong>（版本：
                {installingTarget?.version || "未知"}，来源：
                {installingTarget?.source_name || installingTarget?.source_id}）。
              </p>
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-foreground/90 space-y-1.5">
                <p className="font-semibold text-destructive">安全风险提示：</p>
                <p className="text-muted-foreground">
                  CPA 插件以本地动态链接库或二进制进程的形式执行，与 CPA
                  拥有完全相同的系统权限，能够直接读取环境变量、所有账号认证密钥、请求报文并可发起任意网络通信。
                </p>
              </div>
              <p className="text-xs text-muted-foreground font-medium">
                请务必确保您完全信任该插件及其来源。是否确认继续安装？
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={install.isPending}
              onClick={() => {
                if (installingTarget) install.mutate(installingTarget);
              }}
            >
              {install.isPending && <Spinner />}
              信任并安装
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function PluginsPage() {
  return (
    <>
      <PageHeader title="插件" />
      <Tabs defaultValue="installed">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="installed">已安装</TabsTrigger>
          <TabsTrigger value="store">插件商店</TabsTrigger>
        </TabsList>
        <TabsContent value="installed">
          <Installed />
        </TabsContent>
        <TabsContent value="store">
          <Store />
        </TabsContent>
      </Tabs>
    </>
  );
}
