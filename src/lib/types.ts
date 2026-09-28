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
  // 有插件 QuotaProvider 或凭据内配置了 quota_probe 时为 true
  supports_quota?: boolean;
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
