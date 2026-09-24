export type Preset = "today" | "24h" | "7d" | "30d" | "90d";

export const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
];

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type ResolvedRange = { from: number; to: number; bucket: "hour" | "day" };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 每次请求时现算,保证"到现在为止"的范围不会被缓存成旧值
export function resolveRange(preset: Preset): ResolvedRange {
  const now = Date.now();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: now, bucket: "hour" };
    case "24h":
      return { from: Math.floor(now / HOUR) * HOUR - 23 * HOUR, to: now, bucket: "hour" };
    case "7d":
      return { from: startOfDay(now) - 6 * DAY, to: now, bucket: "day" };
    case "30d":
      return { from: startOfDay(now) - 29 * DAY, to: now, bucket: "day" };
    case "90d":
      return { from: startOfDay(now) - 89 * DAY, to: now, bucket: "day" };
  }
}

export function rangeQuery(range: ResolvedRange, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams({ from: String(range.from), to: String(range.to) });
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
