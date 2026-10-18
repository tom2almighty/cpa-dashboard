import { afterAll, expect, test } from "vitest";
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

test("凭据带 quota_plugin_id 时直接定位插件,不再查询插件列表", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await resetQuota({
    id: "a",
    name: "a.json",
    auth_index: "idx1",
    quota_provider: "claude",
    quota_plugin_id: "cpa-quota",
  });
  expect(calls).toEqual(["/v8/management/plugins/cpa-quota/quota?auth_index=idx1"]);
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
test("claude 独立美元配额窗口解析", () => {
  const q = parseClaude(
    {
      five_hour: { utilization: 50, resets_at: "2026-09-24T05:00:00Z" },
      seven_day: null,
      organization_budget: {
        limit_dollars: 100,
        used_dollars: 35.5,
        remaining_dollars: 64.5,
        utilization: 35.5,
        resets_at: "2026-10-01T00:00:00Z",
      },
    },
    null,
  );
  const orgWindow = q.windows.find((w) => w.id === "claude-organization_budget");
  expect(orgWindow).toBeDefined();
  expect(orgWindow?.label).toBe("Organization Budget");
  expect(orgWindow?.usedPercent).toBe(35.5);
  expect(orgWindow?.detail).toBe("$35.50 / $100.00");
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

test("xai 按量付费与套餐档位", () => {
  const q = parseXai(null, {
    monthly_limit: 15000,
    used: 20000,
    on_demand_cap: 10000,
    billing_period_end: "2026-10-01T00:00:00Z",
  });
  expect(q.plan).toBe("SuperGrok");
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([
    ["每月", 100],
    ["按量付费", 50],
  ]);
  expect(q.windows[1].detail).toBe("$50.00 / $100.00");
});

test("claude reset grants 解析与不可用标记", () => {
  const q = parseClaude({ five_hour: { utilization: 100 } }, null, {
    cedar_ember: {
      eligible: true,
      at_limit: true,
      next_grant_id: "g2",
      cooldown_until: null,
      grants: [
        {
          id: "g1",
          label: "Weekly reset",
          resets_total: 2,
          resets_left: 1,
          starts_at: "2026-10-01T00:00:00Z",
          ends_at: "2026-11-01T00:00:00Z",
          usable_now: true,
        },
        { id: "g2", resets_total: 1, resets_left: 1, usable_now: false },
      ],
    },
  });
  expect(q.claudeReset?.atLimit).toBe(true);
  expect(q.claudeReset?.nextGrantId).toBe("g2");
  expect(q.claudeReset?.grants[0]).toMatchObject({
    id: "g1",
    resetsLeft: 1,
    paused: false,
    usableNow: true,
    useRequiresLimit: true,
  });
  expect(q.claudeReset?.grants[1].usableNow).toBe(false);
});

test("codex 主动重置卡只保留可用项", () => {
  const q = parseCodex({ rate_limit: {} }, now, {
    available_count: 2,
    credits: [
      {
        id: "c1",
        reset_type: "codex_rate_limits",
        status: "available",
        expires_at: "2026-10-20T00:00:00Z",
      },
      { id: "c2", reset_type: "codex_rate_limits", status: "used", expires_at: "2026-10-20T00:00:00Z" },
      { id: "c3", reset_type: "other", status: "available", expires_at: "2026-10-20T00:00:00Z" },
    ],
  });
  expect(q.codexResetCredits).toEqual({
    count: 2,
    credits: [{ id: "c1", expiresAt: "2026-10-20T00:00:00Z" }],
  });
});

test("antigravity 标签翻译并去掉 Remaining 后缀", () => {
  const q = parseAntigravity({
    groups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash",
        buckets: [
          { displayName: "Weekly Limit Remaining", window: "weekly", remainingFraction: 0 },
          { displayName: "Five Hour Limit Remaining", window: "5h", remainingFraction: 1 },
        ],
      },
    ],
  });
  expect(q.windows.map((w) => w.label)).toEqual(["Gemini 模型 每周额度", "Gemini 模型 5 小时额度"]);
  expect(q.windows[0].detail).toContain("此分组包含");
  expect(q.windows[0].detail).toContain("Gemini Argon");
  expect(q.windows[1].detail).toContain("周限额耗尽");
});

test("claude Fable 周额度窗口", () => {
  const q = parseClaude({ iguana_necktie: { utilization: 12 } }, null);
  expect(q.windows.map((w) => [w.label, w.usedPercent])).toEqual([["每周 Fable", 12]]);
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
test("antigravity 自动追加 Gemini Argon 并识别周限额耗尽", () => {
  const q = parseAntigravity({
    groups: [
      {
        displayName: "Gemini Models",
        description: "Models within this group: Gemini Flash, Gemini Pro",
        buckets: [
          {
            displayName: "Weekly Limit",
            window: "weekly",
            remainingFraction: 0,
          },
          {
            displayName: "5 Hour Limit",
            window: "5h",
            remainingFraction: 1,
          },
        ],
      },
    ],
  });
  expect(q.windows.length).toBe(2);
  expect(q.windows[0].usedPercent).toBe(100);
  expect(q.windows[0].detail).toContain("Gemini Argon");
  expect(q.windows[1].detail).toContain("周限额耗尽");
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
    ["会话窗口", 35, "3 小时窗口"],
    ["每周额度", 70, undefined],
  ]);
});

test("meta 非整小时窗口仍按分钟显示", () => {
  const q = parseMeta({
    subs_usage: { window: { used_percent: 10, window_duration_mins: 90 } },
  });
  expect(q.windows[0].detail).toBe("90 分钟窗口");
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
    ["Claude 5 小时额度", 60, Date.parse("2026-09-24T05:00:00Z"), "40/100"],
  ]);
  expect(q.notes[0]).toBe("Credits used 1740.28 credits");
  expect(q.notes[1]).toContain("29.61");
});
