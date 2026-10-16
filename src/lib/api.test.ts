import { expect, test } from "vitest";
import { ApiError, api, clearKey, errorText } from "./api";

test("CPA 错误码映射为文案", () => {
  expect(errorText(new ApiError(404, "auth not found", "auth not found"))).toBe("CPA 里找不到这个凭据");
  expect(errorText(new ApiError(503, "core auth manager unavailable", "core auth manager unavailable"))).toBe(
    "CPA 的认证管理器不可用，请稍后重试",
  );
  expect(errorText(new ApiError(400, "boom", "read_only_field"))).toBe("该字段由 CPA 托管，不能修改");
  expect(errorText(new ApiError(412, "precondition_failed", "precondition_failed"))).toBe(
    "配置已被其它会话修改，请刷新后重试",
  );
});

test("未覆盖的错误码与非 ApiError 直接用原文", () => {
  expect(errorText(new ApiError(500, "write failed", "write_failed"))).toBe("write failed");
  expect(errorText(new Error("network down"))).toBe("network down");
  expect(errorText("boom")).toBe("boom");
});

test("v8 配置写入带上最近一次读取的 ETag,写响应刷新版本", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; ifMatch: string | null }[] = [];
  const etags = ['"v1"', '"v2"', '"v3"'];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      ifMatch: new Headers(init?.headers).get("If-Match"),
    });
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: etags[Math.min(calls.length - 1, etags.length - 1)] },
    });
  }) as typeof fetch;

  try {
    clearKey();
    await api("/v8/management/config");
    await api("/v8/management/config", { method: "PATCH", body: { server: {} } });
    await api("/v8/management/config/server/port", { method: "PUT", body: 8317 });
    // 非配置端点不参与版本校验
    await api("/v8/management/plugins");
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls.map((c) => c.ifMatch)).toEqual([null, '"v1"', '"v2"', null]);
});
