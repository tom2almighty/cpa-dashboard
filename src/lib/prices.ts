import { api } from "@/lib/api";
import type { ModelPrice, PriceSnapshot } from "@/lib/types";

export type LiteLLMEntry = {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

export type Price = {
  model: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheCreation: number | null;
};

const LITELLM_PRICES_KEY = "cpa-dashboard.litellm-prices";
const LITELLM_SYNC_TIME_KEY = "cpa-dashboard.litellm-synced-at";

const PREFERRED_PREFIXES = ["openai/", "anthropic/", "gemini/", "vertex_ai/", "xai/", "deepseek/"];

function prefixRank(key: string): number {
  if (!key.includes("/")) return 0;
  const index = PREFERRED_PREFIXES.findIndex((prefix) => key.startsWith(prefix));
  return index === -1 ? PREFERRED_PREFIXES.length + 1 : index + 1;
}

function candidates(model: string): string[] {
  const name = model.toLowerCase().trim();
  const noLevel = name.replace(/\([^)]*\)$/, "");
  const noThinking = noLevel.replace(/-thinking(-[a-z0-9]+)?$/, "");
  const noDate = noThinking.replace(/-\d{8}$/, "");
  return [...new Set([name, noLevel, noThinking, noDate])];
}

export class PriceMatcher {
  private exact = new Map<string, Price>();
  private bare = new Map<string, Price>();
  private resolved = new Map<string, Price | null>();

  constructor(entries: [string, LiteLLMEntry][]) {
    const list: Price[] = [];
    for (const [model, entry] of entries) {
      if (model === "sample_spec") continue;
      const input = entry.input_cost_per_token ?? 0;
      const output = entry.output_cost_per_token ?? 0;
      const cacheRead = entry.cache_read_input_token_cost ?? null;
      const cacheCreation = entry.cache_creation_input_token_cost ?? null;
      list.push({
        model,
        provider: entry.litellm_provider ?? "",
        input: input * 1e6,
        output: output * 1e6,
        cacheRead: cacheRead === null ? null : cacheRead * 1e6,
        cacheCreation: cacheCreation === null ? null : cacheCreation * 1e6,
      });
    }

    list.sort((a, b) => prefixRank(a.model) - prefixRank(b.model));

    for (const item of list) {
      const key = item.model.toLowerCase();
      this.exact.set(key, item);
      const name = key.slice(key.lastIndexOf("/") + 1);
      if (!this.bare.has(name)) this.bare.set(name, item);
    }
  }

  get size(): number {
    return this.exact.size;
  }

  priceFor(model: string): Price | null {
    const cached = this.resolved.get(model);
    if (cached !== undefined) return cached;
    let price: Price | null = null;
    for (const name of candidates(model)) {
      price = this.exact.get(name) ?? this.bare.get(name) ?? null;
      if (price) break;
    }
    this.resolved.set(model, price);
    return price;
  }
}

let cachedMatcher: PriceMatcher | null = null;

export async function fetchLiteLLMPrices(forceRefresh = false): Promise<PriceMatcher> {
  if (cachedMatcher && !forceRefresh) return cachedMatcher;

  let storedRaw: string | null = null;
  if (!forceRefresh) {
    try {
      storedRaw = localStorage.getItem(LITELLM_PRICES_KEY);
    } catch {}
  }

  if (storedRaw) {
    try {
      const parsed = JSON.parse(storedRaw) as Record<string, LiteLLMEntry>;
      cachedMatcher = new PriceMatcher(Object.entries(parsed));
      return cachedMatcher;
    } catch {}
  }

  const urls = [
    "https://cdn.jsdelivr.net/gh/BerriAI/litellm@main/model_prices_and_context_window.json",
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  ];

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        const body = (await res.json()) as Record<string, LiteLLMEntry>;
        const entries = Object.entries(body).filter(
          ([model, entry]) =>
            model !== "sample_spec" &&
            (typeof entry.input_cost_per_token === "number" || typeof entry.output_cost_per_token === "number"),
        );
        if (entries.length > 0) {
          try {
            localStorage.setItem(LITELLM_PRICES_KEY, JSON.stringify(Object.fromEntries(entries)));
            localStorage.setItem(LITELLM_SYNC_TIME_KEY, String(Date.now()));
          } catch {}
          cachedMatcher = new PriceMatcher(entries);
          return cachedMatcher;
        }
      }
    } catch (e) {
      lastError = e as Error;
    }
  }

  throw new Error(`无法获取 LiteLLM 价格表：${lastError?.message || "网络请求失败"}`);
}

export function getPriceSyncTime(): number | null {
  try {
    const t = localStorage.getItem(LITELLM_SYNC_TIME_KEY);
    return t ? Number(t) : null;
  } catch {
    return null;
  }
}

type V1ModelItem = {
  id: string;
  owned_by?: string;
};

export async function loadFrontendPriceSnapshot(forceRefresh = false): Promise<PriceSnapshot> {
  const [cpaRes, matcher] = await Promise.all([
    api<{ data?: V1ModelItem[]; models?: V1ModelItem[] } | V1ModelItem[]>("/v1/models").catch(() => []),
    fetchLiteLLMPrices(forceRefresh),
  ]);

  const rawList = Array.isArray(cpaRes)
    ? cpaRes
    : Array.isArray(cpaRes?.data)
      ? cpaRes.data
      : Array.isArray(cpaRes?.models)
        ? cpaRes.models
        : [];

  const models: ModelPrice[] = rawList.map((m) => {
    const price = matcher.priceFor(m.id);
    return {
      model: m.id,
      requests: 0,
      lastUsedAt: 0,
      ownedBy: m.owned_by,
      price: price && {
        matched: price.model,
        provider: price.provider,
        input: price.input,
        output: price.output,
        cacheRead: price.cacheRead,
        cacheCreation: price.cacheCreation,
      },
    };
  });

  return {
    syncedAt: getPriceSyncTime(),
    syncing: false,
    lastError: null,
    catalogSize: matcher.size,
    models,
  };
}
