import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { RangePicker } from "@/components/range-picker";
import { displayKey } from "@/components/rank-list";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type EventFilters, useBreakdown, useEvents } from "@/hooks/use-usage";
import { ApiError, download } from "@/lib/api";
import {
  formatCompact,
  formatCost,
  formatDateTime,
  formatInteger,
  formatLatency,
  formatPercent,
  successRate,
} from "@/lib/format";
import type { BreakdownBy } from "@/lib/types";

const DIMENSIONS: { value: BreakdownBy; label: string }[] = [
  { value: "model", label: "模型" },
  { value: "account", label: "账号" },
  { value: "apiKey", label: "API Key" },
  { value: "provider", label: "提供商" },
];

const num = "text-right tabular-nums";

function BreakdownTable() {
  const [by, setBy] = useState<BreakdownBy>("model");
  const { data, isPending } = useBreakdown(by);
  const totalTokens = data?.reduce((sum, row) => sum + row.totalTokens, 0) ?? 0;

  return (
    <>
      <Tabs value={by} onValueChange={(value) => setBy(value as BreakdownBy)} className="mb-4">
        <TabsList>
          {DIMENSIONS.map((d) => (
            <TabsTrigger key={d.value} value={d.value}>
              按{d.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{DIMENSIONS.find((d) => d.value === by)?.label}</TableHead>
            <TableHead className="text-right">请求</TableHead>
            <TableHead className="text-right">成功率</TableHead>
            <TableHead className="text-right">输入</TableHead>
            <TableHead className="text-right">输出</TableHead>
            <TableHead className="text-right">缓存命中</TableHead>
            <TableHead className="text-right">Token 占比</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead className="text-right">平均耗时</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={9} />
          ) : !data?.length ? (
            <EmptyRow columns={9}>这段时间没有请求</EmptyRow>
          ) : (
            data.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-72 truncate font-medium" title={row.key}>
                  {displayKey(row.key, by)}
                </TableCell>
                <TableCell className={num}>{formatInteger(row.requests)}</TableCell>
                <TableCell className={num}>
                  <span className={row.failed > 0 ? "text-destructive" : undefined}>
                    {formatPercent(successRate(row))}
                  </span>
                </TableCell>
                <TableCell className={num}>{formatCompact(row.inputTokens)}</TableCell>
                <TableCell className={num}>{formatCompact(row.outputTokens)}</TableCell>
                <TableCell className={num}>
                  {formatPercent(row.inputTokens ? row.cacheReadTokens / row.inputTokens : Number.NaN)}
                </TableCell>
                <TableCell className={num}>{formatPercent(totalTokens ? row.totalTokens / totalTokens : 0)}</TableCell>
                <TableCell className={num}>
                  {row.unpricedRequests === row.requests ? (
                    <span className="text-muted-foreground">无价格</span>
                  ) : (
                    formatCost(row.cost)
                  )}
                </TableCell>
                <TableCell className={num}>{formatLatency(row.avgLatencyMs)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const items = [{ value: "", label: `全部${label}` }, ...options];
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger size="sm" aria-label={label} className="w-full sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAGE_SIZE = 50;

function EventTable() {
  const [filters, setFilters] = useState<EventFilters>({});
  const [page, setPage] = useState(0);
  const models = useBreakdown("model").data ?? [];
  const accounts = useBreakdown("account").data ?? [];
  const { data, isPending, isPlaceholderData } = useEvents(filters, page, PAGE_SIZE);
  const pages = Math.max(Math.ceil((data?.total ?? 0) / PAGE_SIZE), 1);

  function update(patch: EventFilters) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }

  return (
    <>
      <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap">
        <FilterSelect
          label="模型"
          value={filters.model ?? ""}
          options={models.filter((m) => m.key).map((m) => ({ value: m.key, label: m.key }))}
          onChange={(model) => update({ model })}
        />
        <FilterSelect
          label="账号"
          value={filters.account ?? ""}
          options={accounts.filter((a) => a.key).map((a) => ({ value: a.key, label: a.key }))}
          onChange={(account) => update({ account })}
        />
        <FilterSelect
          label="状态"
          value={filters.status ?? ""}
          options={[
            { value: "success", label: "成功" },
            { value: "failed", label: "失败" },
          ]}
          onChange={(status) => update({ status })}
        />
      </div>
      <Table className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>账号</TableHead>
            <TableHead>API Key</TableHead>
            <TableHead className="text-right">输入</TableHead>
            <TableHead className="text-right">缓存</TableHead>
            <TableHead className="text-right">输出</TableHead>
            <TableHead className="text-right">耗时</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">请求日志</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={11} />
          ) : !data?.items.length ? (
            <EmptyRow columns={11}>没有符合条件的请求</EmptyRow>
          ) : (
            data.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums text-muted-foreground">{formatDateTime(e.ts)}</TableCell>
                <TableCell
                  className="max-w-56 truncate"
                  title={e.alias && e.alias !== e.model ? `请求模型：${e.alias}` : e.model}
                >
                  {e.model || "未知"}
                </TableCell>
                <TableCell className="max-w-56 truncate" title={e.account}>
                  {e.account || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.apiKey || "—"}</TableCell>
                <TableCell className={num}>{formatInteger(e.inputTokens)}</TableCell>
                <TableCell className={num}>{formatInteger(e.cacheReadTokens)}</TableCell>
                <TableCell className={num}>{formatInteger(e.outputTokens)}</TableCell>
                <TableCell className={num}>{formatLatency(e.latencyMs)}</TableCell>
                <TableCell className={num}>{e.cost === null ? "—" : formatCost(e.cost)}</TableCell>
                <TableCell>
                  {e.failed ? <Badge variant="destructive">失败</Badge> : <Badge variant="secondary">成功</Badge>}
                </TableCell>
                <TableCell>
                  {e.requestId && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="下载这次请求的日志"
                      title="下载这次请求的日志"
                      onClick={() =>
                        download(
                          `/v0/management/request-log-by-id/${encodeURIComponent(e.requestId)}`,
                          `request-${e.requestId}.log`,
                        ).catch((error: Error) =>
                          toast.error(
                            error instanceof ApiError && error.status === 404
                              ? "找不到这次请求的日志，需要在 CPA 中开启请求日志"
                              : error.message,
                          ),
                        )
                      }
                    >
                      <FileText />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          共 {formatInteger(data?.total ?? 0)} 条，第 {page + 1} / {pages} 页
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="上一页"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="下一页"
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </>
  );
}

export function UsagePage() {
  return (
    <>
      <PageHeader title="用量" actions={<RangePicker />} />
      <Tabs defaultValue="breakdown">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="breakdown">分组统计</TabsTrigger>
          <TabsTrigger value="events">请求明细</TabsTrigger>
        </TabsList>
        <TabsContent value="breakdown">
          <BreakdownTable />
        </TabsContent>
        <TabsContent value="events">
          <EventTable />
        </TabsContent>
      </Tabs>
    </>
  );
}
