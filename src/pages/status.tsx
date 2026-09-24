import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Link } from "react-router";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { accountName } from "@/components/quota-panel";
import { RequestSparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatInteger, formatPercent } from "@/lib/format";
import type { AuthFile, RecentBucket } from "@/lib/types";

type KeyUsage = { success: number; failed: number; recent_requests?: RecentBucket[] };

const chartConfig = {
  succeeded: { label: "成功", color: "var(--chart-1)" },
  failed: { label: "失败", color: "var(--destructive)" },
} satisfies ChartConfig;

// CPA 各处的 recent_requests 都是同一时刻切出的 20 个 10 分钟桶,按位置相加即可
function mergeBuckets(lists: RecentBucket[][]): RecentBucket[] {
  const out: RecentBucket[] = [];
  for (const list of lists) {
    list.forEach((b, i) => {
      const acc = out[i] ?? { time: b.time, success: 0, failed: 0 };
      out[i] = { time: acc.time, success: acc.success + b.success, failed: acc.failed + b.failed };
    });
  }
  return out;
}

function recentTotal(buckets: RecentBucket[] = []) {
  return buckets.reduce((sum, b) => sum + b.success + b.failed, 0);
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 py-1 sm:px-6 sm:first:pl-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums md:text-3xl">{value}</div>
      {detail && <div className="mt-1 truncate text-sm text-muted-foreground">{detail}</div>}
    </div>
  );
}

export function StatusPage() {
  const files = useQuery({
    queryKey: ["cpa", "auth-files"],
    queryFn: () => api<{ files: AuthFile[] }>("/v0/management/auth-files"),
    select: (res) => res.files ?? [],
    refetchInterval: 30_000,
  });
  const keyUsage = useQuery({
    queryKey: ["cpa", "api-key-usage"],
    queryFn: () => api<Record<string, Record<string, KeyUsage>>>("/v0/management/api-key-usage"),
    select: (res) => Object.values(res ?? {}).flatMap((group) => Object.values(group ?? {})),
    refetchInterval: 30_000,
    retry: false,
  });

  if (!files.data) {
    return (
      <>
        <PageHeader title="状态" />
        {files.isError ? (
          <p role="alert" className="text-sm text-destructive">
            读取失败：{files.error.message}
          </p>
        ) : (
          <Skeleton className="h-96" />
        )}
      </>
    );
  }

  const accounts = files.data;
  const buckets = mergeBuckets([
    ...accounts.map((f) => f.recent_requests ?? []),
    ...(keyUsage.data ?? []).map((u) => u.recent_requests ?? []),
  ]);
  const success = buckets.reduce((s, b) => s + b.success, 0);
  const failed = buckets.reduce((s, b) => s + b.failed, 0);
  const active = accounts.filter((f) => !f.disabled);
  const attention = accounts.filter(
    (f) => !f.disabled && (f.unavailable || (f.status && f.status !== "ready" && f.status !== "active")),
  );
  const busiest = [...active]
    .sort((a, b) => recentTotal(b.recent_requests) - recentTotal(a.recent_requests))
    .slice(0, 8);
  const chartData = buckets.map((b) => ({
    time: b.time,
    label: b.time.split("-")[0],
    succeeded: b.success,
    failed: b.failed,
  }));

  return (
    <>
      <PageHeader title="状态" description="数据来自 CPA 的运行时计数，CPA 重启后清零。" />

      <section
        aria-label="运行概况"
        className="grid grid-cols-2 gap-x-4 gap-y-6 border-y py-6 sm:grid-cols-4 sm:gap-0 sm:divide-x"
      >
        <Stat
          label="最近 200 分钟请求"
          value={formatInteger(success + failed)}
          detail={failed ? `失败 ${formatInteger(failed)}` : "没有失败"}
        />
        <Stat label="成功率" value={formatPercent(success + failed ? success / (success + failed) : Number.NaN)} />
        <Stat
          label="可用账号"
          value={`${formatInteger(active.length - attention.length)} / ${formatInteger(accounts.length)}`}
          detail={attention.length ? `${attention.length} 个需要处理` : "全部正常"}
        />
        <Stat label="已停用账号" value={formatInteger(accounts.length - active.length)} />
      </section>

      <section aria-labelledby="traffic-title" className="mt-8">
        <h2 id="traffic-title" className="mb-4 font-medium">
          请求量（每 10 分钟）
        </h2>
        {chartData.length === 0 ? (
          <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">还没有请求</p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
            <BarChart data={chartData} margin={{ top: 8, left: 0, right: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.5 }}
                content={<ChartTooltipContent labelFormatter={(_, p) => p[0]?.payload?.time ?? null} />}
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="succeeded"
                stackId="r"
                fill="var(--color-succeeded)"
                stroke="var(--background)"
                strokeWidth={1}
              />
              <Bar
                dataKey="failed"
                stackId="r"
                fill="var(--color-failed)"
                stroke="var(--background)"
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="busy-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="busy-title" className="font-medium">
              最忙的账号
            </h2>
            <Link to="/accounts" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              全部账号
            </Link>
          </div>
          {busiest.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有启用的账号</p>
          ) : (
            <ul className="divide-y">
              {busiest.map((f) => (
                <li key={f.id || f.name} className="flex items-center gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{accountName(f)}</div>
                    <div className="text-xs text-muted-foreground">{f.provider}</div>
                  </div>
                  <RequestSparkline buckets={f.recent_requests ?? []} label={accountName(f)} />
                  <span className="w-12 text-right text-sm tabular-nums">
                    {formatInteger(recentTotal(f.recent_requests))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="attention-title">
          <h2 id="attention-title" className="mb-3 font-medium">
            需要处理
          </h2>
          {attention.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">所有启用的账号都在正常工作</p>
          ) : (
            <ul className="divide-y">
              {attention.map((f) => (
                <li key={f.id || f.name} className="flex items-start gap-3 py-2.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{accountName(f)}</span>
                      <Badge variant={f.unavailable ? "destructive" : "secondary"}>
                        {f.unavailable ? "冷却中" : f.status}
                      </Badge>
                    </div>
                    {f.status_message && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.status_message}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
