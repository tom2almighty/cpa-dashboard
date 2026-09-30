import { SiGithub } from "@icons-pack/react-simple-icons";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Download,
  ExternalLink,
  Gauge,
  Globe,
  Puzzle,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { PageHeader } from "@/components/page-header";
import { Pagination, paginate } from "@/components/pagination";
import { PluginQuotaDialog } from "@/components/plugin-quota-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { i18n, useI18n } from "@/i18n/context";
import { ApiError, api, CONFIG_KEY, configPath, configQuery, resolveUrl } from "@/lib/api";

type ConfigField = { name: string; type?: string; enum_values?: string[] | null; description?: string };

type PluginMenu = { path: string; menu?: string; description?: string };

type Plugin = {
  id: string;
  registered?: boolean;
  enabled?: boolean;
  effective_enabled?: boolean;
  supports_oauth?: boolean;
  oauth_provider?: string;
  supports_quota?: boolean;
  quota_provider?: string;
  logo?: string;
  config_fields?: ConfigField[] | null;
  menus?: PluginMenu[] | null;
  metadata?: {
    name?: string;
    version?: string;
    author?: string;
    github_repository?: string;
    logo?: string;
    config_fields?: ConfigField[] | null;
  };
};

// 插件资源页挂在 /v0/resource/plugins/<id>/ 下，结合 CPA 服务地址解析完整访问 URL
function resolvePluginMenuUrl(pluginId: string, path: string): string {
  const trimmed = path.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  let rawPath = trimmed;
  if (!rawPath.startsWith("/v0/resource/plugins/")) {
    rawPath = `/v0/resource/plugins/${encodeURIComponent(pluginId)}${rawPath.startsWith("/") ? "" : "/"}${rawPath}`;
  }
  return resolveUrl(rawPath);
}

function fieldsOf(p: Plugin): ConfigField[] {
  return (p.config_fields?.length ? p.config_fields : p.metadata?.config_fields) ?? [];
}

function kindOf(f: ConfigField): "bool" | "number" | "enum" | "json" | "text" {
  if (f.enum_values?.length) return "enum";
  const t = (f.type ?? "").toLowerCase();
  if (t.startsWith("bool")) return "bool";
  if (t === "array" || t === "object") return "json";
  if (/int|float|number|double/.test(t)) return "number";
  return "text";
}

// 表单里数字和 JSON 字段编辑时保留原文,保存时再转换校验
function toForm(fields: ConfigField[], config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const f of fields) {
    const v = config[f.name];
    if (v === undefined || v === null) continue;
    const kind = kindOf(f);
    if (kind === "number") out[f.name] = String(v);
    else if (kind === "json") out[f.name] = JSON.stringify(v, null, 2);
  }
  return out;
}

function fromForm(fields: ConfigField[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const f of fields) {
    const kind = kindOf(f);
    const raw = values[f.name];
    if ((kind !== "number" && kind !== "json") || typeof raw !== "string") continue;
    if (!raw.trim()) {
      delete out[f.name];
    } else if (kind === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || (/int/i.test(f.type ?? "") && !Number.isInteger(n)))
        throw new Error(i18n.t("plugins.field_invalid_number", { name: f.name }));
      out[f.name] = n;
    } else {
      try {
        out[f.name] = JSON.parse(raw);
      } catch {
        throw new Error(i18n.t("plugins.field_invalid_json", { name: f.name }));
      }
    }
  }
  return out;
}

// 409/429 按错误码给出可操作的提示
const ERROR_KEYS: Record<string, string> = {
  plugin_delete_requires_restart: "plugins.err_delete_requires_restart",
  plugin_update_requires_restart: "plugins.err_update_requires_restart",
  plugin_store_source_conflict: "plugins.err_source_conflict",
  plugin_store_installed_source_unknown: "plugins.err_installed_source_unknown",
  plugin_store_rate_limited: "plugins.err_rate_limited",
};

function errorText(error: Error): string {
  const key = error instanceof ApiError ? ERROR_KEYS[error.code] : undefined;
  return key ? i18n.t(key) : error.message;
}

type PluginsResponse = { plugins_enabled?: boolean; plugins_dir?: string; plugins?: Plugin[] };

type PluginPlatform = { goos?: string; goarch?: string };

type StorePlugin = {
  store_id: string;
  source_id: string;
  source_name?: string;
  id: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  repository?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  platforms?: PluginPlatform[];
  install_type?: string;
  auth_required?: boolean;
  auth_configured?: boolean;
  installed?: boolean;
  installed_version?: string;
  installed_source_id?: string;
  // different: 已从其它商店源安装;unknown: 无法确认安装来源
  install_source_status?: "matched" | "different" | "unknown" | "assumed";
  update_available?: boolean;
  logo?: string;
};

function resolvePluginAsset(value?: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  return resolveUrl(trimmed);
}

function PluginLogo({ src, name, size = "md" }: { src?: string; name: string; size?: "sm" | "md" | "lg" }) {
  const [error, setError] = useState(false);
  const resolved = useMemo(() => (src && !error ? resolvePluginAsset(src) : ""), [src, error]);
  const dim = size === "sm" ? "size-8 rounded-md" : size === "lg" ? "size-12 rounded-xl" : "size-10 rounded-lg";
  const iconSize = size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-5";

  if (resolved) {
    return (
      <div
        className={`relative flex items-center justify-center shrink-0 border bg-muted/30 p-1 overflow-hidden shadow-2xs ${dim}`}
      >
        <img src={resolved} alt={name} className="size-full object-contain" onError={() => setError(true)} />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center shrink-0 border bg-muted/40 text-muted-foreground ${dim}`}>
      <Puzzle className={iconSize} />
    </div>
  );
}

function formatRepoUrl(repo?: string, homepage?: string): string {
  const target = (repo || homepage || "").trim();
  if (!target) return "";
  if (/^https?:\/\//i.test(target)) return target;
  return `https://github.com/${target.replace(/^\/+/, "")}`;
}

function GithubIcon({ className = "size-3.5" }: { className?: string }) {
  return <SiGithub className={className} />;
}

type StoreResponse = {
  sources?: { id: string; name: string; url: string }[];
  source_errors?: { source_id: string; source_name: string; source_url: string; message: string }[];
  plugins?: StorePlugin[];
};

const PLUGINS_KEY = ["cpa", "plugins"];
const STORE_KEY = ["cpa", "plugin-store"];

// 服务端改完配置后异步重载插件,稍后再拉一次插件状态
function refreshPlugins(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
  queryClient.invalidateQueries({ queryKey: PLUGINS_KEY });
  setTimeout(() => queryClient.invalidateQueries({ queryKey: PLUGINS_KEY }), 1000);
}

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
  } else if (kind === "json") {
    control = (
      <Textarea
        id={id}
        rows={3}
        spellCheck={false}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.type === "array" ? "[]" : "{}"}
        className="font-mono text-xs"
      />
    );
  } else {
    control = (
      <Input
        id={id}
        inputMode={kind === "number" ? "decimal" : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        className={kind === "number" ? "w-32" : "w-full sm:w-72"}
      />
    );
  }
  return (
    <div
      className={`flex flex-col gap-2 py-3 ${kind === "json" ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className="font-mono text-sm">
          {field.name}
        </Label>
        {field.description && <p className="mt-0.5 text-sm text-muted-foreground">{field.description}</p>}
      </div>
      <div className={kind === "json" ? "" : "shrink-0"}>{control}</div>
    </div>
  );
}

function ConfigDialog({ plugin, onClose }: { plugin: Plugin; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const fields = fieldsOf(plugin);
  const [asJson, setAsJson] = useState(false);
  const useForm = fields.length > 0 && !asJson;
  // 没配置过的插件在 configs 下没有节点,按空对象编辑
  const { data, error } = useQuery({
    ...configQuery,
    select: (c) =>
      ((c.plugins as { configs?: Record<string, unknown> } | null)?.configs?.[plugin.id] ?? {}) as Record<
        string,
        unknown
      >,
  });
  useEffect(() => {
    if (!data) return;
    setDraft(JSON.stringify(data, null, 2));
    setValues(toForm(fieldsOf(plugin), data));
  }, [data, plugin]);

  const save = useMutation({
    mutationFn: () => {
      const value = useForm ? fromForm(fields, values) : (JSON.parse(draft) as unknown);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(t("plugins.config_must_be_object"));
      return api(configPath("plugins", "configs", plugin.id), { method: "PUT", body: value });
    },
    onSuccess: () => {
      toast.success(t("plugins.config_saved"));
      refreshPlugins(queryClient);
      onClose();
    },
  });

  function switchMode() {
    try {
      if (asJson) {
        const parsed = JSON.parse(draft) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error(t("plugins.config_must_be_object"));
        setValues(toForm(fields, parsed as Record<string, unknown>));
      } else {
        setDraft(JSON.stringify(fromForm(fields, values), null, 2));
      }
      setAsJson((v) => !v);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("plugins.config_title", { name: plugin.metadata?.name || plugin.id })}</DialogTitle>
        </DialogHeader>
        {fields.length > 0 && (
          <div className="flex justify-end">
            <Button variant="link" size="sm" className="h-auto p-0" onClick={switchMode}>
              {asJson ? t("plugins.edit_as_form") : t("plugins.edit_as_json")}
            </Button>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : !data ? (
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
            label={t("plugins.config_label")}
            language="json"
            height="20rem"
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate()}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={!data || save.isPending}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PluginViewerDialog({
  title,
  subtitle,
  url,
  onClose,
}: {
  title: string;
  subtitle?: string;
  url: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] max-h-[92vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-2.5 space-y-0">
          <div className="flex items-center gap-2 min-w-0 pr-4">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pr-6">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("plugins.reload_page")}
              aria-label={t("plugins.reload_page")}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("plugins.open_in_new_tab")}
              aria-label={t("plugins.open_in_new_tab")}
              render={
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                </a>
              }
            />
          </div>
        </DialogHeader>
        <div className="relative flex-1 bg-background">
          <iframe
            key={reloadKey}
            src={url}
            title={title}
            className="size-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Installed() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [configuring, setConfiguring] = useState<Plugin | null>(null);
  const [quotaPlugin, setQuotaPlugin] = useState<Plugin | null>(null);
  const [deleting, setDeleting] = useState<Plugin | null>(null);
  const [viewingResource, setViewingResource] = useState<{ title: string; subtitle?: string; url: string } | null>(
    null,
  );
  const { data, isPending, isError, error } = useQuery({
    queryKey: PLUGINS_KEY,
    queryFn: () => api<PluginsResponse>("/v8/management/plugins"),
  });

  const toggle = useMutation({
    mutationFn: (p: Plugin) =>
      api(configPath("plugins", "configs", p.id, "enabled"), { method: "PUT", body: !p.enabled }),
    onSuccess: () => refreshPlugins(queryClient),
  });

  const remove = useMutation({
    mutationFn: (p: Plugin) => api(`/v8/management/plugins/${encodeURIComponent(p.id)}`, { method: "DELETE" }),
    meta: { quiet: true },
    onSuccess: (_res, p) => {
      toast.success(t("plugins.deleted", { id: p.id }));
      setDeleting(null);
      refreshPlugins(queryClient);
    },
    onError: (e) => {
      toast.error(errorText(e));
      // 插件已加载删不掉,重试没用,关掉对话框
      if (e instanceof ApiError && e.code === "plugin_delete_requires_restart") setDeleting(null);
    },
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("plugins.load_failed", { message: error.message })}
      </p>
    );
  }

  return (
    <>
      {data?.plugins_enabled === false && (
        <p role="alert" className="mb-4 text-sm text-muted-foreground">
          {t("plugins.plugins_disabled")}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("plugins.th_plugin")}</TableHead>
            <TableHead>{t("plugins.th_version")}</TableHead>
            <TableHead>{t("plugins.th_status")}</TableHead>
            <TableHead className="w-24">{t("plugins.th_switch")}</TableHead>
            <TableHead className="w-24">
              <span className="sr-only">{t("plugins.th_actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={5} />
          ) : !data?.plugins?.length ? (
            <EmptyRow columns={5}>{t("plugins.empty_installed")}</EmptyRow>
          ) : (
            data.plugins.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <PluginLogo src={p.logo || p.metadata?.logo} name={p.metadata?.name || p.id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate">{p.metadata?.name || p.id}</div>
                        {p.supports_oauth && (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            OAuth
                          </Badge>
                        )}
                        {p.metadata?.github_repository && (
                          <a
                            href={
                              p.metadata.github_repository.startsWith("http")
                                ? p.metadata.github_repository
                                : `https://github.com/${p.metadata.github_repository}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            title={t("plugins.view_repo")}
                            aria-label={t("plugins.view_repo")}
                            className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <GithubIcon className="size-3.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.id}
                        {p.metadata?.author && ` · by ${p.metadata.author}`}
                      </div>
                    </div>
                  </div>
                  {p.effective_enabled && (p.menus?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.menus?.map((m) => {
                        const href = resolvePluginMenuUrl(p.id, m.path);
                        const label = m.menu || m.path;
                        return (
                          <div
                            key={m.path}
                            className="inline-flex items-center rounded-md border bg-muted/40 text-xs shadow-2xs hover:bg-muted"
                          >
                            <button
                              type="button"
                              className="flex items-center gap-1.5 px-2.5 py-1 text-left font-medium hover:text-primary cursor-pointer"
                              title={m.description || label}
                              onClick={() =>
                                setViewingResource({
                                  title: `${p.metadata?.name || p.id} - ${label}`,
                                  subtitle: m.description,
                                  url: href,
                                })
                              }
                            >
                              <Globe className="size-3 text-muted-foreground" />
                              <span>{label}</span>
                            </button>
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title={t("plugins.open_in_new_tab")}
                              aria-label={t("plugins.open_named_in_new_tab", { name: label })}
                              className="border-l p-1.5 text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{p.metadata?.version || "—"}</TableCell>
                <TableCell>
                  {p.effective_enabled ? (
                    <Badge variant="secondary">{t("plugins.status_running")}</Badge>
                  ) : p.registered ? (
                    <Badge variant="outline">{t("plugins.status_disabled")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("plugins.status_unloaded")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={p.enabled === true}
                    disabled={toggle.isPending && toggle.variables?.id === p.id}
                    onCheckedChange={() => toggle.mutate(p)}
                    aria-label={t(p.enabled ? "plugins.disable_named" : "plugins.enable_named", {
                      name: p.metadata?.name || p.id,
                    })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {p.effective_enabled && p.supports_quota && p.quota_provider && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("plugins.quota_named", { name: p.id })}
                      onClick={() => setQuotaPlugin(p)}
                    >
                      <Gauge />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("plugins.configure_named", { name: p.id })}
                    onClick={() => setConfiguring(p)}
                  >
                    <Settings2 />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("plugins.delete_named", { name: p.id })}
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
      {quotaPlugin?.quota_provider && (
        <PluginQuotaDialog
          pluginId={quotaPlugin.id}
          provider={quotaPlugin.quota_provider}
          title={t("plugins.quota_title", { name: quotaPlugin.metadata?.name || quotaPlugin.id })}
          onClose={() => setQuotaPlugin(null)}
        />
      )}
      {viewingResource && (
        <PluginViewerDialog
          title={viewingResource.title}
          subtitle={viewingResource.subtitle}
          url={viewingResource.url}
          onClose={() => setViewingResource(null)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("plugins.delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("plugins.delete_desc", { id: deleting?.id })}</AlertDialogDescription>
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

function Store() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [installingTarget, setInstallingTarget] = useState<StorePlugin | null>(null);
  const [customVersion, setCustomVersion] = useState("");
  const [page, setPage] = useState(1);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const { data, isPending, isError, error } = useQuery({
    queryKey: STORE_KEY,
    queryFn: () => api<StoreResponse>("/v8/management/plugins/store"),
    // 每次拉取服务端都会请求 GitHub,容易触发限流
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const install = useMutation({
    mutationFn: ({ plugin: p, version }: { plugin: StorePlugin; version?: string }) => {
      const body = version?.trim() ? { version: version.trim() } : {};
      return api<{ version?: string }>(
        `/v8/management/plugins/store/${encodeURIComponent(p.id)}/install?source=${encodeURIComponent(p.source_id)}`,
        { method: "POST", body },
      );
    },
    meta: { quiet: true },
    onSuccess: (res, { plugin: p }) => {
      toast.success(t("plugins.installed_toast", { name: p.name || p.id, version: res.version ?? "" }));
      queryClient.invalidateQueries({ queryKey: STORE_KEY });
      refreshPlugins(queryClient);
      setInstallingTarget(null);
      setCustomVersion("");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const sourceName = (id?: string) => data?.sources?.find((s) => s.id === id)?.name || id;
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
        {t("plugins.store_load_failed", { message: errorText(error) })}
      </p>
    );
  }

  return (
    <>
      {data?.source_errors?.map((s) => (
        <p key={s.source_id} role="alert" className="mb-2 text-sm text-destructive">
          {t("plugins.source_load_failed", { name: s.source_name || s.source_url || s.source_id, error: s.message })}
        </p>
      ))}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("plugins.store_hint")}</p>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("plugins.search_placeholder")}
          className="w-56 sm:w-80 text-xs"
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
          {search.trim() ? t("plugins.store_no_match") : t("plugins.store_empty")}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paginate(plugins, page, 9).pageItems.map((p) => {
              const repoUrl = formatRepoUrl(p.repository, p.homepage);
              const isOfficial = (p.repository || "").toLowerCase().includes("router-for-me/");
              const platformList = (p.platforms ?? [])
                .map((plat) => (plat.goos && plat.goarch ? `${plat.goos}/${plat.goarch}` : ""))
                .filter(Boolean);

              return (
                <Card
                  key={p.store_id}
                  className="flex flex-col justify-between transition-colors hover:border-foreground/20"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      <PluginLogo src={p.logo} name={p.name || p.id} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <CardTitle className="truncate text-base font-semibold" title={p.name || p.id}>
                            {p.name || p.id}
                          </CardTitle>
                          {p.installed && !p.update_available && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {t("plugins.badge_installed")}
                            </Badge>
                          )}
                          {p.update_available && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                              {t("plugins.badge_update_available")}
                            </Badge>
                          )}
                          {!isOfficial && p.repository && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-500/40 dark:text-amber-400"
                            >
                              {t("plugins.badge_third_party")}
                            </Badge>
                          )}
                          {p.auth_required && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">
                              {p.auth_configured
                                ? t("plugins.badge_auth_configured")
                                : t("plugins.badge_auth_required")}
                            </Badge>
                          )}
                        </div>
                        <div
                          className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground truncate"
                          title={p.id}
                        >
                          <span className="font-mono text-[11px]">{p.id}</span>
                          {p.author && (
                            <>
                              <span>·</span>
                              <span className="truncate">by {p.author}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {repoUrl && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            title={t("plugins.view_repo")}
                            aria-label={t("plugins.view_repo")}
                            render={
                              <a href={repoUrl} target="_blank" rel="noreferrer">
                                <GithubIcon className="size-3.5" />
                              </a>
                            }
                          />
                        )}
                        {p.homepage && !p.homepage.includes("github.com") && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-foreground"
                            title={t("plugins.view_homepage")}
                            aria-label={t("plugins.view_homepage")}
                            render={
                              <a href={p.homepage} target="_blank" rel="noreferrer">
                                <ExternalLink className="size-3.5" />
                              </a>
                            }
                          />
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="flex-1 space-y-2.5 pb-3 text-sm text-muted-foreground">
                    <p className="line-clamp-3 leading-relaxed whitespace-pre-wrap break-words text-xs sm:text-sm">
                      {p.description || t("plugins.no_description")}
                    </p>

                    {/* 标签列表 */}
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {p.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 规格明细：许可证、安装类型、系统平台 */}
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/80 pt-1">
                      {p.license && (
                        <span>{t("plugins.label_value", { label: t("plugins.license"), value: p.license })}</span>
                      )}
                      {p.install_type && (
                        <span>
                          {t("plugins.label_value", {
                            label: t("plugins.install_type"),
                            value: p.install_type.replace(/-/g, " "),
                          })}
                        </span>
                      )}
                      {platformList.length > 0 && (
                        <span title={platformList.join(", ")}>
                          {t("plugins.label_value", {
                            label: t("plugins.platforms"),
                            value: platformList.slice(0, 2).join(", "),
                          })}
                          {platformList.length > 2 && ` +${platformList.length - 2}`}
                        </span>
                      )}
                    </div>
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
                          {t("plugins.badge_installed")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={p.update_available ? "default" : "outline"}
                          disabled={install.isPending}
                          onClick={() => {
                            setInstallingTarget(p);
                            setCustomVersion(p.version || "");
                          }}
                        >
                          {install.isPending && install.variables?.plugin.store_id === p.store_id ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <Download className="size-3.5" />
                          )}
                          {p.update_available ? t("plugins.update") : t("plugins.install")}
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          <Pagination
            page={paginate(plugins, page, 9).current}
            pageCount={paginate(plugins, page, 9).pageCount}
            total={plugins.length}
            onChange={(nextPage) => {
              setPage(nextPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </>
      )}

      {showScrollTop && (
        <Button
          variant="outline"
          size="icon"
          aria-label={t("plugins.back_to_top")}
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-md bg-background/80 backdrop-blur transition-all"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="size-4" />
        </Button>
      )}

      <AlertDialog open={installingTarget !== null} onOpenChange={(open) => !open && setInstallingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5 shrink-0" />
              <AlertDialogTitle>{t("plugins.install_confirm_title")}</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-3 pt-2 text-sm leading-relaxed">
              <p>
                {t("plugins.install_confirm_target", {
                  name: installingTarget?.name || installingTarget?.id,
                  version: installingTarget?.version || t("plugins.version_unknown"),
                  source: installingTarget?.source_name || installingTarget?.source_id,
                })}
              </p>
              {(installingTarget?.install_source_status === "different" ||
                installingTarget?.install_source_status === "unknown") && (
                <p role="alert" className="text-amber-600 dark:text-amber-400">
                  {installingTarget.install_source_status === "different"
                    ? t("plugins.warn_source_different", { source: sourceName(installingTarget.installed_source_id) })
                    : t("plugins.warn_source_unknown")}
                </p>
              )}
              <div className="grid gap-1.5 pt-1">
                <Label htmlFor="plugin-version-input" className="text-xs text-muted-foreground">
                  {t("plugins.install_version_label")}
                </Label>
                <Input
                  id="plugin-version-input"
                  value={customVersion}
                  onChange={(e) => setCustomVersion(e.target.value)}
                  placeholder={t("plugins.install_version_placeholder")}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-foreground/90 space-y-1.5">
                <p className="font-semibold text-destructive">{t("plugins.security_risk_title")}</p>
                <p className="text-muted-foreground">{t("plugins.security_risk_desc")}</p>
              </div>
              <p className="text-xs text-muted-foreground font-medium">{t("plugins.install_confirm_question")}</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={install.isPending}
              onClick={() => {
                if (installingTarget) {
                  install.mutate({ plugin: installingTarget, version: customVersion });
                }
              }}
            >
              {install.isPending && <Spinner />}
              {t("plugins.trust_and_install")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function PluginsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("plugins.title")} description={t("plugins.desc")} />
      <Tabs defaultValue="installed">
        <TabsList className="mb-6">
          <TabsTrigger value="installed">{t("plugins.tab_installed")}</TabsTrigger>
          <TabsTrigger value="store">{t("plugins.tab_store")}</TabsTrigger>
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
