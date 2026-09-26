import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpDown, CheckCircle2, Clock, Gauge, OctagonAlert, RefreshCw, Search } from "lucide-react";
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

function level(used: number | null): "ok" | "warn" | "danger" {
  if (used === null) return "ok";
  if (used >= 95) return "danger";
  if (used >= 80) return "warn";
  return "ok";
}

const BAR_COLOR = {
  ok: "bg-chart-1",
  warn: "bg-warning",
  danger: "bg-destructive",
};

function MeterRow({ window: w }: { window: QuotaWindow }) {
  const state = level(w.usedPercent);
  const used = w.usedPercent === null ? null : Math.round(w.usedPercent);
  const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium" title={w.label}>
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
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${BAR_COLOR[state]}`}
          style={{ width: `${remaining ?? 0}%` }}
        />
      </div>
      {(w.resetAt || w.detail) && (
        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
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

    for (const it of items) {
      if (it.minRemaining !== null) {
        if (it.minRemaining <= 0) exhausted++;
        else if (it.minRemaining <= 20) warning++;
        else healthy++;
      } else if (it.query?.isSuccess) {
        healthy++;
      }
    }
    return { total: items.length, healthy, warning, exhausted };
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
    return list.sort((a, b) => a.resetAt - b.resetAt).slice(0, 6);
  }, [items]);

  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return items
      .filter((it) => {
        if (selectedChannel !== "all" && it.provider !== selectedChannel) return false;
        if (warningOnly && (it.minRemaining === null || it.minRemaining > 20)) return false;
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
    toast.info("正在刷新所有账号配额…");
    await Promise.all(results.map((r) => r?.refetch()));
    toast.success("已完成配额刷新");
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
    <div className="space-y-6">
      {/* 概览统计卡片与操作 */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">额度使用监控概览</div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={isRefreshingAll || targets.length === 0}
            className="h-8 text-xs"
          >
            <RefreshCw className={isRefreshingAll ? "animate-spin" : undefined} />
            {isRefreshingAll ? "正在刷新…" : "刷新全部额度"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">总监控账号</span>
              <Gauge className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{metrics.total}</div>
            <p className="mt-1 text-xs text-muted-foreground">OAuth 凭据数</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">额度充足</span>
              <CheckCircle2 className="size-4 text-chart-1" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-chart-1">{metrics.healthy}</div>
            <p className="mt-1 text-xs text-muted-foreground">剩余 &gt; 20%</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">用量紧张</span>
              <AlertTriangle className="size-4 text-warning" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-warning">{metrics.warning}</div>
            <p className="mt-1 text-xs text-muted-foreground">剩余 &le; 20%</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">额度用尽</span>
              <OctagonAlert className="size-4 text-destructive" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-destructive">{metrics.exhausted}</div>
            <p className="mt-1 text-xs text-muted-foreground">等待窗口重置</p>
          </Card>
        </div>
      </div>

      {/* 即将重置时间线（有明确的独立卡片与上下间距） */}
      {upcomingResets.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">即将恢复额度窗口</h3>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingResets.map((r) => (
              <div
                key={`${r.accountName}-${r.provider}-${r.label}-${r.resetAt}`}
                className="flex items-center justify-between rounded-md border p-2.5 text-xs"
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
                  <span className="font-semibold text-primary">{formatCountdown(r.resetAt)}后</span>
                  {r.remaining !== null && (
                    <div className="text-[11px] text-muted-foreground">当前余 {r.remaining}%</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 渠道 Tabs 和检索栏 */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={selectedChannel} onValueChange={setSelectedChannel} className="w-full sm:w-auto">
            <TabsList className="h-9 flex-wrap">
              {CHANNELS.map((ch) => {
                const count = channelCounts[ch.id] || 0;
                return (
                  <TabsTrigger key={ch.id} value={ch.id} className="gap-1.5 text-xs">
                    {ch.label}
                    {count > 0 && (
                      <span className="rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-semibold">
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
              <SelectTrigger className="h-8 w-32 text-xs">
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

        {/* 卡片网格 */}
        {filtered.length === 0 ? (
          <Card className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
            没有找到符合当前筛选条件的账号额度信息
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((item) => {
              const q = item.query;
              return (
                <Card key={item.file.auth_index} className="flex flex-col justify-between p-5">
                  <div>
                    <div className="mb-4 flex items-start justify-between gap-2">
                      <div className="min-w-0">
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
                          onClick={() => q.refetch()}
                        >
                          重试
                        </Button>
                      </div>
                    ) : (q?.data?.windows ?? []).length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">上游未返回额度明细</p>
                    ) : (
                      <div className="grid gap-3.5">
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
    </div>
  );
}
