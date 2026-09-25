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
