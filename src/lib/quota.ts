import i18n from "@/i18n";
import { api } from "@/lib/api";
import type { AuthFile } from "@/lib/types";

// 额度窗口:usedPercent 为 0~100,resetAt 为毫秒时间戳
export type QuotaWindow = {
  id: string;
  label: string;
  usedPercent: number | null;
  resetAt: number | null;
  detail?: string;
};

/** Claude 主动重置机会（cedar_ember） */
export type ClaudeResetGrant = {
  id: string;
  label: string;
  resetsLeft: number;
  resetsTotal: number;
  startsAt: string | null;
  endsAt: string | null;
  paused: boolean;
  usableNow: boolean;
  useRequiresLimit: boolean;
};

export type ClaudeResetGrantState = {
  grants: ClaudeResetGrant[];
  atLimit: boolean;
  eligible: boolean;
  cooldownUntil: string | null;
  nextGrantId: string | null;
};

/** Codex 主动重置卡,过期时间来自 rate-limit-reset-credits */
export type CodexResetCredit = { id: string; expiresAt: string };

export type CodexResetCredits = {
  count: number | null;
  credits: CodexResetCredit[];
  error?: string;
};

export type Quota = {
  plan: string | null;
  windows: QuotaWindow[];
  notes: string[];
  claudeReset?: ClaudeResetGrantState;
  codexResetCredits?: CodexResetCredits;
};

type Json = Record<string, unknown>;

const HOUR = 3600;
const DAY = 86_400;
const XAI_CLIENT_VERSION = "1.0.46";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CODEX_RESET_CREDITS_CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const CLAUDE_RESET_GRANT_STATUS_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1";
const CLAUDE_RESET_GRANT_CLAIM_BASE = "https://api.anthropic.com/api/organizations";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_AI_USAGE_URL = "https://api.kimi.ai/coding/v1/usages";
const XAI_WEEKLY_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const XAI_MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const ANTIGRAVITY_QUOTA_URLS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
];
const DEVIN_STATUS_URL = "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus";
const META_MUSE_QUOTA_URL = "https://api.meta.ai/muse-code/key";

// 上游会校验客户端标识,取值与官方 CLI 保持一致
const HEADERS = {
  codex: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)",
  },
  claude: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "claude-code-20250219",
    "user-agent": "claude-code/2.1.280",
  },
  kimi: { Authorization: "Bearer $TOKEN$" },
  xai: {
    Authorization: "Bearer $TOKEN$",
    "x-xai-token-auth": "xai-grok-cli",
    // Grok 拒绝低于 1.0.13 的客户端版本
    "x-grok-client-version": XAI_CLIENT_VERSION,
    accept: "*/*",
    "user-agent": `grok-pager/${XAI_CLIENT_VERSION} grok-shell/${XAI_CLIENT_VERSION} (macos; aarch64)`,
  },
  antigravity: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "antigravity/hub/2.23.0 darwin/arm64",
  },
  devin: {
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
  },
} satisfies Record<string, Record<string, string>>;

// 主动重置走 Anthropic 的 OAuth 接口,客户端标识与额度查询略有不同
const CLAUDE_RESET_HEADERS = {
  ...HEADERS.claude,
  "anthropic-beta": "oauth-2025-04-20",
  "user-agent": "claude-cli/2.1.280 (external, cli)",
};

const QUOTA_PROVIDERS: Record<string, true> = {
  codex: true,
  claude: true,
  antigravity: true,
  kimi: true,
  xai: true,
  devin: true,
  meta: true,
};

export function supportsQuota(file: AuthFile): boolean {
  return (
    Boolean(file.auth_index) && Boolean(file.supports_quota || QUOTA_PROVIDERS[(file.provider ?? "").toLowerCase()])
  );
}

// ---------- 通用解析 ----------

function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function num(value: unknown): number | null {
  const inner = obj(value);
  const raw = inner ? (inner.val ?? inner.value) : value;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 可解析为时间的字符串,否则返回 null */
function timestamp(value: unknown): string | null {
  const text = str(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function pick(record: Json | null, ...keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

// 时间戳可能是 ISO 字符串、秒或毫秒
function toMs(value: unknown): number | null {
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  const n = num(value);
  if (n === null || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

export function windowLabel(seconds: number | null): string {
  if (!seconds) return i18n.t("quota.label.quota");
  if (seconds <= 6 * HOUR) return i18n.t("quota.label.hours", { n: Math.round(seconds / HOUR) });
  if (seconds >= 6.5 * DAY && seconds <= 7.5 * DAY) return i18n.t("quota.label.weekly");
  if (seconds >= 27 * DAY && seconds <= 32 * DAY) return i18n.t("quota.label.monthly");
  if (seconds >= DAY) return i18n.t("quota.label.days", { n: Math.round(seconds / DAY) });
  return i18n.t("quota.label.hours", { n: Math.round(seconds / HOUR) });
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.min(Math.max(value, 0), 100);
}

// ---------- 各家解析 ----------

/** 只保留可用于 Codex 额度的未过期重置卡 */
export function parseCodexResetCredits(payload: Json | null): CodexResetCredits | undefined {
  if (!payload) return undefined;
  const raw = Array.isArray(payload.credits) ? payload.credits : [];
  const credits: CodexResetCredit[] = [];
  for (const item of raw) {
    const record = obj(item);
    if (!record) continue;
    if (str(pick(record, "reset_type", "resetType")) !== "codex_rate_limits") continue;
    if (str(record.status) !== "available") continue;
    const expiresAt = timestamp(pick(record, "expires_at", "expiresAt"));
    if (!expiresAt) continue;
    credits.push({ id: str(record.id) ?? expiresAt, expiresAt });
  }
  const count = num(pick(payload, "available_count", "availableCount")) ?? credits.length;
  return { count, credits };
}

export function parseCodex(payload: Json, now = Date.now(), resetCredits?: Json | null): Quota {
  const windows: QuotaWindow[] = [];
  const addLimit = (limit: unknown, prefix: string) => {
    const rate = obj(limit);
    for (const key of ["primary_window", "secondary_window"]) {
      const w = obj(
        pick(
          rate,
          key,
          key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
        ),
      );
      if (!w) continue;
      const seconds = num(pick(w, "limit_window_seconds", "limitWindowSeconds"));
      const resetAfter = num(pick(w, "reset_after_seconds", "resetAfterSeconds"));
      windows.push({
        id: `${prefix}${key}`,
        label: `${prefix ? `${prefix} ` : ""}${windowLabel(seconds)}`,
        usedPercent: clampPercent(num(pick(w, "used_percent", "usedPercent"))),
        resetAt: toMs(pick(w, "reset_at", "resetAt")) ?? (resetAfter !== null ? now + resetAfter * 1000 : null),
      });
    }
  };
  addLimit(pick(payload, "rate_limit", "rateLimit"), "");
  addLimit(pick(payload, "code_review_rate_limit", "codeReviewRateLimit"), i18n.t("quota.label.code_review"));
  const extra = pick(payload, "additional_rate_limits", "additionalRateLimits");
  if (Array.isArray(extra)) {
    for (const item of extra) {
      const record = obj(item);
      const name = str(pick(record, "limit_name", "limitName", "metered_feature")) ?? i18n.t("quota.label.additional");
      addLimit(pick(record, "rate_limit", "rateLimit"), name);
    }
  }

  const notes: string[] = [];
  const credits = obj(payload.credits);
  if (credits?.unlimited === true) notes.push(i18n.t("quota.label.credits_unlimited"));
  else if (num(credits?.balance) !== null)
    notes.push(i18n.t("quota.label.credits_balance", { n: num(credits?.balance) }));
  const quota: Quota = { plan: str(pick(payload, "plan_type", "planType")), windows, notes };
  const reset = parseCodexResetCredits(
    resetCredits ?? obj(pick(payload, "rate_limit_reset_credits", "rateLimitResetCredits")),
  );
  if (reset) quota.codexResetCredits = reset;
  return quota;
}

const CLAUDE_WINDOWS = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "seven_day_oauth_apps",
  "seven_day_cowork",
  "iguana_necktie",
];

/** 解析 usage 响应里的 cedar_ember 块;结构不合法时整块忽略 */
export function parseClaudeResetGrants(payload: Json | null | undefined): ClaudeResetGrantState | undefined {
  const block = obj(payload?.cedar_ember);
  if (!block || typeof block.eligible !== "boolean") return undefined;
  const grants: ClaudeResetGrant[] = [];
  const seen = new Set<string>();
  const rawGrants = Array.isArray(block.grants) ? block.grants : [];
  for (const item of rawGrants) {
    const record = obj(item);
    if (!record) continue;
    const id = str(record.id);
    const total = num(pick(record, "resets_total", "resetsTotal"));
    const left = num(pick(record, "resets_left", "resetsLeft"));
    if (!id || total === null || left === null || left < 0 || left > total || seen.has(id)) continue;
    seen.add(id);
    const optionalBoolean = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
    grants.push({
      id,
      label: str(record.label) ?? "",
      resetsLeft: left,
      resetsTotal: total,
      startsAt: timestamp(pick(record, "starts_at", "startsAt")),
      endsAt: timestamp(pick(record, "ends_at", "endsAt")),
      paused: optionalBoolean(record.paused, false),
      // 缺失可用性标记时按不可用处理,避免误消耗
      usableNow: optionalBoolean(pick(record, "usable_now", "usableNow"), false),
      useRequiresLimit: optionalBoolean(pick(record, "use_requires_limit", "useRequiresLimit"), true),
    });
  }
  return {
    grants,
    atLimit: block.at_limit === true,
    eligible: block.eligible,
    cooldownUntil: timestamp(pick(block, "cooldown_until", "cooldownUntil")),
    nextGrantId: str(pick(block, "next_grant_id", "nextGrantId")),
  };
}

export function parseClaude(payload: Json, profile: Json | null, grants?: Json | null): Quota {
  const windows: QuotaWindow[] = [];
  for (const key of CLAUDE_WINDOWS) {
    const w = obj(payload[key]);
    if (!w) continue;
    windows.push({
      id: key,
      label: i18n.t(`quota.label.claude.${key}`),
      usedPercent: clampPercent(num(w.utilization)),
      resetAt: toMs(w.resets_at),
    });
  }
  const extra = obj(payload.extra_usage);
  if (extra?.is_enabled === true) {
    const used = num(extra.used_credits) ?? 0;
    const limit = num(extra.monthly_limit) ?? 0;
    windows.push({
      id: "extra_usage",
      label: i18n.t("quota.label.extra_usage"),
      usedPercent: clampPercent(num(extra.utilization) ?? (limit > 0 ? (used / limit) * 100 : null)),
      resetAt: null,
      // 金额单位是美分
      detail: `$${(used / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`,
    });
  }
  // 独立美元额度窗口 (如组织自定义额度、充值美元余额等)
  const dollarKeys = ["limit_dollars", "used_dollars", "remaining_dollars"];
  for (const [key, val] of Object.entries(payload)) {
    if (["five_hour", "seven_day", "extra_usage", "limits"].includes(key)) continue;
    const w = obj(val);
    if (!w) continue;
    if (dollarKeys.some((k) => k in w)) {
      const limit = num(w.limit_dollars);
      const used = num(w.used_dollars);
      const remaining = num(w.remaining_dollars);
      const utilization = num(w.utilization);
      const calcPercent =
        utilization !== null
          ? clampPercent(utilization)
          : limit !== null && limit > 0 && remaining !== null
            ? clampPercent(((limit - remaining) / limit) * 100)
            : limit !== null && limit > 0 && used !== null
              ? clampPercent((used / limit) * 100)
              : null;
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      let detail: string | undefined;
      if (used !== null && limit !== null) {
        detail = `$${used.toFixed(2)} / $${limit.toFixed(2)}`;
      } else if (remaining !== null && limit !== null) {
        detail = `$${(limit - remaining).toFixed(2)} / $${limit.toFixed(2)}`;
      } else if (remaining !== null) {
        detail = `剩余 $${remaining.toFixed(2)}`;
      }
      windows.push({
        id: `claude-${key}`,
        label,
        usedPercent: calcPercent,
        resetAt: toMs(w.resets_at),
        detail,
      });
    }
  }
  const account = obj(profile?.account);
  const tier = str(obj(profile?.organization)?.rate_limit_tier);
  const plan = account?.has_claude_max === true ? "Max" : account?.has_claude_pro === true ? "Pro" : tier;
  const quota: Quota = { plan, windows, notes: [] };
  const reset = parseClaudeResetGrants(grants);
  if (reset) quota.claudeReset = reset;
  return quota;
}

function kimiReset(record: Json, now: number): number | null {
  const at = toMs(pick(record, "resetAt", "reset_at", "resetTime", "reset_time"));
  if (at !== null) return at;
  const after = num(pick(record, "resetIn", "reset_in", "ttl"));
  return after !== null ? now + after * 1000 : null;
}

function kimiSeconds(duration: number | null, unit: unknown): number | null {
  if (!duration) return null;
  const u = String(unit ?? "")
    .toUpperCase()
    .replace(/^TIME_UNIT_/, "")
    .replace(/S$/, "");
  return duration * ({ MINUTE: 60, HOUR, DAY }[u] ?? 1);
}

export function parseKimi(payload: Json, now = Date.now()): Quota {
  const windows: QuotaWindow[] = [];
  const add = (id: string, label: string, detail: Json, resetSource: Json) => {
    const limit = num(detail.limit);
    const remaining = num(detail.remaining);
    const used = num(detail.used) ?? (limit !== null && remaining !== null ? limit - remaining : null);
    if (limit === null || used === null) return;
    windows.push({
      id,
      label,
      usedPercent: clampPercent(limit > 0 ? (used / limit) * 100 : null),
      resetAt: kimiReset(detail, now) ?? kimiReset(resetSource, now),
      detail: `${used} / ${limit}`,
    });
  };
  const usage = obj(payload.usage);
  if (usage) add("usage", i18n.t("quota.label.weekly"), usage, usage);
  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  limits.forEach((item, i) => {
    const record = obj(item);
    if (!record) return;
    const window = obj(record.window) ?? record;
    const seconds = kimiSeconds(num(window.duration), window.timeUnit);
    const label = str(pick(record, "name", "title")) ?? windowLabel(seconds);
    add(`limit-${i}`, label, obj(record.detail) ?? record, record);
  });
  return { plan: null, windows, notes: [] };
}

export function parseXai(weekly: Json | null, monthly: Json | null): Quota {
  const windows: QuotaWindow[] = [];
  const w = obj(weekly?.config) ?? weekly;
  if (w) {
    const period = obj(pick(w, "currentPeriod", "current_period"));
    const type = String(period?.type ?? "").toLowerCase();
    const percent = num(pick(w, "creditUsagePercent", "credit_usage_percent"));
    if (percent !== null) {
      windows.push({
        id: "period",
        label: type.includes("month")
          ? i18n.t("quota.label.monthly")
          : type.includes("week")
            ? i18n.t("quota.label.weekly")
            : i18n.t("quota.label.current_period"),
        usedPercent: clampPercent(percent),
        resetAt: toMs(period?.end),
      });
    }
    const products = pick(w, "productUsage", "product_usage");
    if (Array.isArray(products)) {
      for (const p of products) {
        const record = obj(p);
        const name = str(record?.product);
        const used = num(pick(record, "usagePercent", "usage_percent"));
        if (name && used !== null) {
          windows.push({
            id: `product-${name}`,
            label: name,
            usedPercent: clampPercent(used),
            resetAt: toMs(period?.end),
          });
        }
      }
    }
  }
  const m = obj(monthly?.config) ?? monthly;
  const limit = num(pick(m, "monthlyLimit", "monthly_limit"));
  const used = num(m?.used);
  const includedUsed = used !== null && limit !== null ? Math.min(used, limit) : used;
  const resetAt = toMs(pick(m, "billingPeriodEnd", "billing_period_end"));
  if (m && limit !== null && limit > 0 && includedUsed !== null) {
    windows.push({
      id: "monthly",
      label: i18n.t("quota.label.monthly"),
      usedPercent: clampPercent((includedUsed / limit) * 100),
      resetAt,
      // 金额单位是美分
      detail: `$${(includedUsed / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`,
    });
  }
  // 按量付费:超过套餐额度后由 on-demand 余额承接
  const onDemandCap = num(pick(m, "onDemandCap", "on_demand_cap"));
  const onDemandUsed =
    num(pick(m, "onDemandUsed", "on_demand_used")) ??
    (used !== null && limit !== null ? Math.max(0, used - limit) : null);
  const notes: string[] = [];
  if (onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null) {
    windows.push({
      id: "on-demand",
      label: i18n.t("quota.label.pay_as_you_go"),
      usedPercent: clampPercent((onDemandUsed / onDemandCap) * 100),
      resetAt,
      detail: `$${(onDemandUsed / 100).toFixed(2)} / $${(onDemandCap / 100).toFixed(2)}`,
    });
  } else if (onDemandCap === 0) {
    notes.push(i18n.t("quota.label.pay_as_you_go_disabled"));
  }
  // 月度额度与官方套餐档位对应(单位:美分)
  const plan = limit === 15000 ? "SuperGrok" : limit === 150000 ? "SuperGrok Heavy" : null;
  return { plan, windows, notes };
}

const ANTIGRAVITY_GROUP_EXTRAS: Record<string, string[]> = {
  gemini_models: ["Gemini Argon"],
};

const ANTIGRAVITY_GROUP_LABEL_KEYS: Record<string, string> = {
  "gemini models": "quota.label.antigravity.group_gemini",
  "claude and gpt models": "quota.label.antigravity.group_claude_gpt",
};

const ANTIGRAVITY_BUCKET_LABEL_KEYS: Record<string, string> = {
  "weekly limit": "quota.label.antigravity.weekly_limit",
  "daily limit": "quota.label.antigravity.daily_limit",
  "5 hour limit": "quota.label.antigravity.five_hour_limit",
  "5-hour limit": "quota.label.antigravity.five_hour_limit",
  "five hour limit": "quota.label.antigravity.five_hour_limit",
  "five-hour limit": "quota.label.antigravity.five_hour_limit",
  "monthly limit": "quota.label.antigravity.monthly_limit",
};

const ANTIGRAVITY_WINDOW_KEYS: Record<string, string> = {
  "5h": "quota.label.antigravity.five_hour_limit",
  "five-hour": "quota.label.antigravity.five_hour_limit",
  five_hour: "quota.label.antigravity.five_hour_limit",
  "five hour": "quota.label.antigravity.five_hour_limit",
  daily: "quota.label.antigravity.daily_limit",
  day: "quota.label.antigravity.daily_limit",
  weekly: "quota.label.antigravity.weekly_limit",
  week: "quota.label.antigravity.weekly_limit",
  monthly: "quota.label.antigravity.monthly_limit",
  month: "quota.label.antigravity.monthly_limit",
};

function normalizeAntigravityText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** 去掉上游常见的 "Remaining" 后缀,如 "Weekly Limit Remaining" */
function stripRemainingSuffix(value: string): string {
  return value.replace(/\s*(?:-|:)?\s*remaining$/i, "").trim();
}

/** bucket 的 i18n key;无法识别时返回 null,由调用方显示原文 */
function antigravityBucketKey(label: string, window?: string): string | null {
  const normalized = normalizeAntigravityText(label);
  const byLabel =
    ANTIGRAVITY_BUCKET_LABEL_KEYS[normalized] ?? ANTIGRAVITY_BUCKET_LABEL_KEYS[stripRemainingSuffix(normalized)];
  if (byLabel) return byLabel;
  if (!window) return null;
  return ANTIGRAVITY_WINDOW_KEYS[normalizeAntigravityText(window)] ?? null;
}

function antigravityGroupLabel(label: string): string {
  const key = ANTIGRAVITY_GROUP_LABEL_KEYS[normalizeAntigravityText(label)];
  return key ? i18n.t(key) : label;
}

export function resolveAntigravityGroupDescription(label: string, description?: string): string | undefined {
  if (!description) return undefined;
  const match = description.trim().match(/^models within this group:\s*(.+)$/i);
  if (!match) return description;
  const models = match[1]
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const norm = normalizeAntigravityText(label);
  const groupKey = norm.includes("gemini")
    ? "gemini_models"
    : norm.includes("claude") || norm.includes("gpt")
      ? "claude_gpt_models"
      : norm;
  const extras = ANTIGRAVITY_GROUP_EXTRAS[groupKey] ?? [];
  const seen = new Set(models.map((m) => m.toLowerCase()));
  for (const extra of extras) {
    if (!seen.has(extra.toLowerCase())) {
      seen.add(extra.toLowerCase());
      models.push(extra);
    }
  }
  return i18n.t("quota.label.antigravity.group_models", { models: models.join(", ") });
}

export function parseAntigravity(payload: Json): Quota {
  const windows: QuotaWindow[] = [];
  const remainingToUsed = (value: unknown) => {
    const remaining = num(value);
    return remaining === null ? null : clampPercent((1 - remaining) * 100);
  };
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  for (const g of groups) {
    const group = obj(g);
    if (!group) continue;
    const groupName = str(pick(group, "displayName", "display_name")) ?? "";
    const groupDesc = resolveAntigravityGroupDescription(groupName, str(group.description) ?? undefined);
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];

    // 同组周限额是否耗尽
    const weeklyDepleted = buckets.some((b) => {
      const bucket = obj(b);
      if (!bucket) return false;
      const bName = str(pick(bucket, "displayName", "display_name")) ?? "";
      const bWindow = str(bucket.window) ?? undefined;
      const rem = num(pick(bucket, "remainingFraction", "remaining_fraction"));
      return (
        antigravityBucketKey(bName, bWindow) === "quota.label.antigravity.weekly_limit" && rem !== null && rem <= 0
      );
    });

    for (const b of buckets) {
      const bucket = obj(b);
      if (!bucket) continue;
      const name = str(pick(bucket, "displayName", "display_name")) ?? "";
      const window = str(bucket.window) ?? undefined;
      const bucketKey = antigravityBucketKey(name, window);
      const remFraction = num(pick(bucket, "remainingFraction", "remaining_fraction"));
      const usedPercent = remainingToUsed(remFraction);
      let detail = str(bucket.description) ?? groupDesc ?? undefined;
      if (weeklyDepleted && bucketKey === "quota.label.antigravity.five_hour_limit" && remFraction === 1) {
        const depleted = i18n.t("quota.label.antigravity.weekly_depleted");
        detail = detail ? `${detail} · ${depleted}` : depleted;
      }

      windows.push({
        id: `${groupName}-${name}-${windows.length}`,
        label:
          [antigravityGroupLabel(groupName), bucketKey ? i18n.t(bucketKey) : name].filter(Boolean).join(" ") ||
          i18n.t("quota.label.quota"),
        usedPercent,
        resetAt: toMs(pick(bucket, "resetTime", "reset_time")),
        detail,
      });
    }
  }
  // 对齐官方：仅解析正式 groups[].buckets[]，空或无权限时不使用静态模型清单伪造配额
  return { plan: null, windows, notes: [] };
}

export function parseDevin(payload: Json): Quota {
  const status = obj(obj(obj(payload.userStatus)?.planStatus));
  const planInfo = obj(status?.planInfo);
  const plan = str(planInfo?.planName) ?? null;
  const windows: QuotaWindow[] = [];
  for (const id of ["daily", "weekly"] as const) {
    const remaining = num(status?.[`${id}QuotaRemainingPercent`]);
    const resetSeconds = num(status?.[`${id}QuotaResetAtUnix`]);
    if (remaining !== null || resetSeconds !== null) {
      windows.push({
        id: `devin-${id}`,
        label: i18n.t(id === "daily" ? "quota.label.daily_quota" : "quota.label.weekly_quota"),
        usedPercent: remaining !== null ? clampPercent(100 - remaining) : null,
        resetAt: resetSeconds && resetSeconds > 0 ? resetSeconds * 1000 : null,
        detail: remaining !== null ? i18n.t("quota.remaining_percent", { n: Math.round(remaining) }) : undefined,
      });
    }
  }
  return { plan, windows, notes: [] };
}

export function parseMeta(payload: Json): Quota {
  const usage = obj(payload.subs_usage);
  const explicitPlan = str(payload.subs_tier_name);
  const usagePlan = str(usage?.tier);
  const plan = explicitPlan ?? usagePlan ?? null;
  const windows: QuotaWindow[] = [];

  const parseWindow = (id: string, label: string, rawVal: unknown) => {
    const raw = obj(rawVal);
    if (!raw) return;
    const used = clampPercent(num(raw.used_percent));
    const resetAt = toMs(raw.resets_at);
    const durationMins = num(raw.window_duration_mins);
    if (used !== null || resetAt !== null) {
      windows.push({
        id: `meta-${id}`,
        label,
        usedPercent: used,
        resetAt,
        detail: durationMins
          ? durationMins % 60 === 0
            ? i18n.t("quota.label.hours_window", { n: durationMins / 60 })
            : i18n.t("quota.label.minutes_window", { n: durationMins })
          : undefined,
      });
    }
  };

  if (usage) {
    parseWindow("window", i18n.t("quota.label.session_window"), usage.window);
    parseWindow("weekly", i18n.t("quota.label.weekly_quota"), usage.weekly);
  }
  return { plan, windows, notes: [] };
}

// ---------- 请求 ----------

type ApiCallResponse = { status_code: number; body?: string };

type UpstreamResult = { status: number; body: unknown };

function parseResponseBody(raw: string | undefined): unknown {
  try {
    return JSON.parse(String(raw ?? ""));
  } catch {
    // 非 JSON 响应保留原文
    return raw ?? "";
  }
}

function upstreamError(status: number, body: unknown): Error {
  const record = obj(body);
  const message =
    str(obj(record?.error)?.message) ?? str(record?.error) ?? str(record?.message) ?? String(body).slice(0, 200);
  return Object.assign(new Error(i18n.t("quota.error.upstream", { status, message: message ? `: ${message}` : "" })), {
    status,
  });
}

// 通过 CPA 的 /api-call 用该账号的凭据调用上游,$TOKEN$ 会被替换成账号 token
async function callUpstream(
  authIndex: string,
  method: string,
  url: string,
  header: Record<string, string>,
  data?: string,
): Promise<UpstreamResult> {
  const res = await api<ApiCallResponse>("/v8/management/requests/api-call", {
    method: "POST",
    body: { auth_index: authIndex, method, url, header, ...(data ? { data } : {}) },
  });
  return { status: res.status_code, body: parseResponseBody(res.body) };
}

async function upstream(authIndex: string, method: string, url: string, header: Record<string, string>, data?: string) {
  const res = await callUpstream(authIndex, method, url, header, data);
  if (res.status < 200 || res.status >= 300) throw upstreamError(res.status, res.body);
  return obj(res.body) ?? {};
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// 结果未知时复用同一个 request_id 重试,避免把一次重置操作重复提交成两次
const RESET_RETRY_WINDOW_MS = 10 * 60_000;
const pendingResets = new Map<string, { requestId: string; at: number }>();

function resetRequestId(key: string): string {
  const existing = pendingResets.get(key);
  if (existing && Date.now() - existing.at < RESET_RETRY_WINDOW_MS) return existing.requestId;
  const requestId = newRequestId();
  pendingResets.set(key, { requestId, at: Date.now() });
  return requestId;
}

function clearResetRequest(key: string) {
  pendingResets.delete(key);
}

const ORGANIZATION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 领取一次 Claude 主动重置;返回上游终态代码 */
export async function claimClaudeResetGrant(file: AuthFile, grantId: string): Promise<string> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) throw new Error(i18n.t("quota.error.missing_auth_index"));
  const profile = await upstream(authIndex, "GET", CLAUDE_PROFILE_URL, CLAUDE_RESET_HEADERS).catch(() => null);
  const organization = str(obj(profile?.organization)?.uuid);
  if (!organization || !ORGANIZATION_UUID_RE.test(organization)) {
    throw new Error(i18n.t("quota.reset_grant.malformed"));
  }
  const key = `claude|${authIndex}|${grantId}`;
  const res = await callUpstream(
    authIndex,
    "POST",
    `${CLAUDE_RESET_GRANT_CLAIM_BASE}/${organization.toLowerCase()}/reset_rate_limits`,
    CLAUDE_RESET_HEADERS,
    JSON.stringify({ program: "cedar_ember", grant_id: grantId, request_id: resetRequestId(key) }),
  );
  if (res.status === 429) {
    clearResetRequest(key);
    return "rate_limited";
  }
  if (res.status === 401 || res.status === 403) {
    clearResetRequest(key);
    return "auth_error";
  }
  const result = str(obj(res.body)?.result);
  if (res.status >= 200 && res.status < 300 && result) {
    clearResetRequest(key);
    return result;
  }
  throw new Error(i18n.t("quota.reset_grant.unknown"));
}

/** 使用一张 Codex 主动重置卡,并清除该凭据的路由额度冷却 */
export async function consumeCodexResetCredit(file: AuthFile): Promise<string> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) throw new Error(i18n.t("quota.error.missing_auth_index"));
  const accountId = findField(file, ["chatgpt_account_id", "chatgptAccountId"]);
  const header = accountId ? { ...HEADERS.codex, "Chatgpt-Account-Id": accountId } : HEADERS.codex;
  const key = `codex|${authIndex}`;
  const res = await callUpstream(
    authIndex,
    "POST",
    CODEX_RESET_CREDITS_CONSUME_URL,
    header,
    JSON.stringify({ redeem_request_id: resetRequestId(key) }),
  );
  if (res.status < 200 || res.status >= 300) {
    // 4xx 确定未消耗;5xx 结果未知,保留 request_id 供重试复用
    if (res.status >= 400 && res.status < 500) clearResetRequest(key);
    throw upstreamError(res.status, res.body);
  }
  const code = str(obj(res.body)?.code);
  if (code !== "reset" && code !== "already_redeemed") {
    throw new Error(i18n.t("quota.codex_reset.not_confirmed"));
  }
  clearResetRequest(key);
  try {
    await api("/v8/management/routing/cooldown/reset", {
      method: "POST",
      body: { auth_index: authIndex },
    });
  } catch {
    // 重置卡已经消耗,冷却清除失败时提示用户手动处理,不要再次消耗
    throw new Error(i18n.t("quota.codex_reset.cooldown_failed"));
  }
  return code;
}

// 在凭据条目或认证文件里找指定字段,JWT 字符串会解码后再找
function findField(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 3) return null;
  if (typeof value === "string" && value.split(".").length === 3) {
    try {
      return findField(JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))), keys, depth + 1);
    } catch {
      return null;
    }
  }
  const record = obj(value);
  if (!record) return null;
  for (const key of keys) {
    const found = str(record[key]);
    if (found) return found;
  }
  for (const nested of ["id_token", "https://api.openai.com/auth"]) {
    const found = findField(record[nested], keys, depth + 1);
    if (found) return found;
  }
  return null;
}

// 列表接口不返回 dca_token、xAI 的 sub 等字段,只能下载认证文件读取;按 auth_index 缓存,查询失败时清掉重新下载
const fileCache = new Map<string, Promise<Json | null>>();

function credentialFile(file: AuthFile, authIndex: string): Promise<Json | null> {
  if (file.runtime_only) return Promise.resolve(null);
  let cached = fileCache.get(authIndex);
  if (!cached) {
    cached = api<unknown>(`/v8/management/credentials/download?name=${encodeURIComponent(file.name)}`).then((raw) =>
      obj(typeof raw === "string" ? JSON.parse(raw) : raw),
    );
    fileCache.set(authIndex, cached);
  }
  return cached;
}
function extractHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

async function resolveAntigravityProjectId(file: AuthFile, authIndex: string): Promise<string> {
  const direct = str(file.project_id);
  if (direct) return direct;
  const raw = await credentialFile(file, authIndex);
  if (raw) {
    const installed = obj(raw.installed);
    const web = obj(raw.web);
    const fromRaw =
      str(raw.project_id) ||
      str(raw.projectId) ||
      str(installed?.project_id) ||
      str(installed?.projectId) ||
      str(web?.project_id) ||
      str(web?.projectId);
    if (fromRaw) return fromRaw;
  }
  return "";
}

function resolveKimiUrl(file: AuthFile): string {
  const provider = (file.provider ?? "").toLowerCase();
  const name = file.name ?? "";
  if (provider === "kimi-ai" || provider === "kimi.ai" || /kimi-ai|kimi\.ai/i.test(name)) {
    return KIMI_AI_USAGE_URL;
  }
  return KIMI_USAGE_URL;
}

// 插件 QuotaProvider / quota_probe 返回的统一结构:subscription、summary、groups[].buckets[]
export function parsePluginQuota(payload: Json): Quota {
  const subscription = obj(payload.subscription);
  const summary = Array.isArray(payload.summary) ? payload.summary : [];
  const notes = summary.flatMap((item) => {
    const m = obj(item);
    const value = num(m?.value);
    if (!m || value === null) return [];
    const currency = m.format === "currency" ? str(m.currency) : null;
    const text = currency
      ? new Intl.NumberFormat(i18n.language, { style: "currency", currency }).format(value)
      : `${value}${str(m.unit) ? ` ${m.unit}` : ""}`;
    return [`${str(m.label) ?? str(m.key) ?? ""} ${text}`.trim()];
  });
  return {
    plan: str(subscription?.plan) ?? str(pick(subscription, "tierName", "tier_name")),
    windows: parseAntigravity(payload).windows,
    notes,
  };
}

// 额度查询并发上限:排序需要全部账号的数据所以不分页,只限制同时在途的请求数
const MAX_CONCURRENT = 4;
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await task();
  } finally {
    // 名额直接交给下一个排队的请求
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export function fetchQuota(file: AuthFile): Promise<Quota> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) return Promise.reject(new Error(i18n.t("quota.error.missing_auth_index")));
  return limited(() => fetchQuotaNow(file, authIndex)).catch((error) => {
    fileCache.delete(authIndex);
    throw error;
  });
}

/**
 * 通过插件额度提供方重置该凭据的额度,CPA 会顺带清掉路由侧的额度冷却。
 * v8 只提供 /plugins/:id/quota,插件 id 优先取凭据的 quota_plugin_id(旧版按 provider 反查)。
 */
export async function resetQuota(file: AuthFile): Promise<{ message?: string }> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) throw new Error(i18n.t("quota.error.missing_auth_index"));
  const pluginId = await quotaPluginId(file);
  if (!pluginId) throw new Error(i18n.t("quota.error.missing_plugin_provider"));
  return api<{ message?: string }>(pluginQuotaPath(pluginId, authIndex), { method: "DELETE" });
}

const pluginQuotaPath = (pluginId: string, authIndex: string) =>
  `/v8/management/plugins/${encodeURIComponent(pluginId)}/quota?auth_index=${encodeURIComponent(authIndex)}`;

// 凭据只带 quota_provider(provider 标识),插件额度端点按插件 id 定位,所以先从插件列表建映射。
// 同一批查询共用一次请求,60 秒内复用结果;失败时清掉缓存,避免把错误一直缓存下去。
const PLUGIN_MAP_TTL = 60_000;
let pluginMap: { at: number; value: Promise<Map<string, string>> } | null = null;

function quotaPluginIds(): Promise<Map<string, string>> {
  if (!pluginMap || Date.now() - pluginMap.at > PLUGIN_MAP_TTL) {
    const value = api<{ plugins?: { id?: string; quota_provider?: string }[] }>("/v8/management/plugins")
      .then((res) => {
        const map = new Map<string, string>();
        for (const plugin of res.plugins ?? []) {
          const provider = (plugin.quota_provider ?? "").trim().toLowerCase();
          if (provider && plugin.id) map.set(provider, plugin.id);
        }
        return map;
      })
      .catch((error) => {
        pluginMap = null;
        throw error;
      });
    pluginMap = { at: Date.now(), value };
  }
  return pluginMap.value;
}

async function quotaPluginId(file: AuthFile): Promise<string | undefined> {
  // v8 凭据直接带插件 id;旧版只带 provider 标识,再从插件列表反查
  const direct = (file.quota_plugin_id ?? "").trim();
  if (direct) return direct;
  const provider = (file.quota_provider ?? "").trim().toLowerCase();
  if (!provider) return undefined;
  return (await quotaPluginIds()).get(provider);
}

/** 指定插件额度提供方查询一个凭据的额度 */
export async function fetchPluginQuota(pluginId: string, authIndex: string): Promise<Quota> {
  return parsePluginQuota(await api<Json>(pluginQuotaPath(pluginId, authIndex)));
}

/** 指定插件额度提供方重置一个凭据的额度,同样会清除路由额度冷却 */
export function resetPluginQuota(pluginId: string, authIndex: string): Promise<{ message?: string }> {
  return api<{ message?: string }>(pluginQuotaPath(pluginId, authIndex), { method: "DELETE" });
}

async function fetchQuotaNow(file: AuthFile, authIndex: string): Promise<Quota> {
  // v8 没有凭据级额度路由:凭据带 quota_provider 时映射到插件 id 查询;
  // 只有声明式 quota_probe(无插件提供方)的凭据 v8 无从查询,退回厂商直连
  if (file.supports_quota) {
    const pluginId = await quotaPluginId(file);
    if (pluginId) {
      return parsePluginQuota(
        await api<Json>(pluginQuotaPath(pluginId, authIndex), {
          method: "POST",
          body: { auth_index: authIndex },
        }),
      );
    }
  }

  switch ((file.provider ?? "").toLowerCase()) {
    case "codex": {
      const accountId = findField(file, ["chatgpt_account_id", "chatgptAccountId"]);
      const header = accountId ? { ...HEADERS.codex, "Chatgpt-Account-Id": accountId } : HEADERS.codex;
      const [usage, resetCredits] = await Promise.all([
        upstream(authIndex, "GET", CODEX_USAGE_URL, header),
        callUpstream(authIndex, "GET", CODEX_RESET_CREDITS_URL, {
          ...header,
          Accept: "application/json",
          "OpenAI-Beta": "codex-1",
          Originator: "Codex Desktop",
        })
          .then((res) => (res.status >= 200 && res.status < 300 ? obj(res.body) : null))
          .catch(() => null),
      ]);
      const quota = parseCodex(usage, Date.now(), resetCredits);
      quota.codexResetCredits ??= {
        count: null,
        credits: [],
        error: i18n.t("quota.error.reset_credits"),
      };
      return quota;
    }
    case "claude": {
      const [usage, profile, grants] = await Promise.all([
        upstream(authIndex, "GET", CLAUDE_USAGE_URL, HEADERS.claude),
        upstream(authIndex, "GET", CLAUDE_PROFILE_URL, HEADERS.claude).catch(() => null),
        upstream(authIndex, "GET", CLAUDE_RESET_GRANT_STATUS_URL, CLAUDE_RESET_HEADERS).catch(() => null),
      ]);
      return parseClaude(usage, profile, grants);
    }
    case "kimi": {
      const url = resolveKimiUrl(file);
      return parseKimi(await upstream(authIndex, "GET", url, HEADERS.kimi));
    }
    case "xai": {
      const userId = findField(await credentialFile(file, authIndex), ["sub", "user_id", "userId"]);
      const header = userId ? { ...HEADERS.xai, "x-userid": userId } : HEADERS.xai;
      const [weekly, monthly] = await Promise.all([
        upstream(authIndex, "GET", XAI_WEEKLY_URL, header),
        upstream(authIndex, "GET", XAI_MONTHLY_URL, header).catch(() => null),
      ]);
      return parseXai(weekly, monthly);
    }
    case "antigravity": {
      const projectId = await resolveAntigravityProjectId(file, authIndex);
      if (!projectId) {
        throw new Error(i18n.t("quota.error.no_data"));
      }
      const data = JSON.stringify({ project: projectId });
      let lastError: unknown = new Error(i18n.t("quota.error.no_data"));
      for (const url of ANTIGRAVITY_QUOTA_URLS) {
        try {
          const quota = parseAntigravity(await upstream(authIndex, "POST", url, HEADERS.antigravity, data));
          return quota;
        } catch (error) {
          lastError = error;
          const status = extractHttpStatus(error);
          if (status === 401 || status === 403 || status === 404 || status === 429) {
            break;
          }
        }
      }
      throw lastError;
    }
    case "devin": {
      const data = JSON.stringify({
        metadata: {
          ideName: "chisel",
          ideVersion: "3000.10.21",
          apiKey: "$TOKEN$",
          locale: "en",
          os: "darwin",
          extensionVersion: "3000.10.21",
          clientName: "chisel",
        },
      });
      return parseDevin(await upstream(authIndex, "POST", DEVIN_STATUS_URL, HEADERS.devin, data));
    }
    case "meta": {
      const dcaToken = findField(await credentialFile(file, authIndex), ["dca_token", "dcaToken"]);
      if (!dcaToken) throw new Error(i18n.t("quota.error.missing_dca_token"));
      const header = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${dcaToken}`,
        "x-api-version": "1.0.0",
      };
      return parseMeta(await upstream(authIndex, "POST", META_MUSE_QUOTA_URL, header, "{}"));
    }
    default:
      throw new Error(i18n.t("quota.error.unsupported"));
  }
}
