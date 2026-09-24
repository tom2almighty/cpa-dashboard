import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatInteger, formatRelative, formatUnitPrice } from "@/lib/format";
import type { PriceSnapshot } from "@/lib/types";

const num = "text-right tabular-nums";

export function PricesPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["prices"],
    queryFn: () => api<PriceSnapshot>("/api/prices"),
  });
  const sync = useMutation({
    mutationFn: () => api<PriceSnapshot>("/api/prices/sync", { method: "POST" }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["prices"], snapshot);
      queryClient.invalidateQueries({ queryKey: ["usage"] });
      toast.success(`已同步 ${formatInteger(snapshot.catalogSize)} 个模型的价格`);
    },
  });

  const unmatched = data?.models.filter((m) => !m.price).length ?? 0;

  return (
    <>
      <PageHeader
        title="模型价格"
        description={
          data?.syncedAt
            ? `价格来自 LiteLLM，${formatRelative(data.syncedAt)}同步，共 ${formatInteger(data.catalogSize)} 个模型。单位：美元 / 百万 token。`
            : "价格来自 LiteLLM，服务启动后自动同步。"
        }
        actions={
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || data?.syncing}>
            {sync.isPending ? <Spinner /> : <RefreshCw />}
            立即同步
          </Button>
        }
      />

      {data?.lastError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          上次同步失败：{data.lastError}
        </p>
      )}
      {unmatched > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {unmatched} 个模型在 LiteLLM 里找不到价格，它们的请求不计入费用。
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型</TableHead>
            <TableHead>匹配到的价格</TableHead>
            <TableHead className="text-right">请求数</TableHead>
            <TableHead className="text-right">输入</TableHead>
            <TableHead className="text-right">输出</TableHead>
            <TableHead className="text-right">缓存读取</TableHead>
            <TableHead className="text-right">缓存写入</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={7} />
          ) : !data?.models.length ? (
            <EmptyRow columns={7}>还没有请求记录，有请求后这里会列出用到的模型。</EmptyRow>
          ) : (
            data.models.map((m) => (
              <TableRow key={m.model}>
                <TableCell className="font-medium">{m.model || "未知"}</TableCell>
                <TableCell>
                  {m.price ? (
                    <span className="text-muted-foreground">
                      {m.price.matched}
                      {m.price.provider && m.price.provider !== m.price.matched.split("/")[0] && (
                        <Badge variant="outline" className="ml-2">
                          {m.price.provider}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <Badge variant="destructive">未匹配</Badge>
                  )}
                </TableCell>
                <TableCell className={num}>{formatInteger(m.requests)}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.input) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.output) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.cacheRead) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.cacheCreation) : "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
