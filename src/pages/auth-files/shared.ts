import { api } from "@/lib/api";
import type { AuthFile } from "@/lib/types";

export const file = (name: string) => encodeURIComponent(name);

// 列表不返回 prefix、proxy_url、headers 等,只能读认证文件本身;仅存在于内存的凭据没有文件
export function contentQuery(target: AuthFile) {
  return {
    queryKey: ["cpa", "auth-file-content", target.name],
    queryFn: () => api<Record<string, unknown>>(`/v8/management/credentials/download?name=${file(target.name)}`),
    enabled: !target.runtime_only,
    refetchOnWindowFocus: false,
  };
}
