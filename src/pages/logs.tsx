import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyRow, SkeletonRows } from "@/components/table-rows";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, formatInteger } from "@/lib/format";

type LogsResponse = { lines: string[]; "next-cursor"?: string; "cursor-reset"?: boolean };

const POLL_MS = 3000;
// ponytail: 只保留最近的行,量再大需要虚拟列表
const MAX_LINES = 3000;

function lineClass(line: string): string | undefined {
  if (/\b(error|fatal|panic)\b/i.test(line)) return "text-destructive";
  if (/\bwarn(ing)?\b/i.test(line)) return "bg-warning/10";
  return undefined;
}

function LiveLogs() {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState("");
  const [generation, setGeneration] = useState(0);
  const cursor = useRef<string | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation 变化时从头重新拉取
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const used = cursor.current;
        const query = used ? `cursor=${encodeURIComponent(used)}&limit=1000` : "limit=500";
        const res = await api<LogsResponse>(`/v0/management/logs?${query}`);
        if (stopped) return;
        cursor.current = res["next-cursor"];
        // 没带游标(或游标失效)时返回的是最新的一段,直接替换
        setLines((prev) => (used && !res["cursor-reset"] ? [...prev, ...res.lines] : res.lines).slice(-MAX_LINES));
        setError(null);
      } catch (e) {
        if (!stopped) setError(e as Error);
      }
    }
    tick();
    const id = live ? setInterval(tick, POLL_MS) : undefined;
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [live, generation]);

  // 用户停在底部时自动跟随新日志
  // biome-ignore lint/correctness/useExhaustiveDependencies: 行数变化时滚动
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);

  function restart() {
    cursor.current = undefined;
    setLines([]);
    setGeneration((g) => g + 1);
  }

  const enable = useMutation({
    mutationFn: () => api("/v0/management/logging-to-file", { method: "PUT", body: { value: true } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      restart();
    },
  });

  const clear = useMutation({
    mutationFn: () => api("/v0/management/logs", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("日志已清空");
      restart();
    },
  });

  if (error instanceof ApiError && error.status === 400 && /disabled/i.test(error.message)) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-muted-foreground">CPA 没有把日志写入文件，所以这里读不到日志。</p>
        <Button onClick={() => enable.mutate()} disabled={enable.isPending}>
          开启日志写入文件
        </Button>
      </div>
    );
  }

  const keyword = filter.trim().toLowerCase();
  const shown = keyword ? lines.filter((l) => l.toLowerCase().includes(keyword)) : lines;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选日志"
          aria-label="筛选日志"
          className="w-full sm:w-72"
        />
        <Button variant="outline" onClick={() => setLive((v) => !v)}>
          {live ? <Pause /> : <Play />}
          {live ? "暂停刷新" : "继续刷新"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline" />}>
            <Trash2 />
            清空日志
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空日志</AlertDialogTitle>
              <AlertDialogDescription>会删除 CPA 的轮换日志并清空当前日志文件，无法恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => clear.mutate()}>
                清空
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {keyword ? `${formatInteger(shown.length)} / ` : ""}
          {formatInteger(lines.length)} 行
        </span>
      </div>
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          读取日志失败：{error.message}
        </p>
      )}
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-[65svh] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
      >
        {shown.length === 0 ? (
          <p className="py-10 text-center font-sans text-sm text-muted-foreground">没有日志</p>
        ) : (
          shown.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 日志行可能重复,只追加不重排
            <div key={i} className={`whitespace-pre-wrap break-all ${lineClass(line) ?? ""}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </>
  );
}

function ErrorLogFiles() {
  const { data, isPending } = useQuery({
    queryKey: ["cpa", "request-error-logs"],
    queryFn: () =>
      api<{ files?: { name: string; size: number; modified: number }[] }>("/v0/management/request-error-logs"),
    select: (res) => res.files ?? [],
  });
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">关闭请求日志时，CPA 只把失败的请求记录到这些文件里。</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>文件</TableHead>
            <TableHead className="text-right">大小</TableHead>
            <TableHead>修改时间</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">下载</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <SkeletonRows columns={4} />
          ) : !data?.length ? (
            <EmptyRow columns={4}>没有错误请求日志</EmptyRow>
          ) : (
            data.map((f) => (
              <TableRow key={f.name}>
                <TableCell className="font-mono text-sm">{f.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(Math.ceil(f.size / 1024))} KB</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {formatDateTime(f.modified * 1000)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`下载 ${f.name}`}
                    nativeButton={false}
                    render={<a href={`/v0/management/request-error-logs/${encodeURIComponent(f.name)}`} download />}
                  >
                    <Download />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}

export function LogsPage() {
  return (
    <>
      <PageHeader title="日志" />
      <Tabs defaultValue="live">
        <TabsList variant="line" className="mb-6">
          <TabsTrigger value="live">运行日志</TabsTrigger>
          <TabsTrigger value="errors">错误请求日志</TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          <LiveLogs />
        </TabsContent>
        <TabsContent value="errors">
          <ErrorLogFiles />
        </TabsContent>
      </Tabs>
    </>
  );
}
