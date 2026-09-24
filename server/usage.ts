import { db } from "./db";
import { costOf, priceFor } from "./prices";

export type Range = { from: number; to: number };

export type Totals = {
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cost: number;
  // 模型没有匹配到价格的请求数,费用不含这部分
  unpricedRequests: number;
  avgLatencyMs: number | null;
};

type Row = {
  key: string | number;
  model: string;
  requests: number;
  failed: number;
  prompt: number;
  cache_read: number;
  cache_creation: number;
  output: number;
  reasoning: number;
  total: number;
  latency_sum: number;
  latency_count: number;
};

export const BREAKDOWN_COLUMNS = {
  model: "model",
  account: "source",
  apiKey: "api_key",
  provider: "provider",
} as const;

export type BreakdownBy = keyof typeof BREAKDOWN_COLUMNS;

type Acc = Totals & { latencySum: number; latencyCount: number };

function emptyAcc(): Acc {
  return {
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    unpricedRequests: 0,
    avgLatencyMs: null,
    latencySum: 0,
    latencyCount: 0,
  };
}

function finish({ latencySum, latencyCount, ...totals }: Acc): Totals {
  return { ...totals, avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null };
}

// 按 keyExpr + model 分组求和,再在内存里按 key 合并;费用按模型单价计算,所以 model 必须参与分组
function aggregate(keyExpr: string, range: Range, params: Record<string, number> = {}): Map<string | number, Acc> {
  const rows = db
    .query<Row, Record<string, number>>(`
      SELECT ${keyExpr} AS key, model,
        COUNT(*) AS requests,
        SUM(failed) AS failed,
        SUM(prompt_tokens) AS prompt,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_creation_tokens) AS cache_creation,
        SUM(output_tokens) AS output,
        SUM(reasoning_tokens) AS reasoning,
        SUM(total_tokens) AS total,
        COALESCE(SUM(latency_ms), 0) AS latency_sum,
        COUNT(latency_ms) AS latency_count
      FROM usage_events
      WHERE ts >= $from AND ts < $to
      GROUP BY key, model
    `)
    .all({ from: range.from, to: range.to, ...params });

  const groups = new Map<string | number, Acc>();
  for (const row of rows) {
    let acc = groups.get(row.key);
    if (!acc) {
      acc = emptyAcc();
      groups.set(row.key, acc);
    }
    acc.requests += row.requests;
    acc.failed += row.failed;
    acc.inputTokens += row.prompt + row.cache_read + row.cache_creation;
    acc.outputTokens += row.output;
    acc.cacheReadTokens += row.cache_read;
    acc.cacheCreationTokens += row.cache_creation;
    acc.reasoningTokens += row.reasoning;
    acc.totalTokens += row.total;
    acc.latencySum += row.latency_sum;
    acc.latencyCount += row.latency_count;
    const price = priceFor(row.model);
    if (price) {
      acc.cost += costOf(price, {
        promptTokens: row.prompt,
        cacheReadTokens: row.cache_read,
        cacheCreationTokens: row.cache_creation,
        outputTokens: row.output,
      });
    } else {
      acc.unpricedRequests += row.requests;
    }
  }
  return groups;
}

export function summary(range: Range): Totals {
  return finish(aggregate("0", range).get(0) ?? emptyAcc());
}

export function timeseries(range: Range, bucketMs: number, offsetMs: number) {
  const groups = aggregate("CAST((ts + $offset) / $bucket AS INTEGER)", range, { offset: offsetMs, bucket: bucketMs });
  const first = Math.floor((range.from + offsetMs) / bucketMs);
  const last = Math.floor((range.to - 1 + offsetMs) / bucketMs);
  const points = [];
  for (let i = first; i <= last; i++) {
    const acc = groups.get(i) ?? emptyAcc();
    points.push({ t: i * bucketMs - offsetMs, ...finish(acc) });
  }
  return points;
}

export function breakdown(range: Range, by: BreakdownBy) {
  const groups = aggregate(BREAKDOWN_COLUMNS[by], range);
  return [...groups.entries()]
    .map(([key, acc]) => ({ key: String(key), ...finish(acc) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);
}

export type EventFilter = Range & {
  model?: string;
  account?: string;
  apiKey?: string;
  status?: "success" | "failed";
  limit: number;
  offset: number;
};

type EventRow = {
  id: number;
  ts: number;
  request_id: string;
  provider: string;
  model: string;
  alias: string;
  source: string;
  api_key: string;
  endpoint: string;
  prompt_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  failed: number;
};

export function events(filter: EventFilter) {
  const where = ["ts >= $from", "ts < $to"];
  const params: Record<string, string | number> = { from: filter.from, to: filter.to };
  if (filter.model) {
    where.push("model = $model");
    params.model = filter.model;
  }
  if (filter.account) {
    where.push("source = $account");
    params.account = filter.account;
  }
  if (filter.apiKey) {
    where.push("api_key = $apiKey");
    params.apiKey = filter.apiKey;
  }
  if (filter.status) where.push(filter.status === "failed" ? "failed = 1" : "failed = 0");
  const clause = where.join(" AND ");

  const total =
    db.query<{ n: number }, typeof params>(`SELECT COUNT(*) AS n FROM usage_events WHERE ${clause}`).get(params)?.n ??
    0;
  const rows = db
    .query<EventRow, typeof params>(
      `SELECT id, ts, request_id, provider, model, alias, source, api_key, endpoint, prompt_tokens, cache_read_tokens,
        cache_creation_tokens, output_tokens, reasoning_tokens, total_tokens, latency_ms, failed
      FROM usage_events WHERE ${clause} ORDER BY ts DESC, id DESC LIMIT $limit OFFSET $offset`,
    )
    .all({ ...params, limit: filter.limit, offset: filter.offset });

  const items = rows.map((r) => {
    const price = priceFor(r.model);
    return {
      id: r.id,
      ts: r.ts,
      requestId: r.request_id,
      provider: r.provider,
      model: r.model,
      alias: r.alias,
      account: r.source,
      apiKey: r.api_key,
      endpoint: r.endpoint,
      inputTokens: r.prompt_tokens + r.cache_read_tokens + r.cache_creation_tokens,
      cacheReadTokens: r.cache_read_tokens,
      outputTokens: r.output_tokens,
      reasoningTokens: r.reasoning_tokens,
      totalTokens: r.total_tokens,
      latencyMs: r.latency_ms,
      failed: r.failed === 1,
      cost: price
        ? costOf(price, {
            promptTokens: r.prompt_tokens,
            cacheReadTokens: r.cache_read_tokens,
            cacheCreationTokens: r.cache_creation_tokens,
            outputTokens: r.output_tokens,
          })
        : null,
    };
  });
  return { total, items };
}

// 出现过的模型及其请求数,用于价格页展示匹配情况
export function usedModels() {
  return db
    .query<{ model: string; requests: number; last_ts: number }, []>(
      "SELECT model, COUNT(*) AS requests, MAX(ts) AS last_ts FROM usage_events GROUP BY model ORDER BY requests DESC",
    )
    .all();
}

export function eventCount(): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM usage_events").get()?.n ?? 0;
}
