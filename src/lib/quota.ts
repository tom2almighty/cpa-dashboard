import { api } from "@/lib/api";
import type { AuthFile } from "@/lib/types";

// 额度窗口: usedPercent 为 0~100, resetAt 为毫秒时间戳
export type QuotaWindow = {
  id: string;
  label: string;
  usedPercent: number | null;
  resetAt: number | null;
  detail?: string;
};

export type Quota = {
  plan: string | null;
  windows: QuotaWindow[];
  notes: string[];
};

/**
 * 判断凭据是否支持配额查询：
 * 只要拥有 auth_index 即尝试向 v8 统一配额接口查询
 */
export function supportsQuota(file: AuthFile): boolean {
  return Boolean(file.auth_index);
}

/**
 * 原生 v8 配额查询：
 * 1. 优先调用 CPA 官方通用配额接口：POST /v8/management/credentials/quota/fetch
 * 2. 插件凭据若失败，尝试插件自有配额接口：GET /v8/management/plugins/:id/quota?auth_index=xxx
 */
export async function fetchQuota(file: AuthFile): Promise<Quota> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) throw new Error("凭据缺少 auth_index");

  // 1. 优先尝试 v8 官方凭据配额总线
  try {
    const res = await api<{
      plan?: string;
      windows?: QuotaWindow[];
      notes?: string[];
      quota?: Quota;
    }>("/v8/management/credentials/quota/fetch", {
      method: "POST",
      body: {
        auth_index: authIndex,
        ...(file.provider ? { provider: file.provider } : {}),
      },
    });

    if (res.quota) return res.quota;
    if (res.windows && Array.isArray(res.windows)) {
      return {
        plan: res.plan ?? null,
        windows: res.windows,
        notes: res.notes ?? [],
      };
    }
  } catch (error) {
    // 2. 针对插件渠道的凭据，回退至插件配额规范 GET /plugins/:id/quota
    if (file.source === "plugin" && file.provider) {
      const plugRes = await api<{ quota?: Quota; windows?: QuotaWindow[]; plan?: string; notes?: string[] }>(
        `/v8/management/plugins/${encodeURIComponent(file.provider)}/quota?auth_index=${encodeURIComponent(authIndex)}`,
      );
      if (plugRes.quota) return plugRes.quota;
      if (plugRes.windows && Array.isArray(plugRes.windows)) {
        return {
          plan: plugRes.plan ?? null,
          windows: plugRes.windows,
          notes: plugRes.notes ?? [],
        };
      }
    }
    throw error;
  }

  return { plan: null, windows: [], notes: [] };
}

/**
 * 原生 v8 配额重置：
 * 1. 插件凭据优先尝试 DELETE /v8/management/plugins/:id/quota?auth_index=xxx
 * 2. 尝试官方 POST /v8/management/credentials/quota/reset
 * 3. 兜底清除凭据冷却 POST /v8/management/routing/cooldown/reset
 */
export async function resetQuota(file: AuthFile): Promise<void> {
  const authIndex = file.auth_index ?? "";
  if (!authIndex) throw new Error("凭据缺少 auth_index");

  if (file.source === "plugin" && file.provider) {
    try {
      await api(
        `/v8/management/plugins/${encodeURIComponent(file.provider)}/quota?auth_index=${encodeURIComponent(authIndex)}`,
        { method: "DELETE" },
      );
      return;
    } catch {}
  }

  try {
    await api("/v8/management/credentials/quota/reset", {
      method: "POST",
      body: {
        auth_index: authIndex,
        ...(file.provider ? { provider: file.provider } : {}),
      },
    });
    return;
  } catch {
    await api("/v8/management/routing/cooldown/reset", {
      method: "POST",
      body: { auth_index: authIndex },
    });
  }
}
