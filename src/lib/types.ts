// CPA GET /v0/management/auth-files
export type RecentBucket = { time: string; success: number; failed: number };

export type AuthFileCooldown = {
  scope: "model" | "credential";
  model_key?: string;
  reason: string;
  retry_at: string;
  remaining_seconds: number;
  backoff_level?: number;
  http_status?: number;
};

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
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  success?: number;
  failed?: number;
  recent_requests?: RecentBucket[];
  cooldowns?: AuthFileCooldown[];
  priority?: number;
  note?: string;
  last_refresh?: string;
  next_retry_after?: string;
  updated_at?: string;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
