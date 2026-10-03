import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  LayoutGrid,
  List,
  OctagonAlert,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pagination, paginate } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/context";
import { errorText } from "@/lib/api";
import { CREDENTIALS_KEY } from "@/lib/credentials";
import { formatCountdown, formatDateTime, formatRelative } from "@/lib/format";
import { fetchQuota, type QuotaWindow, resetQuota, supportsQuota } from "@/lib/quota";
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

type QuotaLevel = "ok" | "warn" | "danger";

function level(remaining: number | null): QuotaLevel {
  if (remaining === null) return "ok";
  if (remaining <= 0) return "danger";
  if (remaining <= WARN_REMAINING) return "warn";
  return "ok";
}

// 进度条按状态取语义色，和卡片上的文字/图标保持一致
const BAR_FILL: Record<QuotaLevel, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
};

/** 计算剩余百分比 */
function getRemaining(w: QuotaWindow): number | null {
  return w.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - Math.round(w.usedPercent)));
}

/** 额度窗口按紧迫度排序：耗尽/紧张的排在最前，最接近重置的排在前 */
function sortWindowsByUrgency(windows: QuotaWindow[]): QuotaWindow[] {
  return [...windows].sort((a, b) => {
    const remA = getRemaining(a) ?? 999;
    const remB = getRemaining(b) ?? 999;
    if (remA !== remB) return remA - remB;
    const resetA = a.resetAt && a.resetAt > Date.now() ? a.resetAt : Number.MAX_SAFE_INTEGER;
    const resetB = b.resetAt && b.resetAt > Date.now() ? b.resetAt : Number.MAX_SAFE_INTEGER;
    return resetA - resetB;
  });
}

/** 单个额度进度行：自然流式排布，呼吸感好，绝不套固定高度的滚动条 */
export function MeterRow({ window: w }: { window: QuotaWindow }) {
  const { t } = useI18n();
  const remaining = getRemaining(w);
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
            className={
              state === "danger"
                ? "font-semibold text-destructive"
                : state === "warn"
                  ? "font-medium text-warning"
                  : "text-muted-foreground"
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
        className="relative h-2 w-full min-w-0 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${BAR_FILL[state]}`}
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

/** 表格行内的微型额度胶囊（水平流动排布） */
function QuotaPill({ window: w }: { window: QuotaWindow }) {
  const remaining = getRemaining(w);
  const state = level(remaining);

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] font-mono"
      title={`${w.label}: ${remaining === null ? "—" : `${remaining}%`} ${w.resetAt ? `· ${formatCountdown(w.resetAt)}` : ""}`}
    >
      <span
        className={`size-1.5 rounded-full ${
          state === "danger" ? "bg-destructive" : state === "warn" ? "bg-warning" : "bg-success"
        }`}
      />
      <span className="max-w-28 truncate font-sans text-foreground" title={w.label}>
        {w.label}
      </span>
      <span
        className={
          state === "danger"
            ? "font-semibold text-destructive tabular-nums"
            : state === "warn"
              ? "font-medium text-warning tabular-nums"
              : "text-muted-foreground tabular-nums"
        }
      >
        {remaining === null ? "—" : `${remaining}%`}
      </span>
    </span>
  );
}

/** 账号全量额度明细弹窗：专门服务于多达数十个模型的账号，带过滤和网格呈现 */
function QuotaDetailModal({
  item,
  onClose,
  onReset,
  isResetting,
}: {
  item: {
    file: AuthFile;
    name: string;
    query: {
      data?: { windows: QuotaWindow[]; plan?: string | null; notes: string[] };
      isFetching: boolean;
      refetch: () => void;
    };
  };
  onClose: () => void;
  onReset?: () => void;
  isResetting?: boolean;
}) {
  const { t } = useI18n();
  const [filterQuery, setFilterQuery] = useState("");
  const windows = sortWindowsByUrgency(item.query.data?.windows ?? []);

  const filteredWindows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return windows;
    return windows.filter((w) => w.label.toLowerCase().includes(q));
  }, [windows, filterQuery]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-[95vw] sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl flex-col overflow-hidden p-6">
        <DialogHeader className="pb-3 border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-base font-semibold">
                {t("quota.details_dialog_title", { name: item.name })}
              </DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="uppercase text-[10px]">
                  {item.file.provider}
                </Badge>
                {item.query.data?.plan && (
                  <Badge variant="outline" className="text-[10px]">
                    {item.query.data.plan}
                  </Badge>
                )}
                <span>{t("quota.windows_count", { count: windows.length })}</span>
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1">
              {item.file.quota_provider && onReset && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isResetting}
                  onClick={onReset}
                  className="h-8 text-xs gap-1"
                >
                  <RotateCcw className={isResetting ? "size-3.5 animate-spin" : "size-3.5"} />
                  {t("quota.reset_account", { name: "" })}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={item.query.isFetching}
                onClick={() => item.query.refetch()}
                className="h-8 text-xs gap-1"
              >
                <RefreshCw className={item.query.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
                {t("common.refresh")}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {windows.length > 6 && (
          <div className="pt-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={t("quota.filter_models")}
                className="h-8 pl-8 text-xs font-mono"
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pt-4 pr-1">
          {filteredWindows.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">{t("quota.no_matching")}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredWindows.map((w) => (
                <div key={w.id} className="rounded-lg border bg-card/60 p-3.5 shadow-2xs">
                  <MeterRow window={w} />
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QuotaPanel({ files }: { files: AuthFile[] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<"lowest" | "earliest_reset" | "name">("lowest");
  const [warningOnly, setWarningOnly] = useState(false);

  // 视图模式:卡片网格 vs 列表表格
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("cpa_quota_view");
      if (saved === "grid" || saved === "list") return saved;
    }
    return "grid";
  });

  const handleViewModeChange = (mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem("cpa_quota_view", mode);
    } catch {
      // ignore
    }
  };

  // 每页条数
  const [pageSize, setPageSize] = useState<number>(() => (viewMode === "list" ? 20 : 12));

  // 卡片展开集合
  const [expandedCards, setExpandedCards] = useState<Record<string, true>>({});
  const toggleCard = (id: string) => {
    setExpandedCards((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  // 列表展开行集合
  const [expandedRows, setExpandedRows] = useState<Record<string, true>>({});
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  };

  // 独立详情弹窗对象
  const [modalItem, setModalItem] = useState<{
    file: AuthFile;
    name: string;
    query: {
      data?: { windows: QuotaWindow[]; plan?: string | null; notes: string[] };
      isFetching: boolean;
      refetch: () => void;
    };
  } | null>(null);

  // 页码跟筛选条件及视图绑定,条件一变自动回到第一页
  const filterKey = `${selectedChannel}|${deferredSearch}|${sortMode}|${warningOnly}|${pageSize}|${viewMode}`;
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
        const rem = getRemaining(w);
        if (rem !== null) {
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
        const remaining = getRemaining(w);
        if (w.resetAt && w.resetAt > now && remaining !== null && level(remaining) !== "ok") {
          list.push({
            accountName: it.name,
            provider: it.file.provider ?? "",
            label: w.label,
            resetAt: w.resetAt,
            remaining,
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

  const { pageItems, current, pageCount } = paginate(filtered, page, pageSize);
  const isRefreshingAll = results.some((r) => r?.isFetching);

  const handleRefreshAll = async () => {
    const done = await Promise.all(results.map((r) => r.refetch()));
    const failed = done.filter((r) => r.isError).length;
    if (failed) toast.error(t("quota.refresh_failed_count", { count: failed }));
    else toast.success(t("quota.refreshed"));
  };

  // 重置走插件额度提供方
  const reset = useMutation({
    mutationFn: (file: AuthFile) => resetQuota(file),
    onSuccess: (res, file) => {
      toast.success(
        t("quota.reset_done", {
          name: accountName(file),
          message: res.message ? t("quota.reset_message", { message: res.message }) : "",
        }),
      );
      queryClient.invalidateQueries({ queryKey: ["quota", file.auth_index] });
      queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
    },
    onError: (error: Error) => toast.error(t("quota.reset_failed", { message: errorText(error) })),
    meta: { quiet: true },
  });

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
      {/* 顶部统计与全部刷新 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("quota.total_prefix")} <strong className="font-semibold text-foreground">{metrics.total}</strong>{" "}
            {t("quota.total_suffix")}
          </span>
          <span className="flex items-center gap-1 font-medium text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {metrics.healthy} {t("quota.healthy")}
          </span>
          {metrics.warning > 0 && (
            <span className="flex items-center gap-1 font-medium text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              {metrics.warning} {t("quota.tight")}
            </span>
          )}
          {metrics.exhausted > 0 && (
            <span className="flex items-center gap-1 font-medium text-destructive">
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

      {/* 临近重置卡片 */}
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
                  <span className={r.remaining === 0 ? "text-destructive" : "text-warning"}>
                    {t("quota.remaining_percent", { n: r.remaining })}
                  </span>
                  <span className="text-muted-foreground"> · {formatCountdown(r.resetAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 筛选与视图栏 */}
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-44 sm:flex-none">
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

          {/* 视图切换器 */}
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            <Button
              type="button"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon-xs"
              className="size-7"
              onClick={() => handleViewModeChange("grid")}
              title={t("quota.view_grid")}
              aria-label={t("quota.view_grid")}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon-xs"
              className="size-7"
              onClick={() => handleViewModeChange("list")}
              title={t("quota.view_list")}
              aria-label={t("quota.view_list")}
            >
              <List className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="grid place-items-center py-12 text-center text-sm text-muted-foreground">
          {t("quota.no_matching")}
        </Card>
      ) : (
        <>
          {viewMode === "grid" ? (
            /* 卡片视图：恢复自然自适应尺寸，消除生硬的滚动条 */
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item) => {
                const q = item.query;
                const rawWindows = q?.data?.windows ?? [];
                const sortedWindows = sortWindowsByUrgency(rawWindows);
                const isExpanded = Boolean(expandedCards[item.file.auth_index ?? ""]);
                // 默认展示前 3 项，超过 3 项时可原地自适应展开或呼出弹窗
                const visibleWindows = isExpanded ? sortedWindows : sortedWindows.slice(0, 3);
                const hasMore = sortedWindows.length > 3;

                return (
                  <Card
                    key={item.file.auth_index}
                    className="box-border flex w-full min-w-0 flex-col justify-between overflow-hidden p-4 sm:p-5 transition-all"
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
                            {hasMore && (
                              <Badge variant="outline" className="text-[11px] font-normal">
                                {t("quota.windows_count", { count: sortedWindows.length })}
                              </Badge>
                            )}
                            {q && q.dataUpdatedAt > 0 && (
                              <span>{t("quota.updated_ago", { time: formatRelative(q.dataUpdatedAt) })}</span>
                            )}
                            {item.file.quota_provider && (
                              <Badge variant="outline" className="text-[11px] font-normal">
                                {t("quota.source_plugin")}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5">
                          {hasMore && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("quota.view_all_dialog")}
                              aria-label={t("quota.view_all_dialog")}
                              onClick={() => setModalItem(item)}
                            >
                              <ExternalLink className="size-3.5" />
                            </Button>
                          )}
                          {item.file.quota_provider && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("quota.reset_hint")}
                              aria-label={t("quota.reset_account", { name: item.name })}
                              disabled={reset.isPending && reset.variables?.auth_index === item.file.auth_index}
                              onClick={() => reset.mutate(item.file)}
                            >
                              <RotateCcw
                                className={
                                  reset.isPending && reset.variables?.auth_index === item.file.auth_index
                                    ? "size-3.5 animate-spin"
                                    : "size-3.5"
                                }
                              />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("quota.refresh_account", { name: item.name })}
                            disabled={q?.isFetching}
                            onClick={() => q?.refetch()}
                          >
                            <RefreshCw className={q?.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
                          </Button>
                        </div>
                      </div>

                      {q?.isPending ? (
                        <Skeleton className="h-20 w-full" />
                      ) : q?.isError ? (
                        <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                          <p className="font-medium">{t("quota.query_failed")}</p>
                          <p className="mt-1 wrap-break-word opacity-90">{errorText(q.error)}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-6 text-xs text-destructive hover:bg-destructive/15"
                            onClick={() => q?.refetch()}
                          >
                            {t("quota.retry")}
                          </Button>
                        </div>
                      ) : sortedWindows.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">{t("quota.no_details")}</p>
                      ) : (
                        <div className="space-y-3.5">
                          {/* 自然平铺展示，绝不加生硬的局部滚动条 */}
                          <div className="flex w-full min-w-0 flex-col gap-3.5">
                            {visibleWindows.map((w) => (
                              <MeterRow key={w.id} window={w} />
                            ))}
                          </div>
                          {hasMore && (
                            <div className="flex items-center justify-between pt-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground px-2"
                                onClick={() => toggleCard(item.file.auth_index ?? "")}
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="mr-1 size-3.5" />
                                    {t("quota.collapse")}
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="mr-1 size-3.5" />
                                    {t("quota.expand_more", { count: sortedWindows.length - 3 })}
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground"
                                onClick={() => setModalItem(item)}
                              >
                                {t("quota.view_all_dialog")}
                              </Button>
                            </div>
                          )}
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
          ) : (
            /* 列表视图：结构化数据表格 + 可展开 Master-Detail 行 */
            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 px-2" />
                    <TableHead className="w-48 sm:w-56">{t("quota.th_account")}</TableHead>
                    <TableHead className="w-28">{t("quota.th_status")}</TableHead>
                    <TableHead>{t("quota.th_windows")}</TableHead>
                    <TableHead className="w-32">{t("quota.th_reset")}</TableHead>
                    <TableHead className="w-28">{t("quota.th_updated")}</TableHead>
                    <TableHead className="w-24 text-right">{t("quota.th_actions") || t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((item) => {
                    const q = item.query;
                    const rawWindows = q?.data?.windows ?? [];
                    const sortedWindows = sortWindowsByUrgency(rawWindows);
                    const lvl = level(item.minRemaining);
                    const isRowExpanded = Boolean(expandedRows[item.file.auth_index ?? ""]);
                    const hasWindows = sortedWindows.length > 0;

                    return (
                      <>
                        <TableRow
                          key={item.file.auth_index}
                          className={isRowExpanded ? "border-b-0 bg-muted/20" : undefined}
                        >
                          {/* 行展开箭头 */}
                          <TableCell className="px-2 py-3">
                            {hasWindows && (
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-6 text-muted-foreground"
                                onClick={() => toggleRow(item.file.auth_index ?? "")}
                                aria-label={isRowExpanded ? t("quota.collapse_row") : t("quota.expand_row")}
                              >
                                {isRowExpanded ? (
                                  <ChevronDown className="size-3.5" />
                                ) : (
                                  <ChevronRight className="size-3.5" />
                                )}
                              </Button>
                            )}
                          </TableCell>

                          {/* 账号凭据 */}
                          <TableCell className="py-3">
                            <div className="space-y-1">
                              <div className="max-w-48 truncate font-medium text-foreground text-sm" title={item.name}>
                                {item.name}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 text-xs">
                                <Badge variant="secondary" className="text-[10px] font-normal uppercase">
                                  {item.file.provider}
                                </Badge>
                                {item.plan && (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {item.plan}
                                  </Badge>
                                )}
                                {item.file.quota_provider && (
                                  <Badge variant="outline" className="text-[10px] font-normal">
                                    {t("quota.source_plugin")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* 健康状态与最低剩余 */}
                          <TableCell className="py-3">
                            {q?.isError ? (
                              <Badge variant="destructive" className="text-xs">
                                {t("quota.query_failed_short")}
                              </Badge>
                            ) : q?.isPending ? (
                              <Skeleton className="h-5 w-16" />
                            ) : lvl === "danger" ? (
                              <div className="space-y-0.5">
                                <Badge variant="destructive" className="text-xs">
                                  {t("quota.exhausted")}
                                </Badge>
                                <div className="font-semibold text-destructive text-xs tabular-nums">0%</div>
                              </div>
                            ) : lvl === "warn" ? (
                              <div className="space-y-0.5">
                                <Badge
                                  variant="secondary"
                                  className="border-warning/30 bg-warning/10 text-warning text-xs"
                                >
                                  {t("quota.tight")}
                                </Badge>
                                <div className="font-medium text-warning text-xs tabular-nums">
                                  {item.minRemaining}%
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <Badge
                                  variant="secondary"
                                  className="border-success/30 bg-success/10 text-success text-xs"
                                >
                                  {t("quota.healthy")}
                                </Badge>
                                {item.minRemaining !== null && (
                                  <div className="text-muted-foreground text-xs tabular-nums">{item.minRemaining}%</div>
                                )}
                              </div>
                            )}
                          </TableCell>

                          {/* 额度摘要：符合表格结构的行内胶囊 */}
                          <TableCell className="py-3">
                            {q?.isPending ? (
                              <div className="flex gap-2">
                                <Skeleton className="h-5 w-24 rounded-md" />
                                <Skeleton className="h-5 w-24 rounded-md" />
                              </div>
                            ) : q?.isError ? (
                              <span className="text-xs text-destructive">{errorText(q.error)}</span>
                            ) : sortedWindows.length === 0 ? (
                              <span className="text-xs text-muted-foreground">{t("quota.no_details")}</span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {sortedWindows.slice(0, 3).map((w) => (
                                  <QuotaPill key={w.id} window={w} />
                                ))}
                                {sortedWindows.length > 3 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleRow(item.file.auth_index ?? "")}
                                    className="inline-flex items-center gap-0.5 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted/50 cursor-pointer"
                                  >
                                    <span>{t("quota.more_quotas", { count: sortedWindows.length - 3 })}</span>
                                    <ChevronDown className="size-3" />
                                  </button>
                                )}
                              </div>
                            )}
                          </TableCell>

                          {/* 下次重置 */}
                          <TableCell className="py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {item.earliestReset ? (
                              <span
                                title={formatDateTime(item.earliestReset)}
                                className="font-medium text-foreground tabular-nums"
                              >
                                {formatCountdown(item.earliestReset)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>

                          {/* 更新时间 */}
                          <TableCell className="py-3 text-muted-foreground text-xs whitespace-nowrap">
                            {q && q.dataUpdatedAt > 0 ? <span>{formatRelative(q.dataUpdatedAt)}</span> : "—"}
                          </TableCell>

                          {/* 操作 */}
                          <TableCell className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {sortedWindows.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title={t("quota.view_all_dialog")}
                                  aria-label={t("quota.view_all_dialog")}
                                  onClick={() => setModalItem(item)}
                                >
                                  <ExternalLink className="size-3.5" />
                                </Button>
                              )}
                              {item.file.quota_provider && (
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  title={t("quota.reset_hint")}
                                  aria-label={t("quota.reset_account", { name: item.name })}
                                  disabled={reset.isPending && reset.variables?.auth_index === item.file.auth_index}
                                  onClick={() => reset.mutate(item.file)}
                                >
                                  <RotateCcw
                                    className={
                                      reset.isPending && reset.variables?.auth_index === item.file.auth_index
                                        ? "size-3.5 animate-spin"
                                        : "size-3.5"
                                    }
                                  />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t("quota.refresh_account", { name: item.name })}
                                disabled={q?.isFetching}
                                onClick={() => q?.refetch()}
                              >
                                <RefreshCw className={q?.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* 展开的明细子面板（Master-Detail Row） */}
                        {isRowExpanded && (
                          <TableRow className="border-b bg-muted/15 hover:bg-muted/15">
                            <TableCell colSpan={7} className="p-0">
                              <div className="border-l-2 border-primary/40 px-6 py-4 space-y-3">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium text-foreground">
                                    {t("quota.details_dialog_title", { name: item.name })} (
                                    {t("quota.windows_count", { count: sortedWindows.length })})
                                  </span>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-6 text-xs text-muted-foreground p-0"
                                    onClick={() => setModalItem(item)}
                                  >
                                    {t("quota.view_all_dialog")}
                                  </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                  {sortedWindows.map((w) => (
                                    <div key={w.id} className="rounded-lg border bg-card p-3 shadow-2xs">
                                      <MeterRow window={w} />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 分页栏 */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span>
                {t("pagination.range", {
                  from: filtered.length === 0 ? 0 : (current - 1) * pageSize + 1,
                  to: Math.min(current * pageSize, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-7 w-auto min-w-17.5 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="10">10 {t("quota.per_page")}</SelectItem>
                    <SelectItem value="12">12 {t("quota.per_page")}</SelectItem>
                    <SelectItem value="20">20 {t("quota.per_page")}</SelectItem>
                    <SelectItem value="50">50 {t("quota.per_page")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Pagination page={current} pageCount={pageCount} total={filtered.length} onChange={setPage} />
          </div>
        </>
      )}

      {/* 独立额度明细大弹窗 */}
      {modalItem && (
        <QuotaDetailModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onReset={modalItem.file.quota_provider ? () => reset.mutate(modalItem.file) : undefined}
          isResetting={reset.isPending && reset.variables?.auth_index === modalItem.file.auth_index}
        />
      )}
    </div>
  );
}
