import { afterAll, expect, test } from "vitest";
import { fetchCredentials } from "./credentials";

const originalFetch = globalThis.fetch;

function stubFetch(payload: unknown, urls: string[]) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("一次请求全部凭据,不带分页参数", async () => {
  const urls: string[] = [];
  stubFetch({ files: [{ id: "a", name: "a.json" }], observed_at: "2026-09-30T00:00:00Z" }, urls);

  const files = await fetchCredentials();

  expect(urls).toEqual(["/v8/management/credentials"]);
  expect(files).toEqual([{ id: "a", name: "a.json" }]);
});

test("响应缺少 files 时归一化为空数组", async () => {
  const urls: string[] = [];
  stubFetch({ observed_at: "2026-09-30T00:00:00Z" }, urls);

  expect(await fetchCredentials()).toEqual([]);
});
