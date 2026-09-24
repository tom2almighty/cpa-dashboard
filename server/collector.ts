import { config } from "./config";
import { db } from "./db";
import { errorMessage, log } from "./log";

const BATCH_SIZE = 500;
const MAX_BACKOFF_MS = 30_000;

// CPA usage-queue 单条记录,字段见 https://help.router-for.me/management/api
type QueueRecord = {
  timestamp?: string;
  latency_ms?: number;
  source?: string;
  auth_index?: string;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    total_tokens?: number;
  };
  failed?: boolean;
  provider?: string;
  model?: string;
  alias?: string;
  endpoint?: string;
  auth_type?: string;
  api_key?: string;
  request_id?: string;
};

export const collectorStatus = {
  lastPollAt: 0,
  lastSuccessAt: 0,
  lastError: "",
  collected: 0,
};

// Claude 系上报的 input_tokens 不含缓存;OpenAI / Codex / Gemini 等的 input_tokens 已包含缓存
function isCacheSeparate(provider: string, model: string): boolean {
  const target = provider || model;
  return /claude|anthropic/i.test(target);
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

function int(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

const insert = db.prepare(`
  INSERT INTO usage_events (
    ts, request_id, provider, model, alias, source, auth_index, auth_type, api_key, endpoint,
    prompt_tokens, cache_read_tokens, cache_creation_tokens, output_tokens, reasoning_tokens, total_tokens,
    latency_ms, failed
  ) VALUES (
    $ts, $requestId, $provider, $model, $alias, $source, $authIndex, $authType, $apiKey, $endpoint,
    $promptTokens, $cacheReadTokens, $cacheCreationTokens, $outputTokens, $reasoningTokens, $totalTokens,
    $latencyMs, $failed
  )
`);

const insertBatch = db.transaction((records: QueueRecord[]) => {
  for (const r of records) {
    const provider = r.provider ?? "";
    const model = r.model ?? "";
    const t = r.tokens ?? {};
    const input = int(t.input_tokens);
    const cacheRead = int(t.cache_read_tokens) || int(t.cached_tokens);
    const cacheCreation = int(t.cache_creation_tokens);
    const promptTokens = isCacheSeparate(provider, model) ? input : Math.max(input - cacheRead - cacheCreation, 0);
    const outputTokens = int(t.output_tokens);
    const ts = Date.parse(r.timestamp ?? "");
    insert.run({
      ts: Number.isFinite(ts) ? ts : Date.now(),
      requestId: r.request_id ?? "",
      provider,
      model,
      alias: r.alias ?? "",
      source: r.source ?? "",
      authIndex: r.auth_index ?? "",
      authType: r.auth_type ?? "",
      apiKey: maskKey(r.api_key ?? ""),
      endpoint: r.endpoint ?? "",
      promptTokens,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      outputTokens,
      reasoningTokens: int(t.reasoning_tokens),
      totalTokens: int(t.total_tokens) || promptTokens + cacheRead + cacheCreation + outputTokens,
      latencyMs: typeof r.latency_ms === "number" ? Math.round(r.latency_ms) : null,
      failed: r.failed ? 1 : 0,
    });
  }
});

async function popQueue(): Promise<QueueRecord[]> {
  const res = await fetch(`${config.cpaUrl}/v0/management/usage-queue?count=${BATCH_SIZE}`, {
    headers: { Authorization: `Bearer ${config.managementKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`usage-queue 返回 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("usage-queue 返回的不是数组");
  return body as QueueRecord[];
}

export async function runCollector() {
  let delay = config.pollIntervalMs;
  for (;;) {
    collectorStatus.lastPollAt = Date.now();
    try {
      const records = await popQueue();
      if (records.length > 0) {
        insertBatch(records);
        collectorStatus.collected += records.length;
      }
      if (collectorStatus.lastError) log("info", "用量采集已恢复");
      collectorStatus.lastSuccessAt = Date.now();
      collectorStatus.lastError = "";
      delay = records.length === BATCH_SIZE ? 0 : config.pollIntervalMs;
    } catch (error) {
      const message = errorMessage(error);
      if (message !== collectorStatus.lastError) log("warn", "用量采集失败", { error: message });
      collectorStatus.lastError = message;
      delay = Math.min(Math.max(delay * 2, config.pollIntervalMs), MAX_BACKOFF_MS);
    }
    await Bun.sleep(delay);
  }
}
