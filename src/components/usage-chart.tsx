import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCompact, formatCost } from "@/lib/format";
import type { TimePoint } from "@/lib/types";

export type Metric = "tokens" | "cost" | "requests";

const tokenConfig = {
  inputTokens: { label: "输入", color: "var(--chart-1)" },
  outputTokens: { label: "输出", color: "var(--chart-2)" },
} satisfies ChartConfig;

const costConfig = {
  cost: { label: "费用", color: "var(--chart-1)" },
} satisfies ChartConfig;

const requestConfig = {
  succeeded: { label: "成功", color: "var(--chart-1)" },
  failed: { label: "失败", color: "var(--destructive)" },
} satisfies ChartConfig;

function tickFormatter(bucket: "hour" | "day") {
  return (t: number) => {
    const d = new Date(t);
    return bucket === "hour" ? `${String(d.getHours()).padStart(2, "0")}:00` : `${d.getMonth() + 1}/${d.getDate()}`;
  };
}

function labelFormatter(bucket: "hour" | "day") {
  return (_: unknown, payload: readonly { payload?: { t?: number } }[]) => {
    const t = payload[0]?.payload?.t;
    if (t === undefined) return null;
    const d = new Date(t);
    const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    return bucket === "hour" ? `${date} ${String(d.getHours()).padStart(2, "0")}:00` : date;
  };
}

const axisProps = { tickLine: false, axisLine: false, tickMargin: 8 } as const;

export function UsageChart({
  metric,
  bucket,
  points,
}: {
  metric: Metric;
  bucket: "hour" | "day";
  points: TimePoint[];
}) {
  const xAxis = <XAxis dataKey="t" {...axisProps} minTickGap={28} tickFormatter={tickFormatter(bucket)} />;
  const grid = <CartesianGrid vertical={false} />;
  const className = "aspect-auto h-72 w-full [&_.recharts-cartesian-axis-tick_text]:tabular-nums";

  if (metric === "requests") {
    const data = points.map((p) => ({ t: p.t, succeeded: p.requests - p.failed, failed: p.failed }));
    return (
      <ChartContainer config={requestConfig} className={className}>
        <BarChart data={data} margin={{ top: 8, left: 0, right: 0 }}>
          {grid}
          {xAxis}
          <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={formatCompact} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.5 }}
            content={<ChartTooltipContent labelFormatter={labelFormatter(bucket)} />}
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
    );
  }

  if (metric === "cost") {
    return (
      <ChartContainer config={costConfig} className={className}>
        <AreaChart data={points} margin={{ top: 8, left: 0, right: 0 }}>
          {grid}
          {xAxis}
          <YAxis {...axisProps} width={52} tickFormatter={(v: number) => `$${formatCompact(v)}`} />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={labelFormatter(bucket)} valueFormatter={formatCost} />}
          />
          <Area
            dataKey="cost"
            type="monotone"
            fill="var(--color-cost)"
            fillOpacity={0.15}
            stroke="var(--color-cost)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={tokenConfig} className={className}>
      <AreaChart data={points} margin={{ top: 8, left: 0, right: 0 }}>
        {grid}
        {xAxis}
        <YAxis {...axisProps} width={44} tickFormatter={formatCompact} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={labelFormatter(bucket)} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area
          dataKey="inputTokens"
          type="monotone"
          stackId="t"
          fill="var(--color-inputTokens)"
          fillOpacity={0.15}
          stroke="var(--color-inputTokens)"
          strokeWidth={2}
        />
        <Area
          dataKey="outputTokens"
          type="monotone"
          stackId="t"
          fill="var(--color-outputTokens)"
          fillOpacity={0.15}
          stroke="var(--color-outputTokens)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
