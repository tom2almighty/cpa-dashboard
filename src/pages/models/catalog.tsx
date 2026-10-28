import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/context";
import { api, errorText } from "@/lib/api";
import { CHANNELS, SuggestInput, useCatalog } from "./shared";

// ---------- 模型目录 ----------

type CatalogRefreshResult = { changed_providers?: string[] };

export function Catalog() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState(CHANNELS[0]);
  const { data, isPending, isError, error } = useCatalog(channel);
  const refresh = useMutation({
    mutationFn: () => api<CatalogRefreshResult>("/v8/management/routing/model-definitions/refresh", { method: "POST" }),
    onSuccess: (result) => {
      const changed = result.changed_providers ?? [];
      toast.success(
        changed.length
          ? t("models.catalog_refreshed_changed", { providers: changed.join(", ") })
          : t("models.catalog_refreshed"),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["cpa", "model-definitions"] });
      void queryClient.invalidateQueries({ queryKey: ["cpa", "v1-models"] });
    },
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("models.catalog_hint")}</p>
        <div className="flex items-center gap-2">
          {/* 渠道既可能是内置渠道，也可能是插件执行器注册的 provider，故允许直接输入 */}
          <div className="w-44 shrink-0">
            <SuggestInput
              id="catalog-channel"
              ariaLabel={t("models.select_channel")}
              value={channel}
              onChange={(v) => setChannel(v.trim().toLowerCase())}
              options={CHANNELS}
              placeholder={t("models.channel_placeholder")}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            aria-label={t("models.refresh_catalog")}
            title={t("models.refresh_catalog")}
          >
            {refresh.isPending ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("models.th_model")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("models.display_name")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("models.th_owner")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!channel ? (
            <EmptyRow columns={3}>{t("models.catalog_channel_required")}</EmptyRow>
          ) : isPending ? (
            <SkeletonRows columns={3} />
          ) : isError ? (
            <EmptyRow columns={3}>{t("models.catalog_error", { message: errorText(error) })}</EmptyRow>
          ) : data.length === 0 ? (
            <EmptyRow columns={3}>{t("models.no_models")}</EmptyRow>
          ) : (
            data.map((m) => (
              <TableRow key={m.id}>
                {/* 模型 ID 本身可能很长，窄屏把显示名称与提供方折到它下面，避免整表横向滚动 */}
                <TableCell className="font-mono text-sm">
                  <span className="block break-all whitespace-normal">{m.id}</span>
                  <span className="mt-0.5 block font-sans text-xs font-normal text-muted-foreground sm:hidden">
                    {[m.display_name, m.owned_by].filter(Boolean).join(" · ")}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{m.display_name || "—"}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{m.owned_by || "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
