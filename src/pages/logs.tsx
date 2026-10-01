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
import { i18n, useI18n } from "@/i18n/context";
import { ApiError, api, CONFIG_KEY, configPath, configQuery, download, errorText } from "@/lib/api";
import { formatDateTime, formatInteger } from "@/lib/format";
import { appendLines, type Level, type LogEntry } from "@/lib/log-parse";

type LogsResponse = { lines: string[]; "next-cursor"?: string; "cursor-reset"?: boolean };

const POLL_MS = 3000;
// ponytail: 只保留最近的条目,行渲染靠 content-visibility 跳过屏幕外的布局,量再大需要虚拟列表
const MAX_ENTRIES = 3000;

// CPA 未开启 logging-to-file 时读日志返回 400,error 字段就是这句话
function fileLoggingDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.code === "logging to file disabled";
}

const LEVELS: { value: Level | "all"; labelKey: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "error", labelKey: "logs.level_error" },
  { value: "warn", labelKey: "logs.level_warn" },
  { value: "info", labelKey: "logs.level_info" },
  { value: "debug", labelKey: "logs.level_debug" },
];

const LEVEL_TEXT: Record<Level, string> = {
  error: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

const ROW_TINT: Record<Level, string> = {
  error: "bg-destructive/5",
  warn: "bg-amber-500/10",
  info: "",
  debug: "",
};

async function downloadRequestLog(id: string) {
  try {
    await download(`/v8/management/observability/logs/requests/${encodeURIComponent(id)}`, `request-${id}.log`);
  } catch (error) {
    toast.error(
      error instanceof ApiError && error.status === 404
        ? i18n.t("logs.request_log_not_found")
        : (error as Error).message,
    );
  }
}

// 网关访问日志以状态码开头,按 2xx/4xx/5xx 着色
function Message({ text }: { text: string }) {
  const m = /^(\d{3})(\s+\|.*)$/s.exec(text);
  if (!m) return <>{text}</>;
  const code = Number(m[1]);
  const color =
    code >= 500
      ? "text-destructive"
      : code >= 400
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";
  return (
    <>
      <span className={`font-medium ${color}`}>{m[1]}</span>
      {m[2]}
    </>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const { t } = useI18n();
  // 多行条目(堆栈等)保留换行;单行条目截断成一行,长路径折行不再撑高行高、打乱实时滚动的节奏
  const multiline = entry.message.includes("\n");
  return (
    <div
      className={`flex gap-3 px-3 py-0.5 hover:bg-muted/60 ${ROW_TINT[entry.level]}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 1.25rem" }}
    >
      <span className="w-18 shrink-0 text-muted-foreground tabular-nums" title={entry.time || undefined}>
        {entry.time.slice(11) || "—"}
      </span>
      <span className={`w-11 shrink-0 ${LEVEL_TEXT[entry.level]}`}>{entry.level}</span>
      {/* 单行用 whitespace-pre 而不是 nowrap:访问日志靠源头的空格对齐,nowrap 会把连续空格压掉 */}
      <span
        className={`min-w-0 flex-1 ${
          multiline ? "whitespace-pre-wrap wrap-break-word" : "overflow-hidden whitespace-pre text-ellipsis"
        }`}
        title={multiline ? undefined : entry.message}
      >
        {entry.requestId && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => entry.requestId && downloadRequestLog(entry.requestId)}
                  className="mr-2 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                />
              }
            >
              {entry.requestId}
            </TooltipTrigger>
            <TooltipContent>{t("logs.download_request_log")}</TooltipContent>
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
  const { t } = useI18n();
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

  // 上一次请求返回后再排下一次,避免同一游标并发拉取出重复行
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation 变化时从头重新拉取
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      if (!document.hidden) {
        try {
          const used = cursor.current;
          const query = used ? `cursor=${encodeURIComponent(used)}&limit=1000` : "limit=1000";
          const res = await api<LogsResponse>(`/v8/management/observability/logs?${query}`);
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
          if (stopped) return;
          setError(e as Error);
          if (fileLoggingDisabled(e)) return;
        }
      }
      if (live && !stopped) timer = setTimeout(tick, POLL_MS);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
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
    mutationFn: () => api(configPath("observability", "logs", "logging-to-file"), { method: "PUT", body: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
      restart();
    },
  });

  const clear = useMutation({
    mutationFn: () => api("/v8/management/observability/logs", { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("logs.cleared"));
      restart();
    },
  });

  if (fileLoggingDisabled(error)) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("logs.file_logging_disabled")}</p>
        <Button onClick={() => enable.mutate()} disabled={enable.isPending}>
          {t("logs.enable_file_logging")}
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
            placeholder={t("logs.search")}
            aria-label={t("logs.search")}
            className="pl-8 text-xs"
          />
        </div>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={t("logs.filter_by_level")}
          value={[level]}
          onValueChange={(v) => v[0] && setLevel(v[0] as Level | "all")}
        >
          {LEVELS.map((l) => (
            <ToggleGroupItem key={l.value} value={l.value} className="gap-1.5 px-2.5">
              {t(l.labelKey)}
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
              className={`size-2 rounded-full ${live ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-muted-foreground/40"}`}
            />
            {live ? t("logs.live") : t("logs.paused")}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label={live ? t("logs.pause") : t("logs.resume")}
            onClick={() => setLive((v) => !v)}
          >
            {live ? <Pause /> : <Play />}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="icon" aria-label={t("logs.clear")} />}>
              <Trash2 />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("logs.clear")}</AlertDialogTitle>
                <AlertDialogDescription>{t("logs.clear_desc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => clear.mutate()}>
                  {t("logs.clear_confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      {error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {t("logs.load_failed", { message: errorText(error) })}
        </p>
      )}
      <div className="relative">
        <div
          ref={box}
          role="log"
          aria-live="off"
          aria-label={t("logs.tab_live")}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            if (stick.current) setBehind(false);
          }}
          className="h-[calc(100svh-17rem)] min-h-80 overflow-auto rounded-lg border bg-muted/20 py-2 font-mono text-xs leading-5"
        >
          {shown.length === 0 ? (
            <p className="py-16 text-center font-sans text-sm text-muted-foreground">
              {entries.length === 0 ? t("logs.empty") : t("logs.no_match")}
            </p>
          ) : (
            shown.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </div>
        {behind && (
          <Button size="sm" className="absolute right-4 bottom-4 shadow-md" onClick={toBottom}>
            <ArrowDown />
            {t("logs.jump_latest")}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums">
        {t("logs.shown_count", {
          shown: formatInteger(shown.length),
          total: formatInteger(entries.length),
          max: formatInteger(MAX_ENTRIES),
        })}
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
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [requestId, setRequestId] = useState("");
  const config = useQuery({
    ...configQuery,
    select: (c) => (c.observability as { logs?: { "request-log"?: boolean } } | null)?.logs?.["request-log"] === true,
  });
  const files = useQuery({
    queryKey: ["cpa", "request-error-logs"],
    queryFn: () =>
      api<{ files?: { name: string; size: number; modified: number }[] }>("/v8/management/observability/logs/errors"),
    select: (res) => res.files ?? [],
  });
  const requestLog = config.data === true;
  const toggle = useMutation({
    mutationFn: (value: boolean) =>
      api(configPath("observability", "logs", "request-log"), { method: "PUT", body: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
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
      <section
        aria-label={t("logs.request_log_settings")}
        className="grid gap-4 border-b pb-6 md:grid-cols-2 md:gap-10"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="request-log" className="text-sm font-medium">
              {t("logs.request_log_full")}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">{t("logs.request_log_full_desc")}</p>
          </div>
          <Switch
            id="request-log"
            checked={requestLog}
            disabled={config.isPending || toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
          />
        </div>
        <form onSubmit={submit} className="grid content-start gap-2">
          <Label htmlFor="request-id">{t("logs.download_by_id")}</Label>
          <div className="flex gap-2">
            <Input
              id="request-id"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder={t("logs.request_id_placeholder")}
              className="font-mono"
            />
            <Button type="submit" variant="outline" disabled={!requestId.trim()}>
              <Download />
              {t("common.download")}
            </Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="error-files-title">
        <h2 id="error-files-title" className="mb-3 font-medium">
          {t("logs.error_logs")}
        </h2>
        {requestLog && <p className="mb-3 text-sm text-muted-foreground">{t("logs.error_logs_hint")}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("logs.th_file")}</TableHead>
              <TableHead className="text-right">{t("logs.th_size")}</TableHead>
              <TableHead>{t("logs.th_modified")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("common.download")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.isPending ? (
              <SkeletonRows columns={4} />
            ) : !files.data?.length ? (
              <EmptyRow columns={4}>{t("logs.no_error_logs")}</EmptyRow>
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
                      aria-label={t("logs.download_file", { name: f.name })}
                      onClick={() =>
                        download(
                          `/v8/management/observability/logs/errors/${encodeURIComponent(f.name)}`,
                          f.name,
                        ).catch((e: Error) => toast.error(errorText(e)))
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
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("logs.title")} description={t("logs.desc")} />
      <Tabs defaultValue="live">
        <TabsList className="mb-5">
          <TabsTrigger value="live">{t("logs.tab_live")}</TabsTrigger>
          <TabsTrigger value="requests">{t("logs.tab_requests")}</TabsTrigger>
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
