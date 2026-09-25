import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Pencil, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { PriceBindDialog } from "@/components/price-bind-dialog";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInteger, formatRelative, formatUnitPrice } from "@/lib/format";
import { loadFrontendPriceSnapshot } from "@/lib/prices";
import type { ModelPrice } from "@/lib/types";

const num = "text-right tabular-nums";
export function PricesPage() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ["prices"],
    queryFn: () => loadFrontendPriceSnapshot(),
    staleTime: 60_000,
  });
  const sync = useMutation({
    mutationFn: () => loadFrontendPriceSnapshot(true),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["prices"], snapshot);
      toast.success(`已同步 ${formatInteger(snapshot.catalogSize)} 个模型的价格`);
    },
  });
  const [search, setSearch] = useState("");
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [bindingTarget, setBindingTarget] = useState<ModelPrice | null>(null);
  const filteredModels = useMemo(() => {
    let list = data?.models ?? [];
    if (onlyUsed) list = list.filter((m) => m.requests > 0);
    if (!search.trim()) return list;
    const term = search.toLowerCase().trim();
    return list.filter(
      (m) =>
        m.model.toLowerCase().includes(term) ||
        m.price?.matched.toLowerCase().includes(term) ||
        m.price?.provider.toLowerCase().includes(term),
    );
  }, [data?.models, search, onlyUsed]);

  const copy = (name: string) => {
    navigator.clipboard.writeText(name).then(() => {
      setCopied(name);
      toast.success(`已复制模型名：${name}`);
      setTimeout(() => setCopied(null), 2000);
    });
  };

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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {data && (
            <Badge variant="secondary" className="tabular-nums">
              共 {data.models.length} 个模型
            </Badge>
          )}
          {data?.models.some((m) => m.requests > 0) && (
            <div className="flex items-center gap-2">
              <Checkbox id="only-used" checked={onlyUsed} onCheckedChange={(c) => setOnlyUsed(Boolean(c))} />
              <Label htmlFor="only-used" className="cursor-pointer text-sm text-muted-foreground select-none">
                仅显示有请求记录 ({data.models.filter((m) => m.requests > 0).length})
              </Label>
            </div>
          )}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索模型名称或提供商..."
          className="w-48 sm:w-64"
        />
      </div>

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
            <TableHead className="w-16 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={8} />
          ) : !data?.models.length ? (
            <EmptyRow columns={8}>暂未获取到支持的模型，请检查 CPA 服务运行状态与账号配置。</EmptyRow>
          ) : filteredModels.length === 0 ? (
            <EmptyRow columns={8}>未找到符合筛选条件的模型</EmptyRow>
          ) : (
            filteredModels.map((m) => (
              <TableRow key={m.model}>
                <TableCell className="font-mono text-sm font-medium">{m.model || "未知"}</TableCell>
                <TableCell>
                  {m.price ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-muted-foreground">{m.price.matched}</span>
                      {m.source === "custom" && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 text-primary">
                          自定义
                        </Badge>
                      )}
                      {m.source === "mapped" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 text-chart-1">
                          已绑定
                        </Badge>
                      )}
                      {m.price.provider && m.price.provider !== m.price.matched.split("/")[0] && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">
                          {m.price.provider}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-5 text-muted-foreground hover:text-foreground"
                        aria-label={`调整单价：${m.model}`}
                        title="调整或自定义单价"
                        onClick={() => setBindingTarget(m)}
                      >
                        <Pencil className="size-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="destructive"
                        className="cursor-pointer hover:opacity-85 text-[11px]"
                        title="点击智能匹配或自定义单价"
                        onClick={() => setBindingTarget(m)}
                      >
                        未匹配 · 点击设置
                      </Badge>
                    </div>
                  )}
                </TableCell>
                <TableCell className={num}>
                  {m.requests > 0 ? formatInteger(m.requests) : <span className="text-muted-foreground">0</span>}
                </TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.input) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.output) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.cacheRead) : "—"}</TableCell>
                <TableCell className={num}>{m.price ? formatUnitPrice(m.price.cacheCreation) : "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-xs" aria-label={`复制 ${m.model}`} onClick={() => copy(m.model)}>
                    {copied === m.model ? <Check className="text-primary" /> : <Copy />}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {bindingTarget && (
        <PriceBindDialog
          model={bindingTarget.model}
          currentPrice={bindingTarget.price}
          currentSource={bindingTarget.source}
          onClose={() => setBindingTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["prices"] })}
        />
      )}
    </>
  );
}
