const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US");
const dateTime = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatCompact(n: number): string {
  return n < 10_000 ? integer.format(n) : compact.format(n);
}

export function formatInteger(n: number): string {
  return integer.format(n);
}

export function formatCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 单价:美元 / 百万 token
export function formatUnitPrice(n: number | null): string {
  if (n === null) return "—";
  return `$${Number(n.toPrecision(4))}`;
}

export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(ratio >= 0.9995 || ratio === 0 ? 0 : 1)}%`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

export function formatDateTime(ts: number): string {
  return dateTime.format(ts);
}

export function formatRelative(ts: number | null): string {
  if (!ts) return "从未";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function successRate(t: { requests: number; failed: number }): number {
  return t.requests === 0 ? Number.NaN : (t.requests - t.failed) / t.requests;
}

// 重置倒计时:3 天 4 小时后、2 小时 5 分后、12 分钟后
export function formatCountdown(ts: number | null): string {
  if (!ts) return "";
  const minutes = Math.round((ts - Date.now()) / 60_000);
  if (minutes <= 0) return "已重置";
  if (minutes < 60) return `${minutes} 分钟后重置`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分后重置`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时后重置`;
}
