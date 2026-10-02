import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { Trans } from "react-i18next";
import { toast } from "sonner";
import { ModeTabs } from "@/components/dual-mode-field";
import { PageHeader } from "@/components/page-header";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound } from "@/lib/api";

// 静态模型目录支持的渠道(routing/model-definitions/:channel),别名 kimi.ai / x-ai 等由 CPA 内部归一
const CHANNELS = [
  "codex",
  "claude",
  "gemini",
  "gemini-interactions",
  "antigravity",
  "vertex",
  "aistudio",
  "kimi",
  "xai",
  "devin",
  "meta",
];
// OAuth 别名/排除的渠道:与 CPA 的 OAuthModelAliasChannel 一致,gemini 系列只走 API Key,
// kimi-ai 凭据的渠道是 kimi-ai 而不是 kimi;插件 OAuth 提供商用其 provider key,故允许自由输入
const ALIAS_CHANNELS = [
  "claude",
  "codex",
  "antigravity",
  "vertex",
  "aistudio",
  "kimi",
  "kimi-ai",
  "xai",
  "meta",
  "devin",
];
type OAuthConfig = { "model-alias"?: Record<string, Alias[]>; "excluded-models"?: Record<string, string[]> };
const oauthOf = (c: Record<string, unknown>) => (c.oauth ?? {}) as OAuthConfig;
type Alias = { name: string; alias: string; fork?: boolean; "display-name"?: string; "force-mapping"?: boolean };
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

/**
 * 可输入的单选下拉。值不在候选里时按输入内容生效 —— 渠道名和上游模型名都需要
 * 「既能选、也能自己填」的语义。用站内的 Combobox 而不是原生 <datalist>，
 * 样式与提供商页的模型选择保持一致。
 */
function SuggestInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <Combobox
      autoHighlight
      items={options}
      // 默认过滤不去空格，粘贴的模型名常带尾随空格
      filter={(item: string, query: string) => item.toLowerCase().includes(query.trim().toLowerCase())}
      value={value || null}
      onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
      inputValue={value}
      onInputValueChange={(next) => onChange(next)}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="w-full"
        onKeyDown={(e) => {
          // 没有高亮项时回车会提交外层表单
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
        }}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t("models.combobox_empty")}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item} className="font-mono text-xs">
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ---------- 模型别名 ----------

type Row = Alias & { key: number };

/**
 * 别名行的字段包装。窄屏下每个字段自带标签（否则只剩三个光秃秃的输入框），
 * 宽屏用 `sm:contents` 让包装层不生成盒子，字段重新成为行网格的直接子项，布局与之前完全一致。
 */
function AliasField({
  label,
  inline = false,
  children,
}: {
  label: string;
  /** 窄屏下标签与控件同一行（开关用），否则标签在上 */
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={inline ? "flex items-center justify-between gap-2 sm:contents" : "grid gap-1 sm:contents"}>
      <span className="text-xs text-muted-foreground sm:hidden">{label}</span>
      {children}
    </div>
  );
}

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
      // v8: /config/oauth/model-alias/<channel>，数组整体替换;清空时删除,本就不存在也算成功
      const path = configPath("oauth", "model-alias", channel);
      return clean.length
        ? api(path, { method: "PUT", body: clean })
        : api(path, { method: "DELETE" }).catch(orNotFound(null));
    },
    onSuccess: () => {
      toast.success(t("models.alias_saved"));
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
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
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor={`${uid}-channel`}>{t("models.channel")}</Label>
              <SuggestInput
                id={`${uid}-channel`}
                value={channel}
                onChange={(v) => setChannel(v.trim().toLowerCase())}
                options={ALIAS_CHANNELS}
                placeholder={t("models.channel_placeholder")}
              />
            </div>
          )}
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
              <div
                key={r.key}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto_auto] sm:items-center sm:rounded-none sm:border-0 sm:p-0"
              >
                <AliasField label={t("models.upstream_model")}>
                  <SuggestInput
                    id={`${uid}-model-${r.key}`}
                    ariaLabel={t("models.upstream_model")}
                    value={r.name}
                    onChange={(v) => update(r.key, { name: v })}
                    options={(catalog.data ?? []).map((m) => m.id)}
                  />
                </AliasField>
                <AliasField label={t("models.alias_name")}>
                  <Input
                    aria-label={t("models.alias_name")}
                    value={r.alias}
                    onChange={(e) => update(r.key, { alias: e.target.value })}
                    className="font-mono"
                  />
                </AliasField>
                <AliasField label={t("models.display_name")}>
                  <Input
                    aria-label={t("models.display_name")}
                    value={r["display-name"] ?? ""}
                    onChange={(e) => update(r.key, { "display-name": e.target.value })}
                  />
                </AliasField>
                <AliasField label={t("models.fork")} inline>
                  <Switch
                    aria-label={t("models.fork")}
                    className="justify-self-center"
                    checked={r.fork === true}
                    onCheckedChange={(v) => update(r.key, { fork: v })}
                  />
                </AliasField>
                <AliasField label={t("models.force_mapping")} inline>
                  <Switch
                    aria-label={t("models.force_mapping")}
                    className="justify-self-center"
                    checked={r["force-mapping"] === true}
                    onCheckedChange={(v) => update(r.key, { "force-mapping": v })}
                  />
                </AliasField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="justify-self-end"
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
    ...configQuery,
    select: (c) => Object.entries(oauthOf(c)["model-alias"] ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("models.load_failed", { message: errorText(error) })}
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
                    <TableHead className="hidden sm:table-cell">{t("models.upstream_model")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("models.display_name")}</TableHead>
                    <TableHead className="w-16">{t("models.th_options")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={`${a.name}-${a.alias}`}>
                      {/*
                        四列都带 whitespace-nowrap，窄屏按内容算约 700px，必然横向滚动。
                        这里把上游模型与显示名称折到别名下方，窄屏只留一列主字段。
                      */}
                      <TableCell className="font-mono text-sm">
                        <span className="block">{a.alias}</span>
                        <span className="mt-0.5 block font-sans text-xs font-normal break-all whitespace-normal text-muted-foreground sm:hidden">
                          {[a.name, a["display-name"]].filter(Boolean).join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-sm text-muted-foreground sm:table-cell">
                        {a.name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{a["display-name"] || "—"}</TableCell>
                      <TableCell>
                        {/* 窄屏两个徽章竖排，横向省出一列宽度 */}
                        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                          {a.fork && <Badge variant="outline">{t("models.fork")}</Badge>}
                          {a["force-mapping"] && <Badge variant="outline">{t("models.force_mapping")}</Badge>}
                        </div>
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
      const path = configPath("oauth", "excluded-models", provider);
      return clean.length
        ? api(path, { method: "PUT", body: clean })
        : api(path, { method: "DELETE" }).catch(orNotFound(null));
    },
    onSuccess: () => {
      toast.success(t("models.excluded_saved"));
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
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
              <SuggestInput
                id={`${uid}-provider`}
                value={provider}
                onChange={(v) => setProvider(v.trim().toLowerCase())}
                options={ALIAS_CHANNELS}
                placeholder={t("models.channel_placeholder")}
              />
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
              <ModeTabs mode={textMode ? "text" : "visual"} onChange={(mode) => setTextMode(mode === "text")} />
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
    ...configQuery,
    select: (c) => Object.entries(oauthOf(c)["excluded-models"] ?? {}).filter(([, list]) => list?.length),
  });

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("models.load_failed", { message: errorText(error) })}
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
            <TableHead className="hidden sm:table-cell">{t("models.display_name")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("models.th_owner")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={3} />
          ) : isError ? (
            <EmptyRow columns={3}>{t("models.catalog_error", { message: errorText(error) })}</EmptyRow>
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>{t("models.no_models")}</EmptyRow>
          ) : (
            data.map((m) => (
              <TableRow key={m.id}>
                {/* 模型 ID 本身可能很长，窄屏把显示名称与提供方折到它下面，避免整表横向滚动 */}
                <TableCell className="font-mono text-sm">
                  <span className="block break-all whitespace-normal">{m.id}</span>
                  <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground sm:hidden">
                    {[m.display_name, m.owned_by].filter(Boolean).join(" · ")}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{m.display_name || "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{m.owned_by || "—"}</TableCell>
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

  // /v1/models 要客户端密钥,取第一个 access.api-keys;没有就不带(服务端未开启鉴权时仍可访问)
  const clientKey = useQuery({
    ...configQuery,
    select: (c) => (c.access as { "api-keys"?: string[] } | undefined)?.["api-keys"]?.[0] ?? "",
  });
  // /v1/models 按模型 ID 去重,owned_by 只是其中一个提供方,所以只列模型名
  const { data, isPending, isError, error, isRefetching } = useQuery({
    queryKey: ["cpa", "v1-models", clientKey.data],
    enabled: !clientKey.isPending,
    queryFn: async () => {
      const res = await api<{ data?: V1Model[]; models?: V1Model[] } | V1Model[]>("/v1/models", {
        headers: clientKey.data ? { Authorization: `Bearer ${clientKey.data}` } : undefined,
      });
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
          {t("models.fetch_failed", { message: errorText(error) })}
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
