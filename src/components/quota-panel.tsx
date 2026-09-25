import { useQueries } from "@tanstack/react-query";
import { CircleAlert, OctagonAlert, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCountdown, formatDateTime, formatRelative } from "@/lib/format";
import { fetchQuota, type QuotaWindow, supportsQuota } from "@/lib/quota";
import type { AuthFile } from "@/lib/types";

export function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

// 用量越高越危险:80% 起提示,95% 起视为即将用尽;状态色始终配图标和文字
function level(used: number | null): "ok" | "warn" | "danger" {
  if (used === null) return "ok";
  if (used >= 95) return "danger";
  if (used >= 80) return "warn";
  return "ok";
}

const BAR = { ok: "bg-chart-1", warn: "bg-warning", danger: "bg-destructive" };

function Meter({ window: w }: { window: QuotaWindow }) {
  const state = level(w.usedPercent);
  const used = w.usedPercent === null ? null : Math.round(w.usedPercent);
  // 反转为剩余额度：满额度(used=0)对应满进度条(100%), 用尽(used=100)对应空进度条(0%)
  const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
  return (
    <li className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate" title={w.label}>
          {w.label}
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {state === "danger" && <OctagonAlert className="size-3.5 text-destructive" aria-hidden />}
          {state === "warn" && <CircleAlert className="size-3.5 text-warning" aria-hidden />}
          {remaining === null ? "—" : `剩余 ${remaining}%`}
          {state === "danger" && <span className="sr-only">，即将用尽</span>}
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
        <div className={`h-full rounded-full ${BAR[state]}`} style={{ width: `${remaining ?? 0}%` }} />
      </div>
      {(w.resetAt || w.detail) && (
        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span title={w.resetAt ? formatDateTime(w.resetAt) : undefined}>{formatCountdown(w.resetAt)}</span>
          {w.detail && <span className="tabular-nums">{w.detail}</span>}
        </div>
      )}
    </li>
  );
}

export function QuotaPanel({ files }: { files: AuthFile[] }) {
  const targets = files.filter((f) => supportsQuota(f) && !f.disabled);
  // ponytail: 所有账号同时查询,账号上百时再加并发限制
  const results = useQueries({
    queries: targets.map((file) => ({
      queryKey: ["quota", file.auth_index],
      queryFn: () => fetchQuota(file),
      staleTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  if (targets.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        没有可查询额度的账号。目前支持 Codex、Claude、Antigravity、Kimi、xAI 的 OAuth 账号。
      </p>
    );
  }

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
      {targets.map((file, i) => {
        const q = results[i];
        return (
          <section key={file.auth_index} aria-label={accountName(file)} className="min-w-0 border-t pt-4">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-medium" title={accountName(file)}>
                  {accountName(file)}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary">{file.provider}</Badge>
                  {q.data?.plan && <Badge variant="outline">{q.data.plan}</Badge>}
                  {q.dataUpdatedAt > 0 && <span>{formatRelative(q.dataUpdatedAt)}更新</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`刷新 ${accountName(file)} 的额度`}
                disabled={q.isFetching}
                onClick={() => q.refetch()}
              >
                <RefreshCw className={q.isFetching ? "animate-spin" : undefined} />
              </Button>
            </div>
            {q.isPending ? (
              <Skeleton className="h-24" />
            ) : q.isError ? (
              <p role="alert" className="text-sm break-words text-destructive">
                查询失败：{q.error.message}
              </p>
            ) : q.data.windows.length === 0 ? (
              <p className="text-sm text-muted-foreground">上游没有返回额度信息</p>
            ) : (
              <ul className="grid gap-4">
                {q.data.windows.map((w) => (
                  <Meter key={w.id} window={w} />
                ))}
              </ul>
            )}
            {q.data && q.data.notes.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">{q.data.notes.join("，")}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
