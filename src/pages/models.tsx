import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { Trans } from "react-i18next";
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
import { useI18n } from "@/i18n/context";
import { api } from "@/lib/api";

// OAuth 渠道名,与认证文件的 provider 一致
const CHANNELS = [
  "codex",
  "claude",
  "gemini-cli",
  "antigravity",
  "vertex",
  "aistudio",
  "kimi",
  "xai",
  "meta",
  "qwen",
  "iflow",
];
type Alias = { name: string; alias: string; fork?: boolean; "display-name"?: string; "force-mapping"?: boolean };
type AliasMap = Record<string, Alias[]>;
type CatalogModel = { id: string; display_name?: string; owned_by?: string; context_length?: number };

function useCatalog(channel: string) {
  return useQuery({
    queryKey: ["cpa", "model-definitions", channel],
    queryFn: () =>
      api<{ models?: CatalogModel[] }>(`/v8/management/routing/model-definitions/${encodeURIComponent(channel)}`),
    select: (res) => res.models ?? [],
    enabled: Boolean(channel),
    retry: false,
    staleTime: 10 * 60_000,
  });
}

function ChannelInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const { t } = useI18n();
  return (
    <>
      <Input
        id={id}
        list={`${id}-options`}
        value={value}
        onChange={(e) => onChange(e.target.value.trim().toLowerCase())}
        placeholder={t("models.channel_placeholder")}
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
  const { t } = useI18n();
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
      // v8: /config/oauth/model-alias/<channel>，数组整体替换或删除
      return clean.length
        ? api(`/v8/management/config/oauth/model-alias/${encodeURIComponent(channel)}`, { method: "PUT", body: clean })
        : api(`/v8/management/config/oauth/model-alias/${encodeURIComponent(channel)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success(t("models.alias_saved"));
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
          <DialogTitle>
            {initial ? t("models.edit_alias_title", { channel: initial }) : t("models.add_alias_title")}
          </DialogTitle>
        </DialogHeader>
        <form id={`${uid}-form`} onSubmit={submit} className="grid gap-4">
          {!initial && (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor={`${uid}-channel`}>{t("models.channel")}</Label>
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
              <span>{t("models.upstream_model")}</span>
              <span>{t("models.alias_name")}</span>
              <span>{t("models.display_name")}</span>
              <span title={t("models.fork_hint")}>{t("models.fork")}</span>
              <span title={t("models.force_mapping_hint")}>{t("models.force_mapping")}</span>
              <span className="w-8" />
            </div>
            {rows.map((r) => (
              <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto] sm:items-center">
                <Input
                  aria-label={t("models.upstream_model")}
                  list={`${uid}-models`}
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  className="font-mono"
                />
                <Input
                  aria-label={t("models.alias_name")}
                  value={r.alias}
                  onChange={(e) => update(r.key, { alias: e.target.value })}
                  className="font-mono"
                />
                <Input
                  aria-label={t("models.display_name")}
                  value={r["display-name"] ?? ""}
                  onChange={(e) => update(r.key, { "display-name": e.target.value })}
                />
                <Switch
                  aria-label={t("models.fork")}
                  className="justify-self-center"
                  checked={r.fork === true}
                  onCheckedChange={(v) => update(r.key, { fork: v })}
                />
                <Switch
                  aria-label={t("models.force_mapping")}
                  className="justify-self-center"
                  checked={r["force-mapping"] === true}
                  onCheckedChange={(v) => update(r.key, { "force-mapping": v })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("models.delete_row")}
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
              {t("models.add_row")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("models.alias_hint")}</p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${uid}-form`} disabled={!channel || save.isPending}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Aliases() {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ channel: string; aliases: Alias[] } | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "oauth-model-alias"],
    queryFn: () => api<AliasMap>("/v8/management/config/oauth/model-alias").catch(() => ({})),
    select: (res) => Object.entries(res ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("models.load_failed", { message: error.message })}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.desc_alias")}</p>
        <Button onClick={() => setEditing({ channel: "", aliases: [] })}>
          <Plus />
          {t("models.add_alias")}
        </Button>
      </div>
      {isPending ? (
        <Skeleton className="h-40" />
      ) : data.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {t("models.no_aliases")}
        </p>
      ) : (
        <div className="grid gap-8">
          {data.map(([channel, list]) => (
            <section key={channel} aria-label={channel}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-medium">{channel}</h3>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ channel, aliases: list })}>
                  <Pencil />
                  {t("common.edit")}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("models.th_alias")}</TableHead>
                    <TableHead>{t("models.upstream_model")}</TableHead>
                    <TableHead>{t("models.display_name")}</TableHead>
                    <TableHead>{t("models.th_options")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={`${a.name}-${a.alias}`}>
                      <TableCell className="font-mono text-sm">{a.alias}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{a.name}</TableCell>
                      <TableCell>{a["display-name"] || "—"}</TableCell>
                      <TableCell className="space-x-1.5">
                        {a.fork && <Badge variant="outline">{t("models.fork")}</Badge>}
                        {a["force-mapping"] && <Badge variant="outline">{t("models.force_mapping")}</Badge>}
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
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const uid = useId();
  const [provider, setProvider] = useState(initial);
  const [textMode, setTextMode] = useState(false);
  const [search, setSearch] = useState("");
  const [customInput, setCustomInput] = useState("");

  const [rules, setRules] = useState<string[]>(() => {
    return models.map((m) => m.trim()).filter(Boolean);
  });

  const catalog = useCatalog(provider);
  const upstreamModels = useMemo(() => {
    const list = catalog.data?.map((m) => m.id) ?? [];
    return [...new Set(list)].sort();
  }, [catalog.data]);

  const textValue = useMemo(() => rules.join("\n"), [rules]);

  const addRule = (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    if (!rules.includes(trimmed)) {
      setRules((prev) => [...prev, trimmed]);
    }
  };

  const removeRule = (pattern: string) => {
    setRules((prev) => prev.filter((r) => r !== pattern));
  };

  const toggleModel = (modelId: string) => {
    if (rules.includes(modelId)) {
      removeRule(modelId);
    } else {
      addRule(modelId);
    }
  };

  const handleExcludeAllUpstream = () => {
    const toAdd = upstreamModels.filter((m) => !rules.includes(m));
    if (toAdd.length > 0) {
      setRules((prev) => [...prev, ...toAdd]);
      toast.success(t("models.excluded_added", { count: toAdd.length }));
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const clean = rules.map((s) => s.trim()).filter(Boolean);
      // v8: /config/oauth/excluded-models/<provider>
      return clean.length
        ? api(`/v8/management/config/oauth/excluded-models/${encodeURIComponent(provider)}`, {
            method: "PUT",
            body: clean,
          })
        : api(`/v8/management/config/oauth/excluded-models/${encodeURIComponent(provider)}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success(t("models.excluded_saved"));
      queryClient.invalidateQueries({ queryKey: ["cpa", "oauth-excluded-models"] });
      onClose();
    },
  });

  const filteredUpstream = useMemo(() => {
    if (!search.trim()) return upstreamModels;
    const q = search.trim().toLowerCase();
    return upstreamModels.filter((m) => m.toLowerCase().includes(q));
  }, [upstreamModels, search]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initial ? t("models.edit_excluded_title", { channel: initial }) : t("models.add_excluded_title")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {!initial && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${uid}-provider`}>{t("models.channel")}</Label>
              <ChannelInput id={`${uid}-provider`} value={provider} onChange={setProvider} />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <div>
              <Label className="text-sm font-medium">{t("models.rules_label")}</Label>
              <p className="text-xs text-muted-foreground">{t("models.rules_hint")}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!provider || catalog.isFetching}
                onClick={() => catalog.refetch()}
              >
                {catalog.isFetching ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
                {upstreamModels.length > 0
                  ? t("models.upstream_count", { count: upstreamModels.length })
                  : t("models.fetch_models")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setTextMode((prev) => !prev)}
              >
                {textMode ? t("models.visual_mode") : t("models.text_mode")}
              </Button>
            </div>
          </div>

          {textMode ? (
            <div className="grid gap-1.5">
              <Textarea
                id={`${uid}-models`}
                value={textValue}
                onChange={(e) => {
                  const val = e.target.value;
                  setRules(
                    val
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  );
                }}
                className="min-h-56 font-mono text-xs leading-relaxed"
                placeholder={"gpt-5-codex-mini\n*-mini\nclaude-3-haiku*"}
              />
              <p className="text-xs text-muted-foreground">{t("models.rules_text_hint")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {t("models.rules_count", { count: rules.length })}
                  </span>
                  {rules.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRules([])}
                      className="text-xs text-destructive hover:underline cursor-pointer"
                    >
                      {t("models.clear_all")}
                    </button>
                  )}
                </div>

                {rules.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    {t("models.no_rules")}
                  </div>
                ) : (
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2.5">
                    {rules.map((rule) => (
                      <span
                        key={rule}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive"
                      >
                        <span>{rule}</span>
                        <button
                          type="button"
                          onClick={() => removeRule(rule)}
                          className="hover:opacity-75 cursor-pointer"
                          aria-label={t("models.remove_rule_aria", { rule })}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRule(customInput);
                      setCustomInput("");
                    }
                  }}
                  placeholder={t("models.custom_rule_placeholder")}
                  className="h-8 text-xs font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => {
                    addRule(customInput);
                    setCustomInput("");
                  }}
                  disabled={!customInput.trim()}
                >
                  <Plus className="size-3" />
                  {t("common.add")}
                </Button>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-muted-foreground">
                    {t("models.candidates", { count: upstreamModels.length })}
                  </span>
                  {upstreamModels.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExcludeAllUpstream}
                      className="text-xs text-primary hover:underline cursor-pointer"
                    >
                      {t("models.exclude_all")}
                    </button>
                  )}
                </div>

                {catalog.isPending ? (
                  <Skeleton className="h-24 w-full" />
                ) : upstreamModels.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                    {t("models.no_catalog")}
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("models.filter_candidates")}
                        className="h-7 pl-7 text-xs font-mono"
                      />
                    </div>

                    <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-lg border p-2.5">
                      {filteredUpstream.length === 0 ? (
                        <p className="w-full text-center text-xs text-muted-foreground py-2">{t("models.no_match")}</p>
                      ) : (
                        filteredUpstream.map((m) => {
                          const isExcluded = rules.includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => toggleModel(m)}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs transition-colors cursor-pointer border ${
                                isExcluded
                                  ? "border-destructive/40 bg-destructive/15 text-destructive font-medium"
                                  : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
                              }`}
                              title={isExcluded ? t("models.click_unexclude") : t("models.click_exclude")}
                            >
                              <span>{m}</span>
                              {isExcluded ? (
                                <X className="size-3 text-destructive" />
                              ) : (
                                <Plus className="size-3 opacity-60" />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!provider || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Excluded() {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ provider: string; models: string[] } | null>(null);
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["cpa", "oauth-excluded-models"],
    queryFn: () => api<Record<string, string[]>>("/v8/management/config/oauth/excluded-models").catch(() => ({})),
    select: (res) => Object.entries(res ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("models.load_failed", { message: error.message })}
      </p>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.desc_excluded")}</p>
        <Button onClick={() => setEditing({ provider: "", models: [] })}>
          <Plus />
          {t("models.add_excluded")}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">{t("models.th_channel")}</TableHead>
            <TableHead>{t("models.excluded")}</TableHead>
            <TableHead className="w-16">
              <span className="sr-only">{t("common.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>{t("models.no_excluded")}</EmptyRow>
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
                    aria-label={t("models.edit_aria", { name: provider })}
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
  const { t } = useI18n();
  const [channel, setChannel] = useState(CHANNELS[0]);
  const { data, isPending, isError, error } = useCatalog(channel);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.catalog_hint")}</p>
        <Select
          items={CHANNELS.map((c) => ({ value: c, label: c }))}
          value={channel}
          onValueChange={(v) => v && setChannel(v)}
        >
          <SelectTrigger className="w-44" aria-label={t("models.select_channel")}>
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
            <TableHead>{t("models.th_model")}</TableHead>
            <TableHead>{t("models.display_name")}</TableHead>
            <TableHead>{t("models.th_owner")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : isError ? (
            <EmptyRow columns={3}>{t("models.catalog_error", { message: error.message })}</EmptyRow>
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>{t("models.no_models")}</EmptyRow>
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

type V1Model = { id: string };

const byName = new Intl.Collator(undefined, { numeric: true }).compare;

function AvailableModels() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // /v1/models 按模型 ID 去重,owned_by 只是其中一个提供方,所以只列模型名
  const { data, isPending, isError, error, isRefetching } = useQuery({
    queryKey: ["cpa", "v1-models"],
    queryFn: async () => {
      const res = await api<{ data?: V1Model[]; models?: V1Model[] } | V1Model[]>("/v1/models");
      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.models)
            ? res.models
            : [];
      return list.map((m) => m.id).sort(byName);
    },
    staleTime: 60_000,
  });

  const models = useMemo(() => {
    const term = search.toLowerCase().trim();
    return term ? (data ?? []).filter((id) => id.toLowerCase().includes(term)) : (data ?? []);
  }, [data, search]);

  const copy = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(id);
      toast.success(t("models.copied_model", { id }));
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["cpa", "v1-models"] });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="models.available_hint"
              components={{ code: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" /> }}
            />
          </p>
          {data && (
            <Badge variant="secondary" className="tabular-nums">
              {t("models.total_models", { count: data.length })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("models.search")}
            aria-label={t("models.search")}
            className="w-48 sm:w-64"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={isPending || isRefetching}
            aria-label={t("common.refresh")}
          >
            {isPending || isRefetching ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-40" />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("models.fetch_failed", { message: error.message })}
        </p>
      ) : models.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {search.trim() ? t("models.no_matching_models") : t("models.no_available")}
        </p>
      ) : (
        <ul className="columns-xs gap-x-6">
          {models.map((id) => (
            <li key={id} className="break-inside-avoid">
              <Button
                variant="ghost"
                title={id}
                aria-label={t("models.copy_aria", { id })}
                onClick={() => copy(id)}
                className="w-full justify-between font-mono font-normal"
              >
                <span className="truncate">{id}</span>
                {copied === id ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ModelsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("models.title")} description={t("models.desc")} />
      <Tabs defaultValue="available">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="available">{t("models.tab_available")}</TabsTrigger>
          <TabsTrigger value="alias">{t("models.tab_alias")}</TabsTrigger>
          <TabsTrigger value="excluded">{t("models.tab_excluded")}</TabsTrigger>
          <TabsTrigger value="catalog">{t("models.tab_catalog")}</TabsTrigger>
        </TabsList>
        <TabsContent value="available">
          <AvailableModels />
        </TabsContent>
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
