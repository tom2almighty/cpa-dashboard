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

export type ResolvedPrice = {
  price: Price;
  source: "custom" | "mapped" | "auto";
};

export type SimilarModelCandidate = {
  model: string;
  provider: string;
  price: Price;
  score: number; // 0 ~ 100
};

const LITELLM_PRICES_KEY = "cpa-dashboard.litellm-prices";
const LITELLM_SYNC_TIME_KEY = "cpa-dashboard.litellm-synced-at";
const CUSTOM_PRICES_KEY = "cpa-dashboard.custom-model-prices";
const MODEL_MAPPINGS_KEY = "cpa-dashboard.model-price-mappings";

const PREFERRED_PREFIXES = ["openai/", "anthropic/", "gemini/", "vertex_ai/", "xai/", "deepseek/"];

const COMMON_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek-v3",
  "deepseek-reasoner": "deepseek-r1",
  "chatgpt-4o-latest": "gpt-4o",
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet": "claude-3-7-sonnet-20250219",
  "claude-3-5-haiku": "claude-3-5-haiku-20241022",
  "claude-3-opus": "claude-3-opus-20240229",
  gpt4o: "gpt-4o",
  gpt4: "gpt-4",
  "gpt-4-turbo-preview": "gpt-4-turbo",
};

const STRIP_PREFIXES = [
  /^codex[-/]/,
  /^vertex[-/]/,
  /^claude-code[-/]/,
  /^antigravity[-/]/,
  /^aistudio[-/]/,
  /^gemini-cli[-/]/,
  /^xai[-/]/,
  /^meta[-/]/,
  /^kimi[-/]/,
  /^custom[-/]/,
];

function prefixRank(key: string): number {
  if (!key.includes("/")) return 0;
  const index = PREFERRED_PREFIXES.findIndex((prefix) => key.startsWith(prefix));
  return index === -1 ? PREFERRED_PREFIXES.length + 1 : index + 1;
}

export function candidates(model: string): string[] {
  const raw = model.toLowerCase().trim();
  const set = new Set<string>();

  const add = (s: string) => {
    if (!s) return;
    set.add(s);
    if (COMMON_ALIASES[s]) set.add(COMMON_ALIASES[s]);
  };

  add(raw);

  if (raw.includes("/")) {
    add(raw.slice(raw.lastIndexOf("/") + 1));
  }

  for (const prefix of STRIP_PREFIXES) {
    if (prefix.test(raw)) {
      add(raw.replace(prefix, ""));
    }
  }

  for (const item of [...set]) {
    if (item.includes(".")) add(item.replace(/\./g, "-"));
    if (item.includes("_")) add(item.replace(/_/g, "-"));
    const noLevel = item.replace(/\([^)]*\)$/, "");
    add(noLevel);
    const noThinking = noLevel.replace(/-thinking(-[a-z0-9]+)?$/, "");
    add(noThinking);
    const noDate = noThinking.replace(/-\d{8}$/, "");
    add(noDate);
    const noMod = noDate.replace(/-(preview|exp|latest|online|free)(-\d+)?$/, "").replace(/-\d{3}$/, "");
    add(noMod);
  }

  return [...set].filter(Boolean);
}

export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  const l1 = s1.length;
  const l2 = s2.length;
  if (l1 === 0 || l2 === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(l1, l2) / 2) - 1;
  const s1Matches = new Array(l1).fill(false);
  const s2Matches = new Array(l2).fill(false);

  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, l2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < l1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(l1, l2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export function loadCustomPrices(): Record<string, Price> {
  try {
    const raw = localStorage.getItem(CUSTOM_PRICES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Price>) : {};
  } catch {
    return {};
  }
}

export function saveCustomPrice(model: string, price: Price) {
  try {
    const map = loadCustomPrices();
    map[model.toLowerCase().trim()] = price;
    localStorage.setItem(CUSTOM_PRICES_KEY, JSON.stringify(map));
  } catch {}
}

export function removeCustomPrice(model: string) {
  try {
    const map = loadCustomPrices();
    delete map[model.toLowerCase().trim()];
    localStorage.setItem(CUSTOM_PRICES_KEY, JSON.stringify(map));
  } catch {}
}

export function loadModelMappings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MODEL_MAPPINGS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveModelMapping(sourceModel: string, targetMatchedModel: string) {
  try {
    const map = loadModelMappings();
    map[sourceModel.toLowerCase().trim()] = targetMatchedModel.toLowerCase().trim();
    localStorage.setItem(MODEL_MAPPINGS_KEY, JSON.stringify(map));
  } catch {}
}

export function removeModelMapping(sourceModel: string) {
  try {
    const map = loadModelMappings();
    delete map[sourceModel.toLowerCase().trim()];
    localStorage.setItem(MODEL_MAPPINGS_KEY, JSON.stringify(map));
  } catch {}
}

export class PriceMatcher {
  private exact = new Map<string, Price>();
  private bare = new Map<string, Price>();
  private resolved = new Map<string, ResolvedPrice | null>();
  private customPrices = loadCustomPrices();
  private modelMappings = loadModelMappings();

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

  resolvePrice(model: string): ResolvedPrice | null {
    const key = model.toLowerCase().trim();
    const cached = this.resolved.get(key);
    if (cached !== undefined) return cached;

    // 1. 最高优先级：用户手动设置的自定义价格
    const custom = this.customPrices[key];
    if (custom) {
      const res: ResolvedPrice = { price: custom, source: "custom" };
      this.resolved.set(key, res);
      return res;
    }

    // 2. 次高优先级：用户确认的手动绑定映射
    const mappedTarget = this.modelMappings[key];
    if (mappedTarget) {
      const mappedPrice = this.exact.get(mappedTarget) ?? this.bare.get(mappedTarget);
      if (mappedPrice) {
        const res: ResolvedPrice = { price: mappedPrice, source: "mapped" };
        this.resolved.set(key, res);
        return res;
      }
    }

    // 3. 自动放宽候选匹配（规则级归一化）
    for (const name of candidates(model)) {
      const autoPrice = this.exact.get(name) ?? this.bare.get(name);
      if (autoPrice) {
        const res: ResolvedPrice = { price: autoPrice, source: "auto" };
        this.resolved.set(key, res);
        return res;
      }
    }

    this.resolved.set(key, null);
    return null;
  }

  priceFor(model: string): Price | null {
    return this.resolvePrice(model)?.price ?? null;
  }

  findSimilar(targetModel: string, limit = 3): SimilarModelCandidate[] {
    const cleanTarget = targetModel
      .toLowerCase()
      .trim()
      .replace(/^[^/]*\//, "");
    const results: SimilarModelCandidate[] = [];
    const seen = new Set<string>();

    for (const [name, item] of this.bare.entries()) {
      if (seen.has(item.model)) continue;
      seen.add(item.model);

      let score = jaroWinkler(cleanTarget, name);
      if (cleanTarget.includes(name) || name.includes(cleanTarget)) {
        score = Math.max(score, 0.82);
      }
      if (score >= 0.5) {
        results.push({
          model: item.model,
          provider: item.provider,
          price: item,
          score: Math.round(score * 100),
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
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
    const res = matcher.resolvePrice(m.id);
    return {
      model: m.id,
      requests: 0,
      lastUsedAt: 0,
      ownedBy: m.owned_by,
      source: res?.source,
      price: res?.price
        ? {
            matched: res.price.model,
            provider: res.price.provider,
            input: res.price.input,
            output: res.price.output,
            cacheRead: res.price.cacheRead,
            cacheCreation: res.price.cacheCreation,
          }
        : null,
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

export function resetMatcherCache() {
  cachedMatcher = null;
}
