import { afterAll, expect, test } from "bun:test";
import {
  fetchPluginQuota,
  fetchQuota,
  parseAntigravity,
  parseClaude,
  parseCodex,
  parseDevin,
  parseKimi,
  parseMeta,
  parsePluginQuota,
  parseXai,
  resetPluginQuota,
  resetQuota,
  windowLabel,
} from "./quota";

// bun test 没有 DOM,api.ts 解析地址与密钥时要用到 Web Storage
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
} as unknown as Storage;
globalThis.localStorage ??= storage;
globalThis.sessionStorage ??= storage;

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("fetchQuota/resetQuota 按凭据的插件提供方定位插件", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (String(input) === "/v8/management/plugins") {
      return new Response(JSON.stringify({ plugins: [{ id: "cpa-quota", quota_provider: "claude" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ status: "ok", message: "restored" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        subscription: { plan: "pro" },
        groups: [{ displayName: "Claude", buckets: [{ displayName: "5 小时", remainingFraction: 0.4 }] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const file = {
    id: "a",
    name: "a.json",
    auth_index: "idx1",
    provider: "claude",
    supports_quota: true,
    quota_provider: "claude",
  };
  const quota = await fetchQuota(file);

  expect(calls[0].url).toBe("/v8/management/plugins");
  expect(calls[1].url).toBe("/v8/management/plugins/cpa-quota/quota?auth_index=idx1");
  expect(calls[1].init?.method).toBe("POST");
  expect(JSON.parse(String(calls[1].init?.body))).toEqual({ auth_index: "idx1" });
  expect(quota.plan).toBe("pro");
  expect(quota.windows.map((w) => [w.label, w.usedPercent])).toEqual([["Claude 5 小时", 60]]);

  const res = await resetQuota(file);
  expect(calls[2].url).toBe("/v8/management/plugins/cpa-quota/quota?auth_index=idx1");
  expect(calls[2].init?.method).toBe("DELETE");
  expect(res).toEqual({ status: "ok", message: "restored" });
});

test("没有匹配的插件提供方时不发重置请求", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ plugins: [{ id: "cpa-quota", quota_provider: "claude" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await expect(resetQuota({ id: "a", name: "a.json", auth_index: "idx1", quota_provider: "codex" })).rejects.toThrow();
  expect(calls.filter((url) => url.includes("/quota"))).toEqual([]);
});

test("缺少 auth_index 时不发请求", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  await expect(resetQuota({ id: "a", name: "a.json" })).rejects.toThrow();
  expect(called).toBe(false);
});

test("插件额度按 plugin id 与 auth_index 定位", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        subscription: { plan: "pro" },
        groups: [{ displayName: "Claude", buckets: [{ displayName: "5 小时", remainingFraction: 0.4 }] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const quota = await fetchPluginQuota("cpa-quota", "idx 1");
  expect(calls[0].url).toBe("/v8/management/plugins/cpa-quota/quota?auth_index=idx%201");
  expect(quota.plan).toBe("pro");
  expect(quota.windows.map((w) => [w.label, w.usedPercent])).toEqual([["Claude 5 小时", 60]]);

  await resetPluginQuota("cpa-quota", "idx1");
  expect(calls[1].url).toBe("/v8/management/plugins/cpa-quota/quota?auth_index=idx1");
  expect(calls[1].init?.method).toBe("DELETE");
});

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
    groups: [
      {
        displayName: "Gemini 3 Pro",
        buckets: [
          {
            displayName: "Daily",
            remainingFraction: 0.75,
            resetTime: "2026-09-24T08:00:00Z",
          },
        ],
      },
    ],
  });
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([["Gemini 3 Pro Daily", 25]]);
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

test("插件额度结构:套餐、分组与汇总", () => {
  const q = parsePluginQuota({
    subscription: { tierName: "Team" },
    summary: [
      { key: "credits_used", label: "Credits used", value: 1740.28, unit: "credits", format: "number" },
      { key: "charged", label: "Charged", value: 29.61, format: "currency", currency: "USD" },
    ],
    groups: [
      {
        displayName: "Claude",
        buckets: [{ window: "5h", remainingFraction: 0.4, resetTime: "2026-09-24T05:00:00Z", description: "40/100" }],
      },
    ],
  });
  expect(q.plan).toBe("Team");
  expect(q.windows.map((w) => [w.label, w.usedPercent, w.resetAt, w.detail])).toEqual([
    ["Claude 5h", 60, Date.parse("2026-09-24T05:00:00Z"), "40/100"],
  ]);
  expect(q.notes[0]).toBe("Credits used 1740.28 credits");
  expect(q.notes[1]).toContain("29.61");
});
