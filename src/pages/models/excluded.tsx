import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ModeTabs } from "@/components/dual-mode-field";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n/context";
import { api, CONFIG_KEY, configPath, configQuery, errorText, orNotFound } from "@/lib/api";
import { ALIAS_CHANNELS, EXCLUDED_VISIBLE, oauthOf, SuggestInput, useCatalog } from "./shared";

// ---------- 排除模型 ----------

export function ExcludedDialog({
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

export function Excluded() {
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    {models.slice(0, EXCLUDED_VISIBLE).map((m) => (
                      <Badge key={m} variant="secondary" className="font-mono">
                        {m}
                      </Badge>
                    ))}
                    {models.length > EXCLUDED_VISIBLE && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Badge variant="outline" className="cursor-help font-mono">
                              +{models.length - EXCLUDED_VISIBLE}
                            </Badge>
                          }
                        />
                        <TooltipContent side="top" className="max-w-md">
                          <div className="flex max-h-64 flex-wrap gap-1 overflow-auto">
                            {models.slice(EXCLUDED_VISIBLE).map((m) => (
                              <Badge key={m} variant="secondary" className="font-mono">
                                {m}
                              </Badge>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
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
