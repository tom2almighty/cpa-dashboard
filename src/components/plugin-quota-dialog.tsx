import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { accountName, MeterRow } from "@/components/quota-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/i18n/context";
import { errorText } from "@/lib/api";
import { CREDENTIALS_KEY, useCredentials } from "@/lib/credentials";
import { formatRelative } from "@/lib/format";
import { fetchPluginQuota, resetPluginQuota } from "@/lib/quota";

/**
 * 插件自有额度:CPA 的 /plugins/:id/quota 按 (插件, auth_index) 定位,
 * 因此这里挑出 provider 与插件额度提供方同名的凭据逐个查询。
 */
export function PluginQuotaContent({ pluginId, provider }: { pluginId: string; provider: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { files, isComplete } = useCredentials();

  const targets = files.filter((f) => (f.provider ?? "").toLowerCase() === provider.toLowerCase() && f.auth_index);

  const results = useQueries({
    queries: targets.map((file) => ({
      queryKey: ["plugin-quota", pluginId, file.auth_index],
      queryFn: () => fetchPluginQuota(pluginId, file.auth_index ?? ""),
      staleTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const reset = useMutation({
    mutationFn: (authIndex: string) => resetPluginQuota(pluginId, authIndex),
    onSuccess: (res, authIndex) => {
      toast.success(
        t("plugins.quota_reset_done", {
          message: res.message ? t("quota.reset_message", { message: res.message }) : "",
        }),
      );
      queryClient.invalidateQueries({ queryKey: ["plugin-quota", pluginId, authIndex] });
      queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
    },
    onError: (error: Error) => toast.error(t("plugins.quota_reset_failed", { message: errorText(error) })),
    meta: { quiet: true },
  });

  return (
    <>
      {targets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {isComplete ? t("plugins.quota_no_credentials") : t("plugins.quota_loading")}
        </p>
      ) : (
        <div className="max-h-[65svh] space-y-4 overflow-y-auto pr-1">
          {targets.map((file, i) => {
            const q = results[i];
            const busy = reset.isPending && reset.variables === file.auth_index;
            return (
              <section key={file.auth_index} className="rounded-lg border p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium" title={accountName(file)}>
                      {accountName(file)}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[11px] font-normal uppercase">
                        {provider}
                      </Badge>
                      {q?.data?.plan && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          {q.data.plan}
                        </Badge>
                      )}
                      {q && q.dataUpdatedAt > 0 && (
                        <span>{t("quota.updated_ago", { time: formatRelative(q.dataUpdatedAt) })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("quota.reset_hint")}
                      aria-label={t("plugins.quota_reset_named", { name: accountName(file) })}
                      disabled={busy}
                      onClick={() => reset.mutate(file.auth_index ?? "")}
                    >
                      {busy ? <Spinner className="size-3.5" /> : <RotateCcw />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("quota.refresh_account", { name: accountName(file) })}
                      disabled={q?.isFetching}
                      onClick={() => q?.refetch()}
                    >
                      <RefreshCw className={q?.isFetching ? "animate-spin" : undefined} />
                    </Button>
                  </div>
                </div>

                {q?.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : q?.isError ? (
                  <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                    <p className="font-medium">{t("quota.query_failed")}</p>
                    <p className="mt-1 break-words opacity-90">{errorText(q.error)}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-6 text-xs text-destructive hover:bg-destructive/15"
                      onClick={() => q?.refetch()}
                    >
                      {t("quota.retry")}
                    </Button>
                  </div>
                ) : (q?.data?.windows ?? []).length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t("quota.no_details")}</p>
                ) : (
                  <div className="flex flex-col gap-3.5">
                    {q?.data?.windows.map((w) => (
                      <MeterRow key={w.id} window={w} />
                    ))}
                  </div>
                )}

                {q?.data && q.data.notes.length > 0 && (
                  <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">{q.data.notes.join("，")}</div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

export function PluginQuotaDialog({
  pluginId,
  provider,
  title,
  onClose,
}: {
  pluginId: string;
  provider: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <PluginQuotaContent pluginId={pluginId} provider={provider} />
      </DialogContent>
    </Dialog>
  );
}
