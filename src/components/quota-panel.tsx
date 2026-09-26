import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpDown, Clock, Gauge, OctagonAlert, RefreshCw, Search, Sparkles } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCountdown, formatDateTime, formatRelative } from "@/lib/format";
import { fetchQuota, type QuotaWindow, supportsQuota } from "@/lib/quota";
import type { AuthFile } from "@/lib/types";

export function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

const CHANNELS: { id: string; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "devin", label: "Devin" },
  { id: "kimi", label: "Kimi" },
  { id: "meta", label: "Meta" },
  { id: "xai", label: "xAI" },
  { id: "antigravity", label: "Antigravity" },
];

// 剩余不超过该百分比视为紧张,卡片、统计与"仅看告警"共用
const WARN_REMAINING = 20;

function level(remaining: number | null): "ok" | "warn" | "danger" {
  if (remaining === null) return "ok";
  if (remaining <= 0) return "danger";
  if (remaining <= WARN_REMAINING) return "warn";
  return "ok";
}

const BAR_COLOR = {
  ok: "bg-chart-1",
  warn: "bg-warning",
  danger: "bg-destructive",
};

function MeterRow({ window: w }: { window: QuotaWindow }) {
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
          {state === "warn" && <AlertTriangle className="size-3.5 text-warning" aria-hidden />}
          <span
            className={state === "danger" ? "font-semibold text-destructive" : state === "warn" ? "text-warning" : ""}
          >
            {remaining === null ? "—" : `剩余 ${remaining}%`}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${w.label}剩余额度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining ?? undefined}
        className="relative h-2 w-full min-w-0 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${BAR_COLOR[state]}`}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
      {(w.resetAt || w.detail) && (
        <div className="flex w-full min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span title={w.resetAt ? formatDateTime(w.resetAt) : undefined}>
            {w.resetAt ? `${formatCountdown(w.resetAt)}后重置` : ""}
          </span>
          {w.detail && <span className="tabular-nums">{w.detail}</span>}
        </div>
      )}
    </div>
  );
}

export function QuotaPanel({ files }: { files: AuthFile[] }) {
  const [subView, setSubView] = useState<"cards" | "schedule">("cards");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<"lowest" | "earliest_reset" | "name">("lowest");
  const [warningOnly, setWarningOnly] = useState(false);

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
    const counts: Record<string, number> = { all: targets.length };
    for (const item of items) {
      counts[item.provider] = (counts[item.provider] || 0) + 1;
    }
    return counts;
  }, [targets, items]);

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
      remaining: number | null;
    }[] = [];

    const now = Date.now();
    for (const it of items) {
      for (const w of it.query?.data?.windows ?? []) {
        if (w.resetAt && w.resetAt > now) {
          const used = w.usedPercent !== null ? Math.round(w.usedPercent) : null;
          list.push({
            accountName: it.name,
            provider: it.file.provider ?? "",
            label: w.label,
            resetAt: w.resetAt,
            remaining: used !== null ? Math.max(0, 100 - used) : null,
          });
        }
      }
    }
    return list.sort((a, b) => a.resetAt - b.resetAt).slice(0, 8);
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

  const isRefreshingAll = results.some((r) => r?.isFetching);

  const handleRefreshAll = async () => {
    const done = await Promise.all(results.map((r) => r.refetch()));
    const failed = done.filter((r) => r.isError).length;
    if (failed) toast.error(`${failed} 个认证文件额度查询失败`);
    else toast.success("额度已刷新");
  };

  if (targets.length === 0) {
    return (
      <Card className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
        <p>暂无可查询额度的有效 OAuth 账号。</p>
        <p className="mt-1 text-xs">目前支持 Codex、Claude、Devin、Kimi、Meta、xAI、Antigravity。</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部二级子导航与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <Tabs value={subView} onValueChange={(v) => setSubView(v as typeof subView)}>
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="cards" className="gap-1.5 text-xs">
              <Gauge className="size-3.5" />
              账号额度卡片
            </TabsTrigger>
            <TabsTrigger value="schedule" className="gap-1.5 text-xs">
              <Clock className="size-3.5" />
              恢复计划与监控
              {upcomingResets.length > 0 && (
                <span className="rounded-full bg-chart-1/15 px-1.5 py-0.5 text-[10px] font-semibold text-chart-1">
                  {upcomingResets.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {/* 紧凑健康状态小徽标 */}
          <div className="hidden items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground sm:flex">
            <span>
              总计 <strong className="font-semibold text-foreground">{metrics.total}</strong>
            </span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1 text-chart-1 font-medium">
              <span className="size-1.5 rounded-full bg-chart-1" />
              {metrics.healthy} 充裕
            </span>
            {metrics.warning > 0 && (
              <span className="flex items-center gap-1 text-warning font-medium">
                <span className="size-1.5 rounded-full bg-warning" />
                {metrics.warning} 紧张
              </span>
            )}
            {metrics.exhausted > 0 && (
              <span className="flex items-center gap-1 text-destructive font-medium">
                <span className="size-1.5 rounded-full bg-destructive" />
                {metrics.exhausted} 用尽
              </span>
            )}
            {metrics.failed > 0 && (
              <span className="flex items-center gap-1 font-medium">
                <span className="size-1.5 rounded-full bg-muted-foreground" />
                {metrics.failed} 查询失败
              </span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isRefreshingAll || targets.length === 0}
            className="h-8 text-xs"
          >
            <RefreshCw className={isRefreshingAll ? "animate-spin" : undefined} />
            {isRefreshingAll ? "正在刷新…" : "刷新全部"}
          </Button>
        </div>
      </div>

      {/* 视图一：账号额度卡片（默认首屏直达，无需下拉） */}
      {subView === "cards" && (
        <div className="space-y-4">
          {/* 快速提示条（如果有即将重置的窗口） */}
          {upcomingResets.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-chart-1/25 bg-chart-1/5 px-3 py-2 text-xs text-foreground">
              <div className="flex items-center gap-2 truncate">
                <Sparkles className="size-3.5 shrink-0 text-chart-1" />
                <span className="truncate">
                  最早将在{" "}
                  <strong className="font-semibold text-chart-1">{formatCountdown(upcomingResets[0].resetAt)}后</strong>{" "}
                  恢复{" "}
                  <span className="font-medium text-foreground">
                    {upcomingResets[0].accountName}（{upcomingResets[0].label}）
                  </span>{" "}
                  额度
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSubView("schedule")}
                className="h-6 shrink-0 px-2 text-xs text-chart-1 hover:bg-chart-1/10"
              >
                查看恢复计划 &rarr;
              </Button>
            </div>
          )}

          {/* 渠道 Tabs 和检索栏 */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={selectedChannel} onValueChange={setSelectedChannel} className="w-full sm:w-auto">
              <TabsList className="h-9 flex-wrap">
                {CHANNELS.filter((ch) => channelCounts[ch.id]).map((ch) => {
                  const count = channelCounts[ch.id];
                  return (
                    <TabsTrigger key={ch.id} value={ch.id} className="gap-1.5 text-xs">
                      {ch.label}
                      {count > 0 && (
                        <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-48 sm:flex-none">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索账号或套餐…"
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <Select value={sortMode} onValueChange={(v) => setSortMode(v as typeof sortMode)}>
                <SelectTrigger className="h-8 min-w-32 w-auto text-xs">
                  <ArrowUpDown className="mr-1.5 size-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="lowest">用尽/低额优先</SelectItem>
                  <SelectItem value="earliest_reset">最早重置优先</SelectItem>
                  <SelectItem value="name">名称排序</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={warningOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setWarningOnly(!warningOnly)}
                className="h-8 text-xs"
              >
                仅看告警
              </Button>
            </div>
          </div>

          {/* 账号额度卡片网格 */}
          {filtered.length === 0 ? (
            <Card className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
              没有找到符合当前筛选条件的账号额度信息
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => {
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
                            {q && q.dataUpdatedAt > 0 && <span>{formatRelative(q.dataUpdatedAt)}更新</span>}
                          </div>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`刷新 ${item.name} 的额度`}
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
                          <p className="font-medium">查询额度失败</p>
                          <p className="mt-1 break-words opacity-90">{q.error.message}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-6 text-xs text-destructive hover:bg-destructive/15"
                            onClick={() => q?.refetch()}
                          >
                            重试
                          </Button>
                        </div>
                      ) : (q?.data?.windows ?? []).length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">上游未返回额度明细</p>
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
          )}
        </div>
      )}

      {/* 视图二：恢复计划与大盘监控（完整统计与时间线） */}
      {subView === "schedule" && (
        <div className="space-y-6">
          {/* 即将恢复额度窗口卡片 */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">近期配额恢复时间线</h3>
              </div>
              <span className="text-xs text-muted-foreground">按恢复时间升序</span>
            </div>

            {upcomingResets.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                当前暂无明确重置时间戳的窗口，或额度处于充裕状态。
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {upcomingResets.map((r) => (
                  <div
                    key={`${r.accountName}-${r.provider}-${r.label}-${r.resetAt}`}
                    className="flex items-center justify-between rounded-md border p-3 text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 truncate font-medium">
                        <Badge variant="outline" className="px-1 py-0 text-[10px]">
                          {r.provider}
                        </Badge>
                        <span className="truncate">{r.accountName}</span>
                      </div>
                      <span className="text-muted-foreground">{r.label}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-semibold text-chart-1">{formatCountdown(r.resetAt)}后</span>
                      {r.remaining !== null && (
                        <div className="text-[11px] text-muted-foreground">当前余 {r.remaining}%</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
