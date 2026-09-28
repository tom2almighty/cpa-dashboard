import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpDown, Clock, OctagonAlert, RefreshCw, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pagination, paginate } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { formatCountdown, formatDateTime, formatRelative } from "@/lib/format";
import { fetchQuota, type QuotaWindow, supportsQuota } from "@/lib/quota";
import type { AuthFile } from "@/lib/types";
export function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

// 内置渠道的显示名;插件提供的额度渠道直接显示 provider
const CHANNEL_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  devin: "Devin",
  kimi: "Kimi",
  meta: "Meta",
  xai: "xAI",
  antigravity: "Antigravity",
};

// 剩余不超过该百分比视为紧张,卡片、统计与"仅看告警"共用
const WARN_REMAINING = 20;

function level(remaining: number | null): "ok" | "warn" | "danger" {
  if (remaining === null) return "ok";
  if (remaining <= 0) return "danger";
  if (remaining <= WARN_REMAINING) return "warn";
  return "ok";
}

function MeterRow({ window: w }: { window: QuotaWindow }) {
  const { t } = useI18n();
  const remaining = w.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - Math.round(w.usedPercent)));
  const state = level(remaining);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex w-full min-w-0 items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-xs font-medium sm:text-sm" title={w.label}>
          {w.label}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-xs">
          {state === "danger" && <OctagonAlert className="size-3.5 text-destructive" aria-hidden />}
          {state === "warn" && <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />}
          <span
            className={
              state === "danger"
                ? "font-semibold text-destructive"
                : state === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : ""
            }
          >
            {remaining === null ? "—" : t("quota.remaining_percent", { n: remaining })}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("quota.remaining_aria", { label: w.label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining ?? undefined}
        className="relative h-2 w-full min-w-0 overflow-hidden rounded-full bg-primary/20"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${state === "danger" ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
      {(w.resetAt || w.detail) && (
        <div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span title={w.resetAt ? formatDateTime(w.resetAt) : undefined}>{formatCountdown(w.resetAt)}</span>
          {w.detail && <span className="tabular-nums">{w.detail}</span>}
        </div>
      )}
    </div>
  );
}

export function QuotaPanel({ files }: { files: AuthFile[] }) {
  const { t } = useI18n();
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<"lowest" | "earliest_reset" | "name">("lowest");
  const [warningOnly, setWarningOnly] = useState(false);
  // 页码跟筛选条件绑定,条件一变自动回到第一页
  const filterKey = `${selectedChannel}|${deferredSearch}|${sortMode}|${warningOnly}`;
  const [pager, setPager] = useState({ filterKey, page: 1 });
  const page = pager.filterKey === filterKey ? pager.page : 1;
  const setPage = (next: number) => setPager({ filterKey, page: next });

  // 防御性提取支持额度查询的活跃账号
  const targets = useMemo(() => {
    return (files ?? []).filter((f) => supportsQuota(f) && !f.disabled);
  }, [files]);

  const results = useQueries({
    queries: targets.map((file) => ({
      queryKey: ["quota", file.auth_index],
      queryFn: () => fetchQuota(file),
      staleTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const items = useMemo(() => {
    return targets.map((file, i) => {
      const q = results[i];
      const windows = q?.data?.windows ?? [];
      let minRemaining: number | null = null;
      let earliestReset: number | null = null;

      for (const w of windows) {
        if (w.usedPercent !== null) {
          const rem = Math.max(0, 100 - Math.round(w.usedPercent));
          if (minRemaining === null || rem < minRemaining) minRemaining = rem;
        }
        if (w.resetAt && w.resetAt > Date.now()) {
          if (earliestReset === null || w.resetAt < earliestReset) earliestReset = w.resetAt;
        }
      }

      return {
        file,
        name: accountName(file),
        provider: (file.provider ?? "").toLowerCase(),
        plan: q?.data?.plan ?? null,
        query: q,
        minRemaining,
        earliestReset,
      };
    });
  }, [targets, results]);

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const item of [...items].sort((a, b) => a.provider.localeCompare(b.provider))) {
      counts[item.provider] = (counts[item.provider] || 0) + 1;
    }
    return counts;
  }, [items]);

  const metrics = useMemo(() => {
    let healthy = 0;
    let warning = 0;
    let exhausted = 0;
    let failed = 0;

    for (const it of items) {
      if (it.query?.isError) failed++;
      else if (level(it.minRemaining) === "danger") exhausted++;
      else if (level(it.minRemaining) === "warn") warning++;
      else if (it.query?.isSuccess) healthy++;
    }
    return { total: items.length, healthy, warning, exhausted, failed };
  }, [items]);

  const upcomingResets = useMemo(() => {
    const list: {
      accountName: string;
      provider: string;
      label: string;
      resetAt: number;
      remaining: number;
    }[] = [];

    const now = Date.now();
    for (const it of items) {
      for (const w of it.query?.data?.windows ?? []) {
        const used = w.usedPercent !== null ? Math.round(w.usedPercent) : null;
        // 只关心紧张或用尽的窗口,充裕的窗口什么时候重置无所谓
        if (w.resetAt && w.resetAt > now && used !== null && level(100 - used) !== "ok") {
          list.push({
            accountName: it.name,
            provider: it.file.provider ?? "",
            label: w.label,
            resetAt: w.resetAt,
            remaining: Math.max(0, 100 - used),
          });
        }
      }
    }
    return list.sort((a, b) => a.resetAt - b.resetAt).slice(0, 6);
  }, [items]);

  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return items
      .filter((it) => {
        if (selectedChannel !== "all" && it.provider !== selectedChannel) return false;
        if (warningOnly && level(it.minRemaining) === "ok" && !it.query?.isError) return false;
        if (query) {
          const matchName = it.name.toLowerCase().includes(query);
          const matchProvider = (it.file.provider ?? "").toLowerCase().includes(query);
          const matchPlan = (it.plan ?? "").toLowerCase().includes(query);
          const matchId = (it.file.auth_index ?? "").toLowerCase().includes(query);
          if (!matchName && !matchProvider && !matchPlan && !matchId) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortMode === "lowest") {
          const remA = a.minRemaining ?? 999;
          const remB = b.minRemaining ?? 999;
          return remA - remB;
        }
        if (sortMode === "earliest_reset") {
          const resetA = a.earliestReset ?? Number.MAX_SAFE_INTEGER;
          const resetB = b.earliestReset ?? Number.MAX_SAFE_INTEGER;
          return resetA - resetB;
        }
        return a.name.localeCompare(b.name);
      });
  }, [items, selectedChannel, deferredSearch, sortMode, warningOnly]);

  const { pageItems, current, pageCount } = paginate(filtered, page, 12);
  const isRefreshingAll = results.some((r) => r?.isFetching);

  const handleRefreshAll = async () => {
    const done = await Promise.all(results.map((r) => r.refetch()));
    const failed = done.filter((r) => r.isError).length;
    if (failed) toast.error(t("quota.refresh_failed_count", { count: failed }));
    else toast.success(t("quota.refreshed"));
  };

  if (targets.length === 0) {
    return (
      <Card className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
        <p>{t("quota.no_target")}</p>
        <p className="mt-1 text-xs">{t("quota.channels_support")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("quota.total_prefix")} <strong className="font-semibold text-foreground">{metrics.total}</strong>{" "}
            {t("quota.total_suffix")}
          </span>
          <span className="flex items-center gap-1 text-primary font-medium">
            <span className="size-1.5 rounded-full bg-primary" />
            {metrics.healthy} {t("quota.healthy")}
          </span>
          {metrics.warning > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {metrics.warning} {t("quota.tight")}
            </span>
          )}
          {metrics.exhausted > 0 && (
            <span className="flex items-center gap-1 text-destructive font-medium">
              <span className="size-1.5 rounded-full bg-destructive" />
              {metrics.exhausted} {t("quota.exhausted")}
            </span>
          )}
          {metrics.failed > 0 && (
            <span className="flex items-center gap-1 font-medium">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {metrics.failed} {t("quota.query_failed_short")}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshAll}
          disabled={isRefreshingAll}
          className="h-8 text-xs"
        >
          <RefreshCw className={isRefreshingAll ? "animate-spin" : undefined} />
          {isRefreshingAll ? t("common.refreshing") : t("quota.refresh_all")}
        </Button>
      </div>

      {/* 卡片回答"还剩多少",这里回答"紧张的额度什么时候回来" */}
      {upcomingResets.length > 0 && (
        <section aria-label={t("quota.upcoming_resets")} className="rounded-lg border p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="size-3.5" />
            {t("quota.upcoming_resets")}
          </h3>
          <ul className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {upcomingResets.map((r) => (
              <li
                key={`${r.accountName}-${r.label}-${r.resetAt}`}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <span className="truncate" title={`${r.accountName} · ${r.label}`}>
                  {r.accountName}
                  <span className="text-muted-foreground"> · {r.label}</span>
                </span>
                <span className="shrink-0 tabular-nums" title={formatDateTime(r.resetAt)}>
                  <span className={r.remaining === 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
                    {t("quota.remaining_percent", { n: r.remaining })}
                  </span>
                  <span className="text-muted-foreground"> · {formatCountdown(r.resetAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={selectedChannel} onValueChange={setSelectedChannel} className="w-full sm:w-auto">
          <TabsList className="h-9 flex-wrap">
            {Object.entries(channelCounts).map(([id, count]) => (
              <TabsTrigger key={id} value={id} className="gap-1.5 text-xs">
                {id === "all" ? t("common.all") : (CHANNEL_LABELS[id] ?? id)}
                <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold">
                  {count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-48 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.search")}
              className="h-8 pl-8 text-xs"
            />
          </div>

          <Select value={sortMode} onValueChange={(v) => setSortMode(v as typeof sortMode)}>
            <SelectTrigger className="h-8 min-w-32 w-auto text-xs">
              <ArrowUpDown className="mr-1.5 size-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="lowest">{t("quota.sort_lowest")}</SelectItem>
              <SelectItem value="earliest_reset">{t("quota.sort_earliest")}</SelectItem>
              <SelectItem value="name">{t("quota.sort_name")}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={warningOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setWarningOnly(!warningOnly)}
            className="h-8 text-xs"
          >
            {t("quota.alerts_only")}
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
          {t("quota.no_matching")}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pageItems.map((item) => {
              const q = item.query;
              return (
                <Card
                  key={item.file.auth_index}
                  className="box-border flex w-full min-w-0 flex-col justify-between overflow-hidden p-4 sm:p-5"
                >
                  <div className="w-full min-w-0">
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium" title={item.name}>
                          {item.name}
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-[11px] font-normal uppercase">
                            {item.file.provider}
                          </Badge>
                          {item.plan && (
                            <Badge variant="outline" className="text-[11px] font-normal">
                              {item.plan}
                            </Badge>
                          )}
                          {q && q.dataUpdatedAt > 0 && (
                            <span>{t("quota.updated_ago", { time: formatRelative(q.dataUpdatedAt) })}</span>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("quota.refresh_account", { name: item.name })}
                        disabled={q?.isFetching}
                        onClick={() => q?.refetch()}
                      >
                        <RefreshCw className={q?.isFetching ? "animate-spin" : undefined} />
                      </Button>
                    </div>

                    {q?.isPending ? (
                      <Skeleton className="h-20 w-full" />
                    ) : q?.isError ? (
                      <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                        <p className="font-medium">{t("quota.query_failed")}</p>
                        <p className="mt-1 break-words opacity-90">{q.error.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 h-6 text-xs text-destructive hover:bg-destructive/15"
                          onClick={() => q?.refetch()}
                        >
                          {t("quota.retry")}
                        </Button>
                      </div>
                    ) : (q?.data?.windows ?? []).length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">{t("quota.no_details")}</p>
                    ) : (
                      <div className="flex w-full min-w-0 flex-col gap-3.5">
                        {q?.data?.windows.map((w) => (
                          <MeterRow key={w.id} window={w} />
                        ))}
                      </div>
                    )}
                  </div>

                  {q?.data && q.data.notes.length > 0 && (
                    <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">{q.data.notes.join("，")}</div>
                  )}
                </Card>
              );
            })}
          </div>
          <Pagination page={current} pageCount={pageCount} total={filtered.length} onChange={setPage} />
        </>
      )}
    </div>
  );
}
