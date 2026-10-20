import { afterAll, expect, test } from "vitest";
import { ApiError, api, clearConfigEtag, errorText } from "./api";

const originalFetch = globalThis.fetch;

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function stubConfigFetch(etag?: string) {
  const headers: Headers[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers.push(new Headers(init?.headers));
    const responseHeaders = new Headers({ "Content-Type": "application/json" });
    if (etag) responseHeaders.set("ETag", etag);
    return new Response("{}", { status: 200, headers: responseHeaders });
  }) as typeof fetch;
  return headers;
}

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

test("配置 GET 的 ETag 会用于后续配置写请求", async () => {
  clearConfigEtag();
  const headers = stubConfigFetch(`"abc123"`);

  await api("/v8/management/config");
  await api("/v8/management/config/server/port", { method: "PUT", body: 8317 });

  expect(headers[1].get("If-Match")).toBe(`"abc123"`);
});

test("config.yaml 读写同样受 ETag 保护", async () => {
  clearConfigEtag();
  const headers = stubConfigFetch(`"yaml123"`);

  await api("/v8/management/config.yaml");
  await api("/v8/management/config.yaml", {
    method: "PUT",
    body: "server: {}",
    raw: true,
    headers: { "Content-Type": "application/yaml" },
  });

  expect(headers[1].get("If-Match")).toBe(`"yaml123"`);
});

test("反代压缩产生的弱 ETag 去掉 W/ 后回传", async () => {
  clearConfigEtag();
  const headers = stubConfigFetch(`W/"abc123"`);

  await api("/v8/management/config");
  await api("/v8/management/config", { method: "PATCH", body: { server: { port: 8317 } } });

  expect(headers[1].get("If-Match")).toBe(`"abc123"`);
});

test("没有 ETag 时不带 If-Match,保持无条件写入", async () => {
  clearConfigEtag();
  const headers = stubConfigFetch();

  await api("/v8/management/config");
  await api("/v8/management/config", { method: "PATCH", body: { server: { port: 8317 } } });

  expect(headers[1].has("If-Match")).toBe(false);
});
