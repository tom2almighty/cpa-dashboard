import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AuthFile } from "./types";

// CPA GET /credentials 的响应:不带分页参数时返回全部凭据
export type CredentialsResponse = {
  files?: AuthFile[];
  observed_at?: string;
};

export const CREDENTIALS_KEY = ["cpa", "credentials"] as const;

export function credentialTarget(file: AuthFile) {
  return file.auth_index ? { auth_index: file.auth_index } : { name: file.name };
}

export function verifyCredential(file: AuthFile, model: string) {
  return api<{ status: string; verified: boolean }>("/v8/management/credentials/verify", {
    method: "POST",
    body: { ...credentialTarget(file), ...(model.trim() ? { model: model.trim() } : {}) },
  });
}

/** 凭据的展示名：优先账号信息，最后回退到文件名 */
export function accountName(file: AuthFile): string {
  return file.email || file.label || file.account || file.name;
}

/**
 * 一次性读取全部凭据。
 *
 * v8 的 /credentials 只支持 page/page_size 和 name/auth_index 精确匹配，没有
 * provider/status/关键字筛选；如果按页拉取，前端就无法对全量做筛选。这里统一
 * 拉全量，分页与筛选都在内存里完成，既避免两套页大小不一致，也让概览页能拿到
 * 完整的统计。凭据量特别大的部署应优先推动后端提供筛选参数，而不是前端维护
 * 两套分页模式。
 */
export async function fetchCredentials(signal?: AbortSignal): Promise<AuthFile[]> {
  const res = await api<CredentialsResponse>("/v8/management/credentials", { signal });
  return res.files ?? [];
}

export function useCredentials({ refetchInterval }: { refetchInterval?: number } = {}) {
  const query = useQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: ({ signal }) => fetchCredentials(signal),
    refetchInterval,
  });
  const files = query.data ?? [];
  return { ...query, files, total: files.length };
}
