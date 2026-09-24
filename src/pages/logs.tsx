import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Download, Pause, Play, Search, Trash2 } from "lucide-react";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api, download } from "@/lib/api";
import { formatDateTime, formatInteger } from "@/lib/format";
import { appendLines, type Level, type LogEntry } from "@/lib/log-parse";

type LogsResponse = { lines: string[]; "next-cursor"?: string; "cursor-reset"?: boolean };

const POLL_MS = 3000;
// ponytail: 只保留最近的条目,行渲染靠 content-visibility 跳过屏幕外的布局,量再大需要虚拟列表
const MAX_ENTRIES = 3000;

const LEVELS: { value: Level | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "error", label: "错误" },
  { value: "warn", label: "警告" },
  { value: "info", label: "信息" },
  { value: "debug", label: "调试" },
];

const LEVEL_TEXT: Record<Level, string> = {
  error: "text-destructive",
  warn: "text-warning-foreground",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

const ROW_TINT: Record<Level, string> = {
  error: "bg-destructive/5",
  warn: "bg-warning/10",
  info: "",
  debug: "",
};

async function downloadRequestLog(id: string) {
  try {
    await download(`/v0/management/request-log-by-id/${encodeURIComponent(id)}`, `request-${id}.log`);
  } catch (error) {
    toast.error(
      error instanceof ApiError && error.status === 404
        ? "找不到这次请求的日志，需要在配置中开启请求日志"
        : (error as Error).message,
    );
  }
}

// 网关访问日志以状态码开头,按 2xx/4xx/5xx 着色
function Message({ text }: { text: string }) {
  const m = /^(\d{3})(\s+\|.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  const code = Number(m[1]);
  const color = code >= 500 ? "text-destructive" : code >= 400 ? "text-warning-foreground" : "text-success";
  return (
    <>
      <span className={`font-medium ${color}`}>{m[1]}</span>
      {m[2]}
    </>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div
      className={`flex gap-3 px-3 py-0.5 hover:bg-muted/60 ${ROW_TINT[entry.level]}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 1.25rem" }}
    >
      <span className="w-[4.5rem] shrink-0 text-muted-foreground tabular-nums">{entry.time.slice(11) || "—"}</span>
      <span className={`w-10 shrink-0 ${LEVEL_TEXT[entry.level]}`}>{entry.level}</span>
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        {entry.requestId && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => entry.requestId && downloadRequestLog(entry.requestId)}
                  className="mr-2 rounded-sm text-chart-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
              }
            >
              {entry.requestId}
            </TooltipTrigger>
            <TooltipContent>下载这次请求的完整日志</TooltipContent>
          </Tooltip>
        )}
        <Message text={entry.message} />
      </span>
      {entry.caller && (
        <span className="hidden shrink-0 text-muted-foreground/70 lg:inline" title={entry.caller}>
          {entry.caller}
        </span>
      )}
    </div>
  );
}

function LiveLogs() {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [live, setLive] = useState(true);
  const [level, setLevel] = useState<Level | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [generation, setGeneration] = useState(0);
  const [behind, setBehind] = useState(false);
  const cursor = useRef<string | undefined>(undefined);
  const nextId = useRef(1);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const deferredKeyword = useDeferredValue(keyword);

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation 变化时从头重新拉取
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const used = cursor.current;
        const query = used ? `cursor=${encodeURIComponent(used)}&limit=1000` : "limit=1000";
        const res = await api<LogsResponse>(`/v0/management/logs?${query}`);
        if (stopped) return;
        cursor.current = res["next-cursor"];
        // 没带游标(或游标失效)时返回的是最新的一段,直接替换
        const replace = !used || res["cursor-reset"];
        if (res.lines.length > 0 || replace) {
          setEntries((prev) => {
            const next = appendLines(replace ? [] : prev, res.lines, nextId.current, MAX_ENTRIES);
            nextId.current = (next.at(-1)?.id ?? nextId.current) + 1;
            return next;
          });
        }
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

  const counts = useMemo(() => {
    const c: Record<Level, number> = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const e of entries) c[e.level]++;
    return c;
  }, [entries]);

  const shown = useMemo(() => {
    const k = deferredKeyword.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (level === "all" || e.level === level) &&
        (!k || e.message.toLowerCase().includes(k) || e.requestId?.includes(k) || e.caller.includes(k)),
    );
  }, [entries, level, deferredKeyword]);

  // 停在底部时跟随新日志;往上翻了就只提示有新内容
  // biome-ignore lint/correctness/useExhaustiveDependencies: 条目变化时处理滚动
  useEffect(() => {
    if (!box.current) return;
    if (stick.current) box.current.scrollTop = box.current.scrollHeight;
    else setBehind(true);
  }, [shown.length, shown.at(-1)?.id]);

  function toBottom() {
    if (!box.current) return;
    box.current.scrollTop = box.current.scrollHeight;
    stick.current = true;
    setBehind(false);
  }

  function restart() {
    cursor.current = undefined;
    setEntries([]);
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
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">CPA 没有把日志写入文件，所以这里读不到日志。</p>
        <Button onClick={() => enable.mutate()} disabled={enable.isPending}>
          开启日志写入文件
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索内容、请求 ID"
            aria-label="搜索日志"
            className="pl-8"
          />
        </div>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="按级别筛选"
          value={[level]}
          onValueChange={(v) => v[0] && setLevel(v[0] as Level | "all")}
        >
          {LEVELS.map((l) => (
            <ToggleGroupItem key={l.value} value={l.value} className="gap-1.5 px-2.5">
              {l.label}
              {l.value !== "all" && counts[l.value] > 0 && (
                <span className={`tabular-nums ${LEVEL_TEXT[l.value]}`}>{formatInteger(counts[l.value])}</span>
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span
              aria-hidden
              className={`size-2 rounded-full ${live ? "bg-success motion-safe:animate-pulse" : "bg-muted-foreground/40"}`}
            />
            {live ? "实时" : "已暂停"}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={live ? "暂停刷新" : "继续刷新"}
            onClick={() => setLive((v) => !v)}
          >
            {live ? <Pause /> : <Play />}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="icon" aria-label="清空日志" />}>
              <Trash2 />
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
        </div>
      </div>
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          读取日志失败：{error.message}
        </p>
      )}
      <div className="relative">
        <div
          ref={box}
          role="log"
          aria-live="off"
          aria-label="运行日志"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (stick.current) setBehind(false);
          }}
          className="h-[calc(100svh-17rem)] min-h-80 overflow-auto rounded-lg border bg-muted/20 py-2 font-mono text-xs leading-5"
        >
          {shown.length === 0 ? (
            <p className="py-16 text-center font-sans text-sm text-muted-foreground">
              {entries.length === 0 ? "还没有日志" : "没有符合条件的日志"}
            </p>
          ) : (
            shown.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
        {behind && (
          <Button size="sm" className="absolute right-4 bottom-4 shadow-md" onClick={toBottom}>
            <ArrowDown />
            跳到最新
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
        显示 {formatInteger(shown.length)} / {formatInteger(entries.length)} 条，最多保留最近{" "}
        {formatInteger(MAX_ENTRIES)} 条
      </p>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function RequestLogs() {
  const queryClient = useQueryClient();
  const [requestId, setRequestId] = useState("");
  const config = useQuery({
    queryKey: ["cpa", "config"],
    queryFn: () => api<Record<string, unknown>>("/v0/management/config"),
  });
  const files = useQuery({
    queryKey: ["cpa", "request-error-logs"],
    queryFn: () =>
      api<{ files?: { name: string; size: number; modified: number }[] }>("/v0/management/request-error-logs"),
    select: (res) => res.files ?? [],
  });
  const requestLog = config.data?.["request-log"] === true;
  const toggle = useMutation({
    mutationFn: (value: boolean) => api("/v0/management/request-log", { method: "PUT", body: { value } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpa", "config"] });
      queryClient.invalidateQueries({ queryKey: ["cpa", "request-error-logs"] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = requestId.trim();
    if (id) downloadRequestLog(id);
  }

  return (
    <div className="grid gap-8">
      <section aria-label="请求日志设置" className="grid gap-4 border-b pb-6 md:grid-cols-2 md:gap-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="request-log" className="text-sm font-medium">
              记录完整请求
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              每个请求的请求体、上游往返和响应都会写成单独的文件。关闭时只保留失败请求。
            </p>
          </div>
          <Switch
            id="request-log"
            checked={requestLog}
            disabled={config.isPending || toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
          />
        </div>
        <form onSubmit={submit} className="grid content-start gap-2">
          <Label htmlFor="request-id">按请求 ID 下载</Label>
          <div className="flex gap-2">
            <Input
              id="request-id"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder="运行日志或用量明细里的请求 ID"
              className="font-mono"
            />
            <Button type="submit" variant="outline" disabled={!requestId.trim()}>
              <Download />
              下载
            </Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="error-files-title">
        <h2 id="error-files-title" className="mb-3 font-medium">
          失败请求日志
        </h2>
        {requestLog && (
          <p className="mb-3 text-sm text-muted-foreground">
            已开启完整请求记录，失败请求不再单独归档，请用请求 ID 下载。
          </p>
        )}
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
            {files.isPending ? (
              <SkeletonRows columns={4} />
            ) : !files.data?.length ? (
              <EmptyRow columns={4}>没有失败请求日志</EmptyRow>
            ) : (
              files.data.map((f) => (
                <TableRow key={f.name}>
                  <TableCell className="font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSize(f.size)}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDateTime(f.modified * 1000)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`下载 ${f.name}`}
                      onClick={() =>
                        download(`/v0/management/request-error-logs/${encodeURIComponent(f.name)}`, f.name).catch(
                          (e: Error) => toast.error(e.message),
                        )
                      }
                    >
                      <Download />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

export function LogsPage() {
  return (
    <>
      <PageHeader title="日志" />
      <Tabs defaultValue="live">
        <TabsList variant="line" className="mb-5">
          <TabsTrigger value="live">运行日志</TabsTrigger>
          <TabsTrigger value="requests">请求日志</TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          <LiveLogs />
        </TabsContent>
        <TabsContent value="requests">
          <RequestLogs />
        </TabsContent>
      </Tabs>
    </>
  );
}
