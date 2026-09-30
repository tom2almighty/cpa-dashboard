import { afterAll, expect, test } from "bun:test";
import { fetchCredentialsPage, mergePages, nextPageParam } from "./credentials";

const originalFetch = globalThis.fetch;

// bun test 没有 DOM,api.ts 解析地址与密钥时要用到 Web Storage
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
} as unknown as Storage;
globalThis.localStorage ??= storage;
globalThis.sessionStorage ??= storage;

function stubFetch(payloads: Record<string, unknown>, urls: string[]) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify(payloads[urls.length - 1] ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("按 page/page_size 请求 CPA 分页并归一化 files", async () => {
  const urls: string[] = [];
  stubFetch([{ files: [{ id: "a", name: "a.json" }], total: 3, page: 2, page_size: 200, has_more: true }], urls);

  const page = await fetchCredentialsPage(2);

  expect(urls).toEqual(["/v8/management/credentials?page=2&page_size=200"]);
  expect(page.files?.length).toBe(1);
  expect(page.total).toBe(3);
});

test("响应缺少 files 时归一化为空数组", async () => {
  const urls: string[] = [];
  stubFetch([{ observed_at: "2026-09-30T00:00:00Z" }], urls);

  expect((await fetchCredentialsPage(1)).files).toEqual([]);
});

test("has_more 决定是否继续翻页", () => {
  expect(nextPageParam({ has_more: true }, [{}, {}])).toBe(3);
  expect(nextPageParam({ has_more: false }, [{}])).toBeUndefined();
  expect(nextPageParam({}, [{}])).toBeUndefined();
});

test("mergePages 按页序拼接,总数取服务端返回值", () => {
  const merged = mergePages([
    { files: [{ id: "a", name: "a.json" }], total: 3 },
    {
      files: [
        { id: "b", name: "b.json" },
        { id: "c", name: "c.json" },
      ],
    },
  ]);

  expect(merged.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(merged.total).toBe(3);
  // 未启用分页的旧响应没有 total,回落到已加载条数
  expect(mergePages([{ files: [{ id: "a", name: "a.json" }] }]).total).toBe(1);
  expect(mergePages([]).total).toBe(0);
});
