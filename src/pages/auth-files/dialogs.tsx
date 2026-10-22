import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Braces, Cable, Check, Copy, ExternalLink } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExcludedModelsEditor } from "@/components/excluded-models-editor";
import { HeadersEditor } from "@/components/headers-editor";
import { ModelAliasesEditor } from "@/components/model-aliases-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopiedState } from "@/hooks/use-copied-state";
import { useI18n } from "@/i18n/context";
import { api, errorText } from "@/lib/api";
import { diffFields, type Fields, NUMBER_FIELDS, readFields } from "@/lib/auth-file-fields";
import { accountName, CREDENTIALS_KEY } from "@/lib/credentials";
import { formatDateTime } from "@/lib/format";
import { type AuthFile, authState } from "@/lib/types";
import { contentQuery, file } from "./shared";

export function StatusCell({ file: f }: { file: AuthFile }) {
  const { t } = useI18n();
  const state = authState(f);
  if (state === "disabled") return <Badge variant="outline">{t("auth_files.status_disabled")}</Badge>;

  if (state === "cooldown" && f.cooldowns) {
    const credWide = f.cooldowns.some((c) => c.scope === "credential");
    const modelCount = f.cooldowns.filter((c) => c.scope === "model").length;
    const earliestSec = Math.min(...f.cooldowns.map((c) => c.remaining_seconds || 0));
    const title = f.cooldowns
      .map(
        (c) =>
          `${c.scope === "credential" ? t("auth_files.scope_credential") : c.model_key}: ${t(`auth_files.cooldown_reasons.${c.reason}`, { defaultValue: c.reason })} (${t("auth_files.remaining_seconds", { seconds: c.remaining_seconds })})`,
      )
      .join("\n");

    return (
      <span className="grid gap-0.5" title={title}>
        <Badge variant="destructive" className="w-fit">
          {credWide ? t("auth_files.scope_credential") : t("auth_files.models_count", { count: modelCount })}
        </Badge>
        {earliestSec > 0 && <span className="text-xs text-muted-foreground">~{earliestSec}s</span>}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="grid gap-0.5" title={f.status_message}>
        <Badge variant="destructive" className="w-fit">
          {t("auth_files.status_auth_error")}
        </Badge>
        {f.status_message && (
          <span className="max-w-48 truncate text-xs text-muted-foreground">{f.status_message}</span>
        )}
      </span>
    );
  }
  if (f.status === "pending" || f.status === "refreshing") {
    return (
      <Badge variant="secondary" title={f.status_message}>
        {f.status}
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      {t("auth_files.status_normal")}
    </span>
  );
}

export function ModelsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "auth-file-models", target.name],
    queryFn: () =>
      api<{ models?: { id: string; display_name?: string; owned_by?: string }[] }>(
        `/v8/management/credentials/models?name=${file(target.name)}`,
      ),
    select: (res) => res.models ?? [],
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("auth_files.available_models_title", { name: accountName(target) })}</DialogTitle>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-48" />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("overview.load_failed", { message: errorText(error) })}
          </p>
        ) : data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("auth_files.no_models")}</p>
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

export function FieldsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const source = useQuery({ ...contentQuery(target), select: readFields });
  const [draft, setDraft] = useState<Fields | null>(null);
  const form = draft ?? source.data;
  const [tab, setTab] = useState<"connection" | "models" | "headers">("connection");
  const scrollRef = useRef<HTMLDivElement>(null);

  const save = useMutation({
    // 服务端先按 ID 查找,同一文件展开的多个凭据用 ID 才能定位到这一个
    mutationFn: (patch: Record<string, unknown>) =>
      api("/v8/management/credentials/fields", { method: "PATCH", body: { name: target.id, ...patch } }),
    onSuccess: () => {
      toast.success(t("auth_files.saved"));
      queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
      queryClient.invalidateQueries({ queryKey: ["cpa", "auth-file-content", target.name] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || !source.data) return;
    const invalid = NUMBER_FIELDS.find(([key]) => form[key].trim() && !/^-?\d+$/.test(form[key].trim()));
    if (invalid) {
      toast.error(t("auth_files.integer_required", { field: t(invalid[1]) }));
      return;
    }
    const patch = diffFields(source.data, form);
    if (Object.keys(patch).length === 0) onClose();
    else save.mutate(patch);
  }

  const update = (patch: Partial<Fields>) => form && setDraft({ ...form, ...patch });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 固定高度：切换页签时内容高度不同，居中弹窗会上下跳动 */}
      <DialogContent className="flex h-[85svh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("auth_files.save_properties", { name: accountName(target) })}</DialogTitle>
        </DialogHeader>
        {source.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("overview.load_failed", { message: errorText(source.error) })}
          </p>
        ) : !form ? (
          <Skeleton className="h-72" />
        ) : (
          <form id="fields-form" onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3">
            <Tabs
              value={tab}
              onValueChange={(value) => {
                if (!value) return;
                setTab(value as typeof tab);
                scrollRef.current?.scrollTo({ top: 0 });
              }}
              className="min-h-0 flex-1"
            >
              <TabsList className="self-start" aria-label={t("auth_files.tab_group_label")}>
                <TabsTrigger value="connection" className="gap-1.5">
                  <Cable className="size-3.5" />
                  {t("auth_files.tab_connection")}
                </TabsTrigger>
                <TabsTrigger value="models" className="gap-1.5">
                  <Boxes className="size-3.5" />
                  {t("auth_files.tab_models")}
                </TabsTrigger>
                <TabsTrigger value="headers" className="gap-1.5">
                  <Braces className="size-3.5" />
                  {t("auth_files.tab_headers")}
                </TabsTrigger>
              </TabsList>
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
                <TabsContent value="connection" className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="f-note">{t("auth_files.field_note")}</Label>
                      <Input id="f-note" value={form.note} onChange={(e) => update({ note: e.target.value })} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="f-prefix">{t("auth_files.field_prefix")}</Label>
                      <Input id="f-prefix" value={form.prefix} onChange={(e) => update({ prefix: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {NUMBER_FIELDS.map(([key, label]) => (
                      <div key={key} className="grid gap-1.5">
                        <Label htmlFor={`f-${key}`}>{t(label)}</Label>
                        <Input
                          id={`f-${key}`}
                          inputMode="numeric"
                          value={form[key]}
                          placeholder={t("auth_files.inherit_placeholder")}
                          onChange={(e) => update({ [key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="f-proxy">{t("auth_files.field_proxy")}</Label>
                      <Input
                        id="f-proxy"
                        value={form.proxy_url}
                        placeholder={t("auth_files.proxy_placeholder")}
                        onChange={(e) => update({ proxy_url: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="f-timezone">{t("auth_files.field_timezone")}</Label>
                      <Input
                        id="f-timezone"
                        value={form.timezone}
                        placeholder={t("auth_files.timezone_placeholder")}
                        onChange={(e) => update({ timezone: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">{t("auth_files.timezone_hint")}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="f-websockets">{t("auth_files.field_websockets")}</Label>
                    <Switch
                      id="f-websockets"
                      checked={form.websockets}
                      onCheckedChange={(checked) => update({ websockets: checked })}
                    />
                  </div>
                  {target.provider?.toLowerCase() === "codex" && (
                    <div className="grid gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="f-use-siwc">{t("auth_files.field_use_siwc")}</Label>
                        <Switch
                          id="f-use-siwc"
                          checked={form.use_siwc}
                          onCheckedChange={(checked) => update({ use_siwc: checked })}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{t("auth_files.field_use_siwc_hint")}</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="models" className="grid gap-4">
                  <ModelAliasesEditor
                    id="f-aliases"
                    value={form.model_aliases}
                    placeholder={t("auth_files.model_aliases_placeholder")}
                    onChange={(model_aliases) => update({ model_aliases })}
                    label={t("auth_files.field_model_aliases")}
                    hint={t("auth_files.model_aliases_hint")}
                  />
                  <ExcludedModelsEditor
                    id="f-excluded"
                    value={form.excluded_models}
                    placeholder={t("auth_files.excluded_models_placeholder")}
                    onChange={(excluded_models) => update({ excluded_models })}
                    label={t("auth_files.field_excluded_models")}
                    hint={t("auth_files.excluded_models_hint")}
                  />
                </TabsContent>
                <TabsContent value="headers" className="grid gap-4">
                  <HeadersEditor
                    id="f-headers"
                    value={form.headers}
                    onChange={(headers) => update({ headers })}
                    label={t("auth_files.extra_headers")}
                    hint={t("auth_files.headers_hint")}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="fields-form" disabled={!form || save.isPending}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VertexDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<File | null>(null);
  const [location, setLocation] = useState("us-central1");
  const importKey = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (picked) form.append("file", picked);
      if (location.trim()) form.append("location", location.trim());
      return api<{ project_id?: string }>("/v8/management/oauth/import?provider=vertex", {
        method: "POST",
        body: form,
        raw: true,
      });
    },
    onSuccess: (res) => {
      toast.success(t("auth_files.vertex_imported", { project: res.project_id ?? "" }));
      queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("auth_files.import_vertex_title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="v-file">{t("auth_files.service_account_key")}</Label>
            <Input
              id="v-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{t("auth_files.service_account_hint")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-location">{t("auth_files.region")}</Label>
            <Input id="v-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!picked || importKey.isPending} onClick={() => importKey.mutate()}>
            {importKey.isPending && <Spinner />}
            {t("auth_files.import_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DetailsDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  const content = useQuery(contentQuery(target));
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const prefix = text(content.data?.prefix);
  const proxyUrl = text(content.data?.proxy_url ?? content.data?.["proxy-url"]);
  const state = authState(target);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("auth_files.details_title", { name: accountName(target) })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
            <div>
              <span className="text-muted-foreground">{t("auth_files.file_name")}</span>
              <p className="font-mono font-medium">{target.name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("auth_files.provider_label")}</span>
              <p className="font-medium">{target.provider || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("auth_files.account_id")}</span>
              <p className="font-medium">{target.email || target.account || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("auth_files.auth_index")}</span>
              <p className="font-mono">{target.auth_index || "—"}</p>
            </div>
            {target.project_id && (
              <div>
                <span className="text-muted-foreground">{t("auth_files.project_id")}</span>
                <p className="font-mono">{target.project_id}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t("auth_files.status_label")}</span>
              <p className="font-medium">
                {state === "disabled"
                  ? t("auth_files.status_disabled")
                  : state === "cooldown"
                    ? t("overview.cooldown")
                    : state === "error"
                      ? t("auth_files.status_auth_error")
                      : target.status || t("auth_files.status_normal")}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("auth_files.last_refresh_label")}</span>
              <p>{target.last_refresh ? formatDateTime(Date.parse(target.last_refresh)) : "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t("auth_files.updated_at_label")}</span>
              <p>{target.updated_at ? formatDateTime(Date.parse(target.updated_at)) : "—"}</p>
            </div>
          </div>

          {target.provider?.toLowerCase() === "codex" && target.siwc_bind_supported !== undefined && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
              <div>
                <span className="text-muted-foreground">{t("auth_files.siwc_status")}</span>
                <p
                  className={`font-medium ${
                    target.siwc_status === "invalid"
                      ? "text-destructive"
                      : target.siwc_status === "valid"
                        ? "text-success"
                        : "text-muted-foreground"
                  }`}
                >
                  {target.siwc_status
                    ? t(`auth_files.siwc_status_${target.siwc_status}` as never)
                    : target.siwc_bound
                      ? t("auth_files.siwc_bound")
                      : t("auth_files.siwc_unbound")}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("auth_files.siwc_use")}</span>
                <p className="font-medium">{target.use_siwc ? t("auth_files.siwc_yes") : t("auth_files.siwc_no")}</p>
              </div>
              {target.siwc_bound !== undefined && (
                <div>
                  <span className="text-muted-foreground">{t("auth_files.siwc_binding")}</span>
                  <p className="font-medium">
                    {target.siwc_bound ? t("auth_files.siwc_bound") : t("auth_files.siwc_unbound")}
                  </p>
                </div>
              )}
              {target.siwc_expires_at && (
                <div>
                  <span className="text-muted-foreground">{t("auth_files.siwc_expires_at")}</span>
                  <p>{formatDateTime(Date.parse(target.siwc_expires_at))}</p>
                </div>
              )}
            </div>
          )}

          {target.cooldowns && target.cooldowns.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <span className="font-medium text-warning">
                {t("auth_files.cooldown_limit_title", { count: target.cooldowns.length })}
              </span>
              <div className="mt-2 grid gap-1.5">
                {target.cooldowns.map((c) => (
                  <div
                    key={`${c.scope}-${c.model_key ?? "cred"}-${c.reason}`}
                    className="flex items-center justify-between border-b pb-1 last:border-0 last:pb-0"
                  >
                    <div>
                      <span className="font-medium">
                        {c.scope === "credential" ? t("auth_files.scope_credential") : c.model_key}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        ({t(`auth_files.cooldown_reasons.${c.reason}`, { defaultValue: c.reason })})
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {t("auth_files.remaining_seconds", { seconds: c.remaining_seconds })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(prefix || proxyUrl || target.priority !== undefined || target.note) && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
              {prefix && (
                <div>
                  <span className="text-muted-foreground">{t("auth_files.routing_prefix")}</span>
                  <p className="font-mono">{prefix}</p>
                </div>
              )}
              {proxyUrl && (
                <div>
                  <span className="text-muted-foreground">{t("auth_files.proxy_url")}</span>
                  <p className="font-mono">{proxyUrl}</p>
                </div>
              )}
              {target.priority !== undefined && (
                <div>
                  <span className="text-muted-foreground">{t("auth_files.priority")}</span>
                  <p>{target.priority}</p>
                </div>
              )}
              {target.note && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("auth_files.note")}</span>
                  <p>{target.note}</p>
                </div>
              )}
            </div>
          )}

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
              {t("auth_files.view_raw_json")}
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
              {JSON.stringify(target, null, 2)}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SiwcSession = { url: string; state: string; flow?: string; expires_in?: number };

/**
 * SIWC 绑定：给已有 Codex 凭据追加一个独立的 Sign in with ChatGPT 凭据分区。
 * 授权后浏览器会跳到 127.0.0.1，远程部署时把地址栏里的完整回调 URL 粘回来提交。
 */
export function SiwcBindDialog({ target, onClose }: { target: AuthFile; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<(SiwcSession & { deadline?: number }) | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [now, setNow] = useState(Date.now);
  const { copied, mark } = useCopiedState(1500);
  const started = useRef(false);
  const expired = session?.deadline !== undefined && now >= session.deadline;

  const start = useMutation({
    mutationFn: () =>
      api<SiwcSession>("/v8/management/oauth/siwc/bind", {
        method: "POST",
        body: { name: target.name },
      }),
    onSuccess: (data) => {
      setNow(Date.now());
      setSession({ ...data, deadline: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined });
      setCallbackUrl("");
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate();
  }, [start]);

  useEffect(() => {
    if (!session?.deadline || expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.deadline, expired]);

  const status = useQuery({
    queryKey: ["siwc-status", session?.state],
    queryFn: () =>
      api<{ status: "wait" | "ok" | "error"; error?: string }>(
        `/v8/management/oauth/status?state=${encodeURIComponent(session?.state ?? "")}`,
      ),
    enabled: Boolean(session?.state) && !expired,
    refetchInterval: (query) => (query.state.data?.status === "wait" || !query.state.data ? 2000 : false),
    refetchOnWindowFocus: false,
  });

  const done = status.data?.status === "ok";
  const failed = status.data?.status === "error";

  useEffect(() => {
    if (!done) return;
    toast.success(t("auth_files.siwc_success"));
    queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
    onClose();
  }, [done, onClose, queryClient, t]);

  const submit = useMutation({
    mutationFn: () =>
      api("/v8/management/oauth/callback", {
        method: "POST",
        body: { provider: "codex", redirect_url: callbackUrl.trim() },
      }),
    onSuccess: () => toast.success(t("auth_files.siwc_callback_submitted")),
    onError: (error: Error) => toast.error(t("auth_files.siwc_callback_failed", { message: error.message })),
  });

  const cancel = useMutation({
    mutationFn: () =>
      api(`/v8/management/oauth/session?state=${encodeURIComponent(session?.state ?? "")}`, { method: "DELETE" }),
    onSettled: onClose,
  });

  const close = () => {
    if (session?.state && !done) cancel.mutate();
    else onClose();
  };

  const restart = () => {
    setSession(null);
    setCallbackUrl("");
    start.mutate();
  };

  const copyUrl = async () => {
    if (!session?.url) return;
    await navigator.clipboard.writeText(session.url);
    mark(session.url);
    toast.success(t("auth_files.siwc_copied"));
  };

  function submitCallback(event: FormEvent) {
    event.preventDefault();
    if (callbackUrl.trim()) submit.mutate();
  }

  const secondsLeft = session?.deadline ? Math.max(0, Math.ceil((session.deadline - now) / 1000)) : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{target.siwc_bound ? t("auth_files.siwc_rebind") : t("auth_files.siwc_bind")}</DialogTitle>
          <DialogDescription>{t("auth_files.siwc_desc")}</DialogDescription>
        </DialogHeader>

        {start.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t("auth_files.siwc_starting")}
          </p>
        ) : start.isError ? (
          <div className="grid justify-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {t("auth_files.siwc_start_failed", { message: errorText(start.error) })}
            </p>
            <Button variant="outline" size="sm" onClick={restart}>
              {t("auth_files.siwc_retry")}
            </Button>
          </div>
        ) : session ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" nativeButton={false} render={<a href={session.url} target="_blank" rel="noreferrer" />}>
                <ExternalLink />
                {t("auth_files.siwc_open")}
              </Button>
              <Button variant="outline" size="sm" onClick={copyUrl}>
                {copied ? <Check /> : <Copy />}
                {t("auth_files.siwc_copy_url")}
              </Button>
            </div>

            <form onSubmit={submitCallback} className="grid gap-2">
              <Label htmlFor="siwc-callback">{t("auth_files.siwc_callback_label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="siwc-callback"
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder={t("auth_files.siwc_callback_placeholder")}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!callbackUrl.trim() || submit.isPending}
                  className="shrink-0"
                >
                  {submit.isPending && <Spinner />}
                  {t("auth_files.siwc_submit_callback")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("auth_files.siwc_callback_hint")}</p>
            </form>

            <p
              role="status"
              className={
                failed || expired ? "text-sm text-destructive" : "flex items-center gap-2 text-sm text-muted-foreground"
              }
            >
              {failed ? (
                `${t("auth_files.siwc_failed")}${status.data?.error ?? t("auth_files.siwc_unknown_error")}`
              ) : expired ? (
                t("auth_files.siwc_expired")
              ) : (
                <>
                  <Spinner />
                  {t("auth_files.siwc_waiting")}
                  {session.deadline !== undefined && (
                    <span className="tabular-nums">
                      {t("auth_files.siwc_expires_in", {
                        time: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`,
                      })}
                    </span>
                  )}
                </>
              )}
            </p>

            {expired && (
              <Button variant="outline" size="sm" className="justify-self-start" onClick={restart}>
                {t("auth_files.siwc_retry")}
              </Button>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={cancel.isPending}>
            {cancel.isPending && <Spinner />}
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
