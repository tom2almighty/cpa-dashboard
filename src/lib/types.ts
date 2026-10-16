// CPA GET /v8/management/credentials
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
  // unknown / active / pending / refreshing / error / disabled
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
  // 仅 codex 凭据返回,为 id_token 解出的声明
  id_token?: { chatgpt_account_id?: string; plan_type?: string };
  success?: number;
  failed?: number;
  recent_requests?: RecentBucket[];
  cooldowns?: AuthFileCooldown[] | null;
  priority?: number;
  note?: string;
  // 该凭据有插件 QuotaProvider 时为 true；v8 不再宣告凭据内的声明式 quota_probe
  supports_quota?: boolean;
  // 由插件提供额度时返回的来源渠道
  quota_provider?: string;
  // v8 下直接返回额度插件 id，重置额度优先用它；非 v8 或旧版 CPA 不返回
  quota_plugin_id?: string;
  last_refresh?: string;
  updated_at?: string;
};

// 冷却只看 cooldowns;unavailable 但没有冷却记录的是 401、令牌过期等认证错误
export function authState(f: AuthFile): "disabled" | "cooldown" | "error" | "ok" {
  if (f.disabled) return "disabled";
  if (f.cooldowns?.length) return "cooldown";
  if (f.unavailable || f.status === "error") return "error";
  return "ok";
}
