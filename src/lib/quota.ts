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

export type Quota = { plan: string | null; windows: QuotaWindow[]; notes: string[] };

type Json = Record<string, unknown>;

const HOUR = 3600;
const DAY = 86_400;

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const XAI_WEEKLY_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const XAI_MONTHLY_URL = "https://cli-chat-proxy.grok.com/v1/billing";
const ANTIGRAVITY_URLS = [
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
];
// Antigravity 认证文件里没有 project_id 时,官方客户端使用的默认项目
const ANTIGRAVITY_DEFAULT_PROJECT = "bamboo-precept-lgxtn";

// 上游会校验客户端标识,取值与官方 CLI 保持一致
const HEADERS = {
  codex: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)",
  },
  claude: { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json", "anthropic-beta": "oauth-2025-04-20" },
  kimi: { Authorization: "Bearer $TOKEN$" },
  xai: {
    Authorization: "Bearer $TOKEN$",
    "x-xai-token-auth": "xai-grok-cli",
    "x-grok-client-version": "0.2.101",
    accept: "*/*",
    "user-agent": "grok-pager/0.2.101 grok-shell/0.2.101 (macos; aarch64)",
  },
  antigravity: {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
  },
} satisfies Record<string, Record<string, string>>;

const QUOTA_PROVIDERS = new Set(["codex", "claude", "antigravity", "kimi", "xai"]);

export function supportsQuota(file: AuthFile): boolean {
  return QUOTA_PROVIDERS.has((file.provider ?? "").toLowerCase()) && Boolean(file.auth_index);
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
  if (!seconds) return "额度";
  if (seconds <= 6 * HOUR) return `${Math.round(seconds / HOUR)} 小时`;
  if (seconds >= 6.5 * DAY && seconds <= 7.5 * DAY) return "每周";
  if (seconds >= 27 * DAY && seconds <= 32 * DAY) return "每月";
  if (seconds >= DAY) return `${Math.round(seconds / DAY)} 天`;
  return `${Math.round(seconds / HOUR)} 小时`;
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.min(Math.max(value, 0), 100);
}

// ---------- 各家解析 ----------

export function parseCodex(payload: Json, now = Date.now()): Quota {
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
  addLimit(pick(payload, "code_review_rate_limit", "codeReviewRateLimit"), "代码审查");
  const extra = pick(payload, "additional_rate_limits", "additionalRateLimits");
  if (Array.isArray(extra)) {
    for (const item of extra) {
      const record = obj(item);
      const name = str(pick(record, "limit_name", "limitName", "metered_feature")) ?? "附加";
      addLimit(pick(record, "rate_limit", "rateLimit"), name);
    }
  }

  const notes: string[] = [];
  const credits = obj(payload.credits);
  if (credits?.unlimited === true) notes.push("积分不限量");
  else if (num(credits?.balance) !== null) notes.push(`积分余额 ${num(credits?.balance)}`);
  return { plan: str(pick(payload, "plan_type", "planType")), windows, notes };
}

const CLAUDE_WINDOWS: [string, string][] = [
  ["five_hour", "5 小时"],
  ["seven_day", "每周"],
  ["seven_day_opus", "每周 Opus"],
  ["seven_day_sonnet", "每周 Sonnet"],
  ["seven_day_oauth_apps", "每周 OAuth 应用"],
  ["seven_day_cowork", "每周 Cowork"],
];

export function parseClaude(payload: Json, profile: Json | null): Quota {
  const windows: QuotaWindow[] = [];
  for (const [key, label] of CLAUDE_WINDOWS) {
    const w = obj(payload[key]);
    if (!w) continue;
    windows.push({ id: key, label, usedPercent: clampPercent(num(w.utilization)), resetAt: toMs(w.resets_at) });
  }
  const extra = obj(payload.extra_usage);
  if (extra?.is_enabled === true) {
    const used = num(extra.used_credits) ?? 0;
    const limit = num(extra.monthly_limit) ?? 0;
    windows.push({
      id: "extra_usage",
      label: "每月额外用量",
      usedPercent: clampPercent(num(extra.utilization) ?? (limit > 0 ? (used / limit) * 100 : null)),
      resetAt: null,
      // 金额单位是美分
      detail: `$${(used / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`,
    });
  }
  const account = obj(profile?.account);
  const tier = str(obj(profile?.organization)?.rate_limit_tier);
  const plan = account?.has_claude_max === true ? "Max" : account?.has_claude_pro === true ? "Pro" : tier;
  return { plan, windows, notes: [] };
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
  if (usage) add("usage", "每周", usage, usage);
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
        label: type.includes("month") ? "每月" : type.includes("week") ? "每周" : "当前周期",
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
  const used = num(pick(m, "used"));
  if (m && limit !== null && limit > 0 && used !== null) {
    windows.push({
      id: "monthly",
      label: "每月",
      usedPercent: clampPercent((used / limit) * 100),
      resetAt: toMs(pick(m, "billingPeriodEnd", "billing_period_end")),
      // 金额单位是美分
      detail: `$${(used / 100).toFixed(2)} / $${(limit / 100).toFixed(2)}`,
    });
  }
  return { plan: null, windows, notes: [] };
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
    const groupName = str(pick(group, "displayName", "display_name")) ?? "";
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    for (const b of buckets) {
      const bucket = obj(b);
      if (!bucket) continue;
      const name = str(pick(bucket, "displayName", "display_name", "window")) ?? "";
      windows.push({
        id: `${groupName}-${name}-${windows.length}`,
        label: [groupName, name].filter(Boolean).join(" ") || "额度",
        usedPercent: remainingToUsed(pick(bucket, "remainingFraction", "remaining_fraction")),
        resetAt: toMs(pick(bucket, "resetTime", "reset_time")),
      });
    }
  }
  if (windows.length === 0) {
    // fetchAvailableModels 返回按模型的 quotaInfo;同名模型去重
    const models = obj(payload.models) ?? {};
    const seen = new Set<string>();
    for (const [id, value] of Object.entries(models)) {
      const model = obj(value);
      const info = obj(pick(model, "quotaInfo", "quota_info"));
      if (!info) continue;
      const label = str(pick(model, "displayName", "display_name")) ?? id;
      if (seen.has(label)) continue;
      seen.add(label);
      windows.push({
        id,
        label,
        usedPercent: remainingToUsed(pick(info, "remainingFraction", "remaining_fraction", "remaining")),
        resetAt: toMs(pick(info, "resetTime", "reset_time")),
      });
    }
  }
  return { plan: null, windows, notes: [] };
}

// ---------- 请求 ----------

type ApiCallResponse = { status_code: number; body?: string };

// 通过 CPA 的 /api-call 用该账号的凭据调用上游,$TOKEN$ 会被替换成账号 token
async function upstream(authIndex: string, method: string, url: string, header: Record<string, string>, data?: string) {
  const res = await api<ApiCallResponse>("/v0/management/api-call", {
    method: "POST",
    body: { auth_index: authIndex, method, url, header, ...(data ? { data } : {}) },
  });
  let body: unknown = res.body ?? "";
  try {
    body = JSON.parse(String(res.body ?? ""));
  } catch {
    // 非 JSON 响应保留原文
  }
  if (res.status_code < 200 || res.status_code >= 300) {
    const record = obj(body);
    const message =
      str(obj(record?.error)?.message) ?? str(record?.error) ?? str(record?.message) ?? String(body).slice(0, 200);
    throw new Error(`上游返回 ${res.status_code}${message ? `:${message}` : ""}`);
  }
  return obj(body) ?? {};
}

// 在认证文件条目(含 id_token、metadata 等嵌套字段)里找指定字段,JWT 字符串会解码后再找
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
  for (const nested of ["id_token", "metadata", "attributes", "https://api.openai.com/auth"]) {
    const found = findField(record[nested], keys, depth + 1);
    if (found) return found;
  }
  return null;
}

async function antigravityProject(file: AuthFile): Promise<string> {
  const direct = findField(file, ["project_id", "projectId"]);
  if (direct) return direct;
  try {
    const raw = await api<unknown>(`/v0/management/auth-files/download?name=${encodeURIComponent(file.name)}`);
    const parsed = obj(typeof raw === "string" ? JSON.parse(raw) : raw);
    return findField(parsed, ["project_id", "projectId"]) ?? ANTIGRAVITY_DEFAULT_PROJECT;
  } catch {
    return ANTIGRAVITY_DEFAULT_PROJECT;
  }
}

export async function fetchQuota(file: AuthFile): Promise<Quota> {
  const authIndex = file.auth_index ?? "";
  switch ((file.provider ?? "").toLowerCase()) {
    case "codex": {
      const accountId = findField(file, ["chatgpt_account_id", "chatgptAccountId"]);
      const header = accountId ? { ...HEADERS.codex, "Chatgpt-Account-Id": accountId } : HEADERS.codex;
      return parseCodex(await upstream(authIndex, "GET", CODEX_USAGE_URL, header));
    }
    case "claude": {
      const [usage, profile] = await Promise.all([
        upstream(authIndex, "GET", CLAUDE_USAGE_URL, HEADERS.claude),
        upstream(authIndex, "GET", CLAUDE_PROFILE_URL, HEADERS.claude).catch(() => null),
      ]);
      return parseClaude(usage, profile);
    }
    case "kimi":
      return parseKimi(await upstream(authIndex, "GET", KIMI_USAGE_URL, HEADERS.kimi));
    case "xai": {
      const userId = findField(file, ["sub", "user_id", "userId"]);
      const header = userId ? { ...HEADERS.xai, "x-userid": userId } : HEADERS.xai;
      const [weekly, monthly] = await Promise.all([
        upstream(authIndex, "GET", XAI_WEEKLY_URL, header),
        upstream(authIndex, "GET", XAI_MONTHLY_URL, header).catch(() => null),
      ]);
      return parseXai(weekly, monthly);
    }
    case "antigravity": {
      const data = JSON.stringify({ project: await antigravityProject(file) });
      let lastError: unknown = new Error("没有返回额度数据");
      for (const url of ANTIGRAVITY_URLS) {
        try {
          const quota = parseAntigravity(await upstream(authIndex, "POST", url, HEADERS.antigravity, data));
          if (quota.windows.length > 0) return quota;
        } catch (error) {
          lastError = error;
          if (error instanceof Error && error.message.startsWith("上游返回 429")) break;
        }
      }
      throw lastError;
    }
    default:
      throw new Error("该提供商不支持额度查询");
  }
}
