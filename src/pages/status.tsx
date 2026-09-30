import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { accountName } from "@/components/quota-panel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { configQuery } from "@/lib/api";
import { useCredentials } from "@/lib/credentials";
import { formatInteger } from "@/lib/format";
import { type Json, KINDS, list } from "@/lib/provider-form";
import { type AuthFile, authState } from "@/lib/types";

// refreshing、pending 是正常的中间状态,不算需要处理
function needsAttention(f: AuthFile): boolean {
  const state = authState(f);
  return state === "cooldown" || state === "error";
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
  const { t } = useI18n();
  const { files: data, total, isPending, isError, error, isComplete } = useCredentials({ refetchInterval: 30_000 });
  // 提供商分组数与客户端密钥数都从共用的配置缓存里取
  const config = useQuery({
    ...configQuery,
    select: (c) => {
      const groups = (c["api-keys"] ?? {}) as Json;
      return {
        providers: KINDS.map((kind) => ({ label: kind.label, count: list(groups[kind.endpoint]).length })).filter(
          (p) => p.count > 0,
        ),
        clientKeys: list(((c.access ?? {}) as Json)["api-keys"]).length,
      };
    },
  });

  if (isPending || isError) {
    return (
      <>
        <PageHeader title={t("overview.title")} />
        {isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t("overview.load_failed", { message: error?.message ?? "" })}
          </p>
        ) : (
          <Skeleton className="h-96" />
        )}
      </>
    );
  }

  const accounts = data;
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

  return (
    <>
      <PageHeader title={t("overview.title")} />

      {!isComplete && (
        <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          {t("common.loading_progress", { loaded: formatInteger(accounts.length), total: formatInteger(total) })}
        </p>
      )}

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
          value={config.data ? formatInteger(config.data.providers.reduce((sum, p) => sum + p.count, 0)) : "—"}
          detail={
            config.data
              ? config.data.providers.map((p) => `${p.label} ${p.count}`).join(t("overview.list_separator")) ||
                t("overview.not_configured")
              : undefined
          }
        />
        <Stat
          label={t("overview.client_api_keys")}
          value={config.data ? formatInteger(config.data.clientKeys) : "—"}
          detail={config.data?.clientKeys === 0 ? t("overview.not_configured") : undefined}
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
                      <Badge variant="destructive">
                        {authState(f) === "cooldown" ? t("overview.cooldown") : t("auth_files.status_auth_error")}
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
