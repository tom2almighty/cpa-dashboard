import i18n from "@/i18n";

const integer = new Intl.NumberFormat("en-US");

export function formatInteger(n: number): string {
  return integer.format(n);
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat(i18n.language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ts);
}

export function formatRelative(ts: number | null): string {
  if (!ts) return i18n.t("time.never");
  const diff = Date.now() - ts;
  if (diff < 60_000) return i18n.t("time.just_now");
  if (diff < 3_600_000) return i18n.t("time.minutes_ago", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return i18n.t("time.hours_ago", { n: Math.floor(diff / 3_600_000) });
  return i18n.t("time.days_ago", { n: Math.floor(diff / 86_400_000) });
}

// 重置倒计时:3 天 4 小时后、2 小时 5 分后、12 分钟后
export function formatCountdown(ts: number | null): string {
  if (!ts) return "";
  const minutes = Math.round((ts - Date.now()) / 60_000);
  if (minutes <= 0) return i18n.t("time.reset_done");
  if (minutes < 60) return i18n.t("time.reset_in_minutes", { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("time.reset_in_hours", { h: hours, m: minutes % 60 });
  return i18n.t("time.reset_in_days", { d: Math.floor(hours / 24), h: hours % 24 });
}
