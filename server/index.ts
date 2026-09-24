import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { getConnInfo, serveStatic } from "hono/bun";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { collectorStatus, runCollector } from "./collector";
import { config } from "./config";
import { db } from "./db";
import { errorMessage, log } from "./log";
import { priceCount, priceFor, priceStatus, pricesSyncedAt, runPriceSync, syncPrices } from "./prices";
import {
  BREAKDOWN_COLUMNS,
  type BreakdownBy,
  breakdown,
  eventCount,
  events,
  type Range,
  summary,
  timeseries,
  usedModels,
} from "./usage";

const SESSION_COOKIE = "cpa_dashboard_session";
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const SESSION_SECRET = new Bun.CryptoHasher("sha256", config.managementKey).update("session").digest("hex");
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_BUCKETS = 2000;

class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const app = new Hono();

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ code: error.code, message: error.message }, error.status);
  log("error", "请求处理失败", { path: c.req.path, error: errorMessage(error) });
  return c.json({ code: "internal_error", message: "服务内部错误" }, 500);
});

app.get("/healthz", (c) => c.json({ ok: true }));

// ---------- 登录 ----------

const loginFails = new Map<string, { count: number; lockedUntil: number }>();

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || getConnInfo(c).remote.address || "unknown";
}

function keyMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(config.managementKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isSecure(c: Context): boolean {
  return c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
}

const requireSession: MiddlewareHandler = async (c, next) => {
  const value = await getSignedCookie(c, SESSION_SECRET, SESSION_COOKIE);
  if (!value || Number(value) < Date.now()) throw new ApiError(401, "unauthorized", "未登录或登录已过期");
  await next();
};

app.get("/api/session", requireSession, (c) => c.json({ authenticated: true }));

app.post("/api/session", async (c) => {
  const ip = clientIp(c);
  const state = loginFails.get(ip);
  if (state && state.lockedUntil > Date.now()) {
    throw new ApiError(429, "too_many_attempts", "失败次数过多，请 15 分钟后再试");
  }
  const body = await c.req.json<{ key?: unknown }>().catch(() => ({ key: undefined }));
  if (typeof body.key !== "string" || !keyMatches(body.key)) {
    const count = (state?.count ?? 0) + 1;
    loginFails.set(ip, { count, lockedUntil: count >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0 });
    log("warn", "登录失败", { ip, count });
    throw new ApiError(401, "invalid_key", "管理密钥不正确");
  }
  loginFails.delete(ip);
  await setSignedCookie(c, SESSION_COOKIE, String(Date.now() + SESSION_TTL_MS), SESSION_SECRET, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isSecure(c),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.body(null, 204);
});

app.delete("/api/session", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

app.use("/api/*", requireSession);
app.use("/v0/*", requireSession);

// ---------- 用量 ----------

function numberParam(c: Context, name: string): number | undefined {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new ApiError(400, "invalid_param", `参数 ${name} 必须是数字`);
  return value;
}

function parseRange(c: Context): Range {
  const to = numberParam(c, "to") ?? Date.now();
  const from = numberParam(c, "from") ?? to - DAY_MS;
  if (from >= to) throw new ApiError(400, "invalid_range", "from 必须小于 to");
  return { from, to };
}

app.get("/api/usage/summary", (c) => c.json(summary(parseRange(c))));

app.get("/api/usage/timeseries", (c) => {
  const range = parseRange(c);
  const bucket = c.req.query("bucket") === "day" ? DAY_MS : HOUR_MS;
  // 浏览器时区相对 UTC 的偏移(分钟),用于按本地日期/小时分桶
  const tz = numberParam(c, "tz") ?? 0;
  if (Math.abs(tz) > 14 * 60) throw new ApiError(400, "invalid_param", "参数 tz 超出范围");
  if ((range.to - range.from) / bucket > MAX_BUCKETS) throw new ApiError(400, "invalid_range", "时间范围过大");
  return c.json(timeseries(range, bucket, tz * 60_000));
});

app.get("/api/usage/breakdown", (c) => {
  const by = c.req.query("by") ?? "model";
  if (!(by in BREAKDOWN_COLUMNS)) throw new ApiError(400, "invalid_param", "参数 by 不支持");
  return c.json(breakdown(parseRange(c), by as BreakdownBy));
});

app.get("/api/usage/events", (c) => {
  const status = c.req.query("status");
  const limit = numberParam(c, "limit") ?? 50;
  const offset = numberParam(c, "offset") ?? 0;
  if (limit < 1 || limit > 500 || offset < 0) throw new ApiError(400, "invalid_param", "分页参数不合法");
  return c.json(
    events({
      ...parseRange(c),
      model: c.req.query("model") || undefined,
      account: c.req.query("account") || undefined,
      apiKey: c.req.query("apiKey") || undefined,
      status: status === "failed" || status === "success" ? status : undefined,
      limit,
      offset,
    }),
  );
});

// ---------- 价格 ----------

function priceSnapshot() {
  const models = usedModels().map((m) => {
    const price = priceFor(m.model);
    return {
      model: m.model,
      requests: m.requests,
      lastUsedAt: m.last_ts,
      price: price && {
        matched: price.model,
        provider: price.provider,
        // 转成美元 / 百万 token,方便展示
        input: price.input * 1e6,
        output: price.output * 1e6,
        cacheRead: price.cache_read === null ? null : price.cache_read * 1e6,
        cacheCreation: price.cache_creation === null ? null : price.cache_creation * 1e6,
      },
    };
  });
  return {
    syncedAt: pricesSyncedAt() || null,
    syncing: priceStatus.syncing,
    lastError: priceStatus.lastError || null,
    catalogSize: priceCount(),
    models,
  };
}

app.get("/api/prices", (c) => c.json(priceSnapshot()));

app.post("/api/prices/sync", async (c) => {
  await syncPrices();
  if (priceStatus.lastError) throw new ApiError(502, "price_sync_failed", priceStatus.lastError);
  return c.json(priceSnapshot());
});

// ---------- 状态 ----------

app.get("/api/status", (c) =>
  c.json({
    cpaUrl: config.cpaUrl,
    collector: {
      lastPollAt: collectorStatus.lastPollAt || null,
      lastSuccessAt: collectorStatus.lastSuccessAt || null,
      lastError: collectorStatus.lastError || null,
      collectedSinceStart: collectorStatus.collected,
    },
    events: eventCount(),
  }),
);

app.all("/api/*", () => {
  throw new ApiError(404, "not_found", "接口不存在");
});

// ---------- CPA 管理接口转发 ----------

app.all("/v0/management/*", async (c) => {
  const url = new URL(c.req.url);
  const headers = new Headers({ Authorization: `Bearer ${config.managementKey}` });
  for (const name of ["content-type", "accept"]) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const method = c.req.method;
  let res: Response;
  try {
    res = await fetch(`${config.cpaUrl}${url.pathname}${url.search}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer(),
      redirect: "manual",
    });
  } catch (error) {
    throw new ApiError(502, "cpa_unreachable", `无法连接 CPA：${errorMessage(error)}`);
  }
  const out = new Headers(res.headers);
  // fetch 已经解压过响应体
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(res.body, { status: res.status, headers: out });
});

// ---------- 前端静态资源 ----------

app.use("/*", serveStatic({ root: config.staticDir }));
app.get("*", serveStatic({ path: `${config.staticDir}/index.html` }));

Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 120 });
log("info", "服务已启动", { port: config.port, cpaUrl: config.cpaUrl });

runCollector();
runPriceSync();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
