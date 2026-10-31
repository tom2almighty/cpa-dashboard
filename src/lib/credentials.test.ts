import { afterAll, expect, test } from "vitest";
import { credentialTarget, fetchCredentials, verifyCredential } from "./credentials";
import { type AuthFile, authState, authUsable } from "./types";

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

test("targets the exact virtual credential rather than its shared file", () => {
  expect(credentialTarget({ id: "a", name: "shared.json", auth_index: "idx-a" })).toEqual({ auth_index: "idx-a" });
  expect(credentialTarget({ id: "b", name: "b.json" })).toEqual({ name: "b.json" });
});

test("verification posts the credential selector and optional trimmed model", async () => {
  const requests: { url: string; method?: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ status: "ok", verified: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const target = { id: "a", name: "a.json", auth_index: "idx-a" };
  expect(await verifyCredential(target, " gpt-5.5 ")).toEqual({ status: "ok", verified: true });
  await verifyCredential(target, " ");
  expect(requests).toEqual([
    { url: "/v8/management/credentials/verify", method: "POST", body: { auth_index: "idx-a", model: "gpt-5.5" } },
    { url: "/v8/management/credentials/verify", method: "POST", body: { auth_index: "idx-a" } },
  ]);
});

test("renewal failure needs attention without treating a valid access token as unusable", () => {
  const target: AuthFile = { id: "a", name: "a.json", requires_sign_in: true, status: "active" };
  expect(authState(target)).toBe("sign_in");
  expect(authUsable(target)).toBe(true);
  expect(authUsable({ ...target, unavailable: true })).toBe(false);
  expect(authUsable({ ...target, status: "error" })).toBe(false);
  expect(authState({ ...target, disabled: true })).toBe("disabled");
  expect(authUsable({ ...target, disabled: true })).toBe(false);
  expect(
    authUsable({
      ...target,
      cooldowns: [{ scope: "credential", reason: "quota", retry_at: "", remaining_seconds: 60 }],
    }),
  ).toBe(false);
});
