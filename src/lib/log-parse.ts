export type Level = "error" | "warn" | "info" | "debug";

export type LogEntry = {
  id: number;
  time: string;
  requestId: string | null;
  level: Level;
  caller: string;
  message: string;
};

// CPA 日志格式:[2025-12-23 20:14:04] [a1b2c3d4] [info ] [manager.go:524] 消息 key=value
const LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([^\]]*)\] \[(\w+)\s*\] (?:\[([^\]\s]+:\d+)\] )?(.*)$/;

function toLevel(raw: string): Level {
  const l = raw.toLowerCase();
  if (l === "error" || l === "fatal" || l === "panic") return "error";
  if (l === "warn" || l === "warning") return "warn";
  if (l === "info") return "info";
  return "debug";
}

// 把新拉到的行合并进已有条目;不符合格式的行视为上一条的续行(堆栈、多行消息)
export function appendLines(entries: LogEntry[], lines: string[], nextId: number, max: number): LogEntry[] {
  const out = entries.slice();
  let id = nextId;
  for (const line of lines) {
    const m = LINE.exec(line);
    if (m) {
      out.push({
        id: id++,
        time: m[1],
        requestId: /^-+$/.test(m[2]) || !m[2] ? null : m[2],
        level: toLevel(m[3]),
        caller: m[4] ?? "",
        message: m[5],
      });
    } else if (out.length > 0 && line.trim()) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, message: `${last.message}\n${line}` };
    } else if (line.trim()) {
      const level: Level = /\b(error|fatal|panic)\b/i.test(line) ? "error" : /\bwarn/i.test(line) ? "warn" : "info";
      out.push({ id: id++, time: "", requestId: null, level, caller: "", message: line });
    }
  }
  return out.length > max ? out.slice(out.length - max) : out;
}
