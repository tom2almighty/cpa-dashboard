import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Trans } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCopiedState } from "@/hooks/use-copied-state";
import { useI18n } from "@/i18n/context";
import { api, configQuery, errorText } from "@/lib/api";

type V1Model = { id: string };

const byName = new Intl.Collator(undefined, { numeric: true }).compare;

export function AvailableModels() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { copied, mark } = useCopiedState();

  // /v1/models 要客户端密钥,取第一个 access.api-keys;没有就不带(服务端未开启鉴权时仍可访问)
  const clientKey = useQuery({
    ...configQuery,
    select: (c) => (c.access as { "api-keys"?: string[] } | undefined)?.["api-keys"]?.[0] ?? "",
  });
  // /v1/models 按模型 ID 去重,owned_by 只是其中一个提供方,所以只列模型名
  const { data, isPending, isError, error, isRefetching } = useQuery({
    queryKey: ["cpa", "v1-models", clientKey.data],
    enabled: !clientKey.isPending,
    queryFn: async () => {
      const res = await api<{ data?: V1Model[]; models?: V1Model[] } | V1Model[]>("/v1/models", {
        headers: clientKey.data ? { Authorization: `Bearer ${clientKey.data}` } : undefined,
      });
      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.models)
            ? res.models
            : [];
      return list.map((m) => m.id).sort(byName);
    },
    staleTime: 60_000,
  });

  const models = useMemo(() => {
    const term = search.toLowerCase().trim();
    return term ? (data ?? []).filter((id) => id.toLowerCase().includes(term)) : (data ?? []);
  }, [data, search]);

  const copy = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      mark(id);
      toast.success(t("models.copied_model", { id }));
    });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["cpa", "v1-models"] });
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="models.available_hint"
              components={{ code: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" /> }}
            />
          </p>
          {data && (
            <Badge variant="secondary" className="tabular-nums">
              {t("models.total_models", { count: data.length })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("models.search")}
            aria-label={t("models.search")}
            className="w-48 sm:w-64"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={isPending || isRefetching}
            aria-label={t("common.refresh")}
          >
            {isPending || isRefetching ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-40" />
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("models.fetch_failed", { message: errorText(error) })}
        </p>
      ) : models.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {search.trim() ? t("models.no_matching_models") : t("models.no_available")}
        </p>
      ) : (
        <ul className="columns-xs gap-x-6">
          {models.map((id) => (
            <li key={id} className="break-inside-avoid">
              <Button
                variant="ghost"
                title={id}
                aria-label={t("models.copy_aria", { id })}
                onClick={() => copy(id)}
                className="w-full justify-between font-mono font-normal"
              >
                <span className="truncate">{id}</span>
                {copied === id ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
