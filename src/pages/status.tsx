import { useQueries, useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { accountName } from "@/components/quota-panel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatInteger } from "@/lib/format";
import { type Json, KINDS, list } from "@/lib/provider-form";
import type { AuthFile } from "@/lib/types";

function needsAttention(f: AuthFile): boolean {
  return !f.disabled && Boolean(f.unavailable || (f.status && f.status !== "ready" && f.status !== "active"));
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
  // 与提供商页、API Key 页共用缓存
  const providers = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: ["cpa", "providers", kind.endpoint],
      queryFn: () => api<Json>(`/v0/management/${kind.endpoint}`),
    })),
  });
  const clientKeys = useQuery({
    queryKey: ["cpa", "api-keys"],
    queryFn: () => api<{ "api-keys": string[] }>("/v0/management/api-keys"),
    select: (res) => res["api-keys"] ?? [],
  });

  if (!files.data) {
    return (
      <>
        <PageHeader title="运行概览" />
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
  const active = accounts.filter((f) => !f.disabled);
  const attention = accounts.filter(needsAttention);

  const groups = new Map<string, { total: number; usable: number }>();
  for (const f of accounts) {
    const key = f.provider || "未知";
    const g = groups.get(key) ?? { total: 0, usable: 0 };
    g.total += 1;
    if (!f.disabled && !needsAttention(f)) g.usable += 1;
    groups.set(key, g);
  }
  const byProvider = [...groups].sort((a, b) => b[1].total - a[1].total);

  const providersReady = providers.every((q) => !q.isPending);
  const configured = KINDS.map((kind, i) => ({
    label: kind.label,
    count: list(providers[i].data?.[kind.endpoint]).length,
  })).filter((p) => p.count > 0);

  return (
    <>
      <PageHeader title="运行概览" />

      <section
        aria-label="运行概况"
        className="grid grid-cols-2 gap-x-4 gap-y-6 border-y py-6 sm:grid-cols-4 sm:gap-0 sm:divide-x"
      >
        <Stat
          label="可用账号"
          value={`${formatInteger(active.length - attention.length)} / ${formatInteger(accounts.length)}`}
          detail={attention.length ? `${attention.length} 个需要处理` : "全部正常"}
        />
        <Stat label="已停用账号" value={formatInteger(accounts.length - active.length)} />
        <Stat
          label="API Key 提供商"
          value={providersReady ? formatInteger(configured.reduce((sum, p) => sum + p.count, 0)) : "—"}
          detail={
            providersReady ? configured.map((p) => `${p.label} ${p.count}`).join("、") || "还没有配置" : undefined
          }
        />
        <Stat
          label="客户端 API Key"
          value={clientKeys.data ? formatInteger(clientKeys.data.length) : "—"}
          detail={clientKeys.data?.length === 0 ? "还没有配置" : undefined}
        />
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="distribution-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="distribution-title" className="font-medium">
              账号分布
            </h2>
            <Link to="/auth-files" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              全部认证文件
            </Link>
          </div>
          {byProvider.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有账号</p>
          ) : (
            <ul className="divide-y">
              {byProvider.map(([provider, g]) => (
                <li key={provider} className="flex items-center gap-4 py-2.5">
                  <span className="w-28 truncate text-sm font-medium" title={provider}>
                    {provider}
                  </span>
                  <div aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${(g.usable / g.total) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 text-right text-sm tabular-nums">
                    {formatInteger(g.usable)} / {formatInteger(g.total)} 可用
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
