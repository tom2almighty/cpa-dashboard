import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useBreakdown } from "@/hooks/use-usage";
import { formatCompact, formatCost } from "@/lib/format";
import type { BreakdownBy } from "@/lib/types";

export function displayKey(key: string, by: BreakdownBy): string {
  if (key) return key;
  return by === "apiKey" ? "无 API Key" : "未知";
}

// 概览页的排行:只显示前几名,占比条表示 token 份额
export function RankList({ by, title, limit = 6 }: { by: BreakdownBy; title: string; limit?: number }) {
  const { data, isPending } = useBreakdown(by);
  const rows = data?.slice(0, limit) ?? [];
  const max = rows[0]?.totalTokens ?? 0;

  return (
    <section aria-labelledby={`rank-${by}`}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id={`rank-${by}`} className="font-medium">
          {title}
        </h2>
        <Link to="/usage" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          查看全部
        </Link>
      </div>
      {isPending ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有请求</p>
      ) : (
        <ol className="grid gap-3">
          {rows.map((row) => (
            <li key={row.key} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate" title={row.key}>
                  {displayKey(row.key, by)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatCompact(row.totalTokens)}
                  <span className="ml-3 inline-block min-w-14 text-right text-foreground">
                    {row.unpricedRequests === row.requests ? "—" : formatCost(row.cost)}
                  </span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{ width: `${max > 0 ? Math.max((row.totalTokens / max) * 100, 1) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
