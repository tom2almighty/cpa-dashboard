import { config } from "./config";
import { db, getMeta, setMeta } from "./db";
import { errorMessage, log } from "./log";

const RETRY_MS = 10 * 60_000;

export type Price = {
  model: string;
  provider: string;
  input: number;
  output: number;
  cache_read: number | null;
  cache_creation: number | null;
};

type LiteLLMEntry = {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

export const priceStatus = {
  syncing: false,
  lastError: "",
};

// 模型名 -> 价格,按需解析并缓存,价格同步后清空
let resolved = new Map<string, Price | null>();
let exact = new Map<string, Price>();
let bare = new Map<string, Price>();

// 同名模型出现在多个渠道时,优先采用官方渠道的价格
const PREFERRED_PREFIXES = ["openai/", "anthropic/", "gemini/", "vertex_ai/", "xai/", "deepseek/"];

function prefixRank(key: string): number {
  if (!key.includes("/")) return 0;
  const index = PREFERRED_PREFIXES.findIndex((prefix) => key.startsWith(prefix));
  return index === -1 ? PREFERRED_PREFIXES.length + 1 : index + 1;
}

function loadIndex() {
  const rows = db.query<Price, []>("SELECT * FROM model_prices").all();
  rows.sort((a, b) => prefixRank(a.model) - prefixRank(b.model));
  exact = new Map();
  bare = new Map();
  for (const row of rows) {
    const key = row.model.toLowerCase();
    exact.set(key, row);
    const name = key.slice(key.lastIndexOf("/") + 1);
    if (!bare.has(name)) bare.set(name, row);
  }
  resolved = new Map();
}

// CPA 的模型名可能带思考等级后缀或日期版本,例如 gpt-5(high)、gemini-2.5-pro-thinking、claude-opus-4-1-20250805
function candidates(model: string): string[] {
  const name = model.toLowerCase().trim();
  const noLevel = name.replace(/\([^)]*\)$/, "");
  const noThinking = noLevel.replace(/-thinking(-[a-z0-9]+)?$/, "");
  const noDate = noThinking.replace(/-\d{8}$/, "");
  return [...new Set([name, noLevel, noThinking, noDate])];
}

export function priceFor(model: string): Price | null {
  const cached = resolved.get(model);
  if (cached !== undefined) return cached;
  let price: Price | null = null;
  for (const name of candidates(model)) {
    price = exact.get(name) ?? bare.get(name) ?? null;
    if (price) break;
  }
  resolved.set(model, price);
  return price;
}

export type TokenTotals = {
  promptTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
};

export function costOf(price: Price, t: TokenTotals): number {
  return (
    t.promptTokens * price.input +
    t.cacheReadTokens * (price.cache_read ?? price.input) +
    t.cacheCreationTokens * (price.cache_creation ?? price.input) +
    t.outputTokens * price.output
  );
}

const replaceAll = db.transaction((entries: [string, LiteLLMEntry][]) => {
  db.run("DELETE FROM model_prices");
  const insert = db.prepare(
    "INSERT INTO model_prices (model, provider, input, output, cache_read, cache_creation) VALUES ($model, $provider, $input, $output, $cacheRead, $cacheCreation)",
  );
  for (const [model, entry] of entries) {
    insert.run({
      model,
      provider: entry.litellm_provider ?? "",
      input: entry.input_cost_per_token ?? 0,
      output: entry.output_cost_per_token ?? 0,
      cacheRead: entry.cache_read_input_token_cost ?? null,
      cacheCreation: entry.cache_creation_input_token_cost ?? null,
    });
  }
});

export async function syncPrices() {
  if (priceStatus.syncing) return;
  priceStatus.syncing = true;
  try {
    const res = await fetch(config.pricesUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`LiteLLM 价格表返回 ${res.status}`);
    const body = (await res.json()) as Record<string, LiteLLMEntry>;
    const entries = Object.entries(body).filter(
      ([model, entry]) =>
        model !== "sample_spec" &&
        (typeof entry.input_cost_per_token === "number" || typeof entry.output_cost_per_token === "number"),
    );
    if (entries.length === 0) throw new Error("LiteLLM 价格表为空");
    replaceAll(entries);
    loadIndex();
    setMeta("prices_synced_at", String(Date.now()));
    priceStatus.lastError = "";
    log("info", "模型价格已同步", { models: entries.length });
  } catch (error) {
    priceStatus.lastError = errorMessage(error);
    log("warn", "模型价格同步失败", { error: priceStatus.lastError });
  } finally {
    priceStatus.syncing = false;
  }
}

export function pricesSyncedAt(): number {
  return Number(getMeta("prices_synced_at") ?? 0);
}

export function priceCount(): number {
  return exact.size;
}

export async function runPriceSync() {
  loadIndex();
  for (;;) {
    await syncPrices();
    await Bun.sleep(priceStatus.lastError ? RETRY_MS : config.priceSyncHours * 3_600_000);
  }
}
