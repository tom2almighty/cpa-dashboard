import { expect, test } from "bun:test";
import {
  parseAntigravity,
  parseClaude,
  parseCodex,
  parseDevin,
  parseKimi,
  parseMeta,
  parseXai,
  windowLabel,
} from "./quota";

const now = Date.UTC(2026, 8, 24);

test("codex 5 小时和每周窗口", () => {
  const q = parseCodex(
    {
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 600 },
        secondary_window: { used_percent: 7, limit_window_seconds: 604800, reset_at: 1790500000 },
      },
      credits: { has_credits: true, unlimited: false, balance: "12.5" },
    },
    now,
  );
  expect(q.plan).toBe("plus");
  expect(q.windows.map((w) => [w.label, w.usedPercent, w.resetAt])).toEqual([
    ["5 小时", 42, now + 600_000],
    ["每周", 7, 1790500000_000],
  ]);
  expect(q.notes).toEqual(["积分余额 12.5"]);
});

test("claude 窗口与额外用量", () => {
  const q = parseClaude(
    {
      five_hour: { utilization: 80, resets_at: "2026-09-24T05:00:00Z" },
      seven_day: { utilization: 20, resets_at: "2026-09-30T00:00:00Z" },
      seven_day_opus: null,
      extra_usage: { is_enabled: true, monthly_limit: 20000, used_credits: 4200, utilization: null },
    },
    { account: { has_claude_max: true } },
  );
  expect(q.plan).toBe("Max");
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([
    ["5 小时", 80],
    ["每周", 20],
    ["每月额外用量", 21],
  ]);
  expect(q.windows[2].detail).toBe("$42.00 / $200.00");
});

test("kimi 按时长命名窗口", () => {
  const q = parseKimi(
    {
      usage: { used: 30, limit: 100, resetAt: "2026-09-30T00:00:00Z" },
      limits: [
        { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { remaining: 15, limit: 20, reset_in: 60 } },
      ],
    },
    now,
  );
  expect(q.windows.map((w) => [w.label, w.usedPercent, w.detail])).toEqual([
    ["每周", 30, "30 / 100"],
    ["5 小时", 25, "5 / 20"],
  ]);
  expect(q.windows[1].resetAt).toBe(now + 60_000);
});

test("xai 周期与月度", () => {
  const q = parseXai(
    { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-30T00:00:00Z" }, creditUsagePercent: 60 },
    { monthly_limit: { val: 10000 }, used: 2500, billing_period_end: "2026-10-01T00:00:00Z" },
  );
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([
    ["每周", 60],
    ["每月", 25],
  ]);
});

test("antigravity 剩余比例换算为已用", () => {
  const q = parseAntigravity({
    models: {
      "gemini-3-pro-high": {
        displayName: "Gemini 3 Pro",
        quotaInfo: { remainingFraction: 0.75, resetTime: "2026-09-24T08:00:00Z" },
      },
      "gemini-3-pro-low": { displayName: "Gemini 3 Pro", quotaInfo: { remainingFraction: 0.75 } },
      "no-quota": { displayName: "X" },
    },
  });
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([["Gemini 3 Pro", 25]]);
});

test("窗口时长命名", () => {
  expect([18000, 604800, 2592000, 86400 * 2, null].map(windowLabel)).toEqual([
    "5 小时",
    "每周",
    "每月",
    "2 天",
    "额度",
  ]);
});

test("devin 每日与每周剩余额度换算", () => {
  const q = parseDevin({
    userStatus: {
      planStatus: {
        planInfo: { planName: "Pro" },
        dailyQuotaRemainingPercent: 85,
        dailyQuotaResetAtUnix: 1790500000,
        weeklyQuotaRemainingPercent: 40,
        weeklyQuotaResetAtUnix: 1791000000,
      },
    },
  });
  expect(q.plan).toBe("Pro");
  expect(q.windows.map((w) => [w.label, w.usedPercent, w.resetAt])).toEqual([
    ["每日额度", 15, 1790500000_000],
    ["每周额度", 60, 1791000000_000],
  ]);
});

test("meta 窗口与每周额度", () => {
  const q = parseMeta({
    subs_tier_name: "Pro Tier",
    subs_usage: {
      window: { used_percent: 35, resets_at: 1790500000, window_duration_mins: 180 },
      weekly: { used_percent: 70, resets_at: 1791000000 },
    },
  });
  expect(q.plan).toBe("Pro Tier");
  expect(q.windows.map((w) => [w.label, w.usedPercent, w.detail])).toEqual([
    ["会话窗口", 35, "180 分钟窗口"],
    ["每周额度", 70, undefined],
  ]);
});
