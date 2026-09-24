import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/range-picker";
import { RankList } from "@/components/rank-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Metric, UsageChart } from "@/components/usage-chart";
import { useSummary, useTimeseries } from "@/hooks/use-usage";
import { api } from "@/lib/api";
import { formatCompact, formatCost, formatInteger, formatLatency, formatPercent, successRate } from "@/lib/format";

function StatisticsDisabledNotice() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["cpa", "usage-statistics-enabled"],
    queryFn: () => api<{ "usage-statistics-enabled": boolean }>("/v0/management/usage-statistics-enabled"),
  });
  const enable = useMutation({
    mutationFn: () => api("/v0/management/usage-statistics-enabled", { method: "PUT", body: { value: true } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cpa", "usage-statistics-enabled"] }),
  });
  if (data?.["usage-statistics-enabled"] !== false) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="flex-1">CPA 没有开启用量统计，新的请求不会被记录。</span>
      <Button size="sm" onClick={() => enable.mutate()} disabled={enable.isPending}>
        开启用量统计
      </Button>
    </div>
  );
}

function Stat({ label, value, detail, hero }: { label: string; value: ReactNode; detail?: ReactNode; hero?: boolean }) {
  return (
    <div className="min-w-0 py-1 sm:px-6 sm:first:pl-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={
          hero
            ? "mt-1 text-4xl font-semibold tracking-tight md:text-5xl"
            : "mt-1 text-2xl font-semibold tracking-tight md:text-3xl"
        }
      >
        {value}
      </div>
      {detail && <div className="mt-1 truncate text-sm text-muted-foreground">{detail}</div>}
    </div>
  );
}

function StatStrip() {
  const { data: s } = useSummary();
  if (!s) {
    return <Skeleton className="h-28" />;
  }
  const rate = successRate(s);
  return (
    <section
      aria-label="用量汇总"
      className="grid grid-cols-2 gap-x-4 gap-y-6 border-y py-6 sm:grid-cols-[1.5fr_1fr_1fr_1fr] sm:gap-0 sm:divide-x"
    >
      <div className="col-span-2 sm:col-span-1">
        <Stat
          hero
          label="费用估算"
          value={formatCost(s.cost)}
          detail={
            s.unpricedRequests > 0
              ? `${formatInteger(s.unpricedRequests)} 次请求的模型没有价格，未计入`
              : "按 LiteLLM 公开价格计算"
          }
        />
      </div>
      <Stat
        label="Tokens"
        value={formatCompact(s.totalTokens)}
        detail={`输入 ${formatCompact(s.inputTokens)}，输出 ${formatCompact(s.outputTokens)}`}
      />
      <Stat
        label="请求"
        value={formatInteger(s.requests)}
        detail={s.failed > 0 ? `失败 ${formatInteger(s.failed)}` : "没有失败"}
      />
      <Stat
        label="成功率"
        value={formatPercent(rate)}
        detail={`缓存命中 ${formatPercent(s.inputTokens ? s.cacheReadTokens / s.inputTokens : Number.NaN)}，平均耗时 ${formatLatency(s.avgLatencyMs)}`}
      />
    </section>
  );
}

function Trend() {
  const [metric, setMetric] = useState<Metric>("tokens");
  const { data } = useTimeseries();
  return (
    <section aria-labelledby="trend-title" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="trend-title" className="font-medium">
          趋势
        </h2>
        <Tabs value={metric} onValueChange={(value) => setMetric(value as Metric)}>
          <TabsList>
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="cost">费用</TabsTrigger>
            <TabsTrigger value="requests">请求</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {data ? <UsageChart metric={metric} bucket={data.bucket} points={data.points} /> : <Skeleton className="h-72" />}
    </section>
  );
}

export function OverviewPage() {
  return (
    <>
      <PageHeader title="概览" actions={<RangePicker />} />
      <StatisticsDisabledNotice />
      <StatStrip />
      <Trend />
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <RankList by="model" title="模型" />
        <RankList by="account" title="账号" />
      </div>
    </>
  );
}
