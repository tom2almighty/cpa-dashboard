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
  unpricedRequests: number;
  avgLatencyMs: number | null;
};

export type TimePoint = Totals & { t: number };

export type BreakdownBy = "model" | "account" | "apiKey" | "provider";

export type BreakdownRow = Totals & { key: string };

export type UsageEvent = {
  id: number;
  ts: number;
  requestId: string;
  provider: string;
  model: string;
  alias: string;
  account: string;
  apiKey: string;
  endpoint: string;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  failed: boolean;
  cost: number | null;
};

export type ModelPrice = {
  model: string;
  requests: number;
  lastUsedAt: number;
  ownedBy?: string;
  price: {
    matched: string;
    provider: string;
    input: number;
    output: number;
    cacheRead: number | null;
    cacheCreation: number | null;
  } | null;
};

export type PriceSnapshot = {
  syncedAt: number | null;
  syncing: boolean;
  lastError: string | null;
  catalogSize: number;
  models: ModelPrice[];
};

export type Status = {
  cpaUrl: string;
  collector: {
    lastPollAt: number | null;
    lastSuccessAt: number | null;
    lastError: string | null;
    collectedSinceStart: number;
  };
  events: number;
};

// CPA GET /v0/management/auth-files
export type RecentBucket = { time: string; success: number; failed: number };

export type AuthFile = {
  id: string;
  auth_index?: string;
  name: string;
  type?: string;
  provider?: string;
  label?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
  runtime_only?: boolean;
  source?: string;
  path?: string;
  email?: string;
  account?: string;
  account_type?: string;
  project_id?: string;
  success?: number;
  failed?: number;
  recent_requests?: RecentBucket[];
  priority?: number;
  note?: string;
  last_refresh?: string;
  next_retry_after?: string;
  updated_at?: string;
};
