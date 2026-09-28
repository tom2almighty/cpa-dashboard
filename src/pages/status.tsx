import { useQueries, useQuery } from "@tanstack/react-query";
import { Activity, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { accountName } from "@/components/quota-panel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/context";
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
  const { t, language } = useI18n();
  const files = useQuery({
    queryKey: ["cpa", "auth-files"],
    queryFn: () => api<{ files: AuthFile[] }>("/v8/management/credentials"),
    select: (res) => res.files ?? [],
    refetchInterval: 30_000,
  });
  // 与提供商页、API Key 页共用缓存
  const providers = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: ["cpa", "providers", kind.endpoint],
      queryFn: () =>
        api<Json[]>(`/v8/management/config/api-keys/${encodeURIComponent(kind.endpoint)}`)
          .then((res) => ({ [kind.endpoint]: Array.isArray(res) ? res : [] }))
          .catch(() => ({ [kind.endpoint]: [] })),
    })),
  });
  const clientKeys = useQuery({
    queryKey: ["cpa", "api-keys"],
    queryFn: () => api<string[]>("/v8/management/config/access/api-keys"),
    select: (res) => (Array.isArray(res) ? res : []),
  });

  // v8: 内存实时用量队列流
  const [recentUsage, setRecentUsage] = useState<
    Array<{ id: string; model?: string; provider?: string; timestamp?: number; status?: string }>
  >([]);

  const usageQueue = useQuery({
    queryKey: ["cpa", "usage-queue"],
    queryFn: () =>
      api<Array<{ id?: string; model?: string; provider?: string; timestamp?: number; status?: string }>>(
        "/v8/management/observability/usage/queue?count=5",
      ).catch(() => []),
    refetchInterval: 5000,
    retry: false,
  });

  useEffect(() => {
    if (usageQueue.data && usageQueue.data.length > 0) {
      setRecentUsage((prev) => {
        const incoming = usageQueue.data.map((item, idx) => ({
          id: item.id || `${Date.now()}-${idx}-${Math.random()}`,
          model: item.model,
          provider: item.provider,
          timestamp: item.timestamp ?? Date.now(),
          status: item.status ?? "ok",
        }));
        return [...incoming, ...prev].slice(0, 10);
      });
    }
  }, [usageQueue.data]);

  if (!files.data) {
    return (
      <>
        <PageHeader title={t("overview.title")} />
        {files.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("overview.load_failed", { message: files.error.message })}
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
    const key = f.provider || t("overview.unknown_provider");
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
      <PageHeader title={t("overview.title")} />

      <section
        aria-label={t("overview.summary_label")}
        className="grid grid-cols-2 gap-x-4 gap-y-6 border-y py-6 sm:grid-cols-4 sm:gap-0 sm:divide-x"
      >
        <Stat
          label={t("overview.available_accounts")}
          value={`${formatInteger(active.length - attention.length)} / ${formatInteger(accounts.length)}`}
          detail={
            attention.length ? `${attention.length} ${t("overview.needs_attention_suffix")}` : t("overview.all_normal")
          }
        />
        <Stat label={t("overview.disabled_accounts")} value={formatInteger(accounts.length - active.length)} />
        <Stat
          label={t("overview.provider_keys")}
          value={providersReady ? formatInteger(configured.reduce((sum, p) => sum + p.count, 0)) : "—"}
          detail={
            providersReady
              ? configured.map((p) => `${p.label} ${p.count}`).join(t("overview.list_separator")) ||
                t("overview.not_configured")
              : undefined
          }
        />
        <Stat
          label={t("overview.client_api_keys")}
          value={clientKeys.data ? formatInteger(clientKeys.data.length) : "—"}
          detail={clientKeys.data?.length === 0 ? t("overview.not_configured") : undefined}
        />
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="distribution-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="distribution-title" className="font-medium">
              {t("overview.account_distribution")}
            </h2>
            <Link to="/auth-files" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              {t("overview.all_auth_files")}
            </Link>
          </div>
          {byProvider.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("overview.no_accounts")}</p>
          ) : (
            <ul className="divide-y">
              {byProvider.map(([provider, g]) => (
                <li key={provider} className="flex items-center gap-4 py-2.5">
                  <span className="w-28 truncate text-sm font-medium" title={provider}>
                    {provider}
                  </span>
                  <div aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-primary/20">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(g.usable / g.total) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 text-right text-sm tabular-nums">
                    {formatInteger(g.usable)} / {formatInteger(g.total)} {t("overview.usable")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="attention-title">
          <h2 id="attention-title" className="mb-3 font-medium">
            {t("overview.needs_attention")}
          </h2>
          {attention.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("overview.all_accounts_healthy")}</p>
          ) : (
            <ul className="divide-y">
              {attention.map((f) => (
                <li key={f.id || f.name} className="flex items-start gap-3 py-2.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{accountName(f)}</span>
                      <Badge variant={f.unavailable ? "destructive" : "secondary"}>
                        {f.unavailable ? t("overview.cooldown") : f.status}
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

      {/* v8 实时调用事件流监控 */}
      <section className="mt-10" aria-labelledby="live-stream-title">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h2 id="live-stream-title" className="font-medium text-base">
              {t("overview.live_requests")}
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">{t("overview.sync_interval")}</span>
        </div>
        {recentUsage.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
            {t("overview.no_recent_requests")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recentUsage.map((u) => (
              <li key={u.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {u.provider || "gateway"}
                  </Badge>
                  <span className="font-mono text-foreground truncate">{u.model || "unknown-model"}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                  <span
                    className={u.status === "error" ? "text-destructive font-medium" : "text-emerald-500 font-medium"}
                  >
                    {u.status === "error" ? t("overview.failed") : t("common.success")}
                  </span>
                  <span className="font-mono tabular-nums">
                    {new Date(u.timestamp ?? Date.now()).toLocaleTimeString(language)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
