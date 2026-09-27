import { expect, test } from "bun:test";
import { fetchQuota, resetQuota, supportsQuota } from "./quota";

test("supportsQuota 检验凭据是否有 auth_index", () => {
  expect(supportsQuota({ name: "a.json", auth_index: "abc" })).toBe(true);
  expect(supportsQuota({ name: "b.json" })).toBe(false);
});

test("fetchQuota 在缺失 auth_index 时快速失败", async () => {
  expect(fetchQuota({ name: "no-auth.json" })).rejects.toThrow("凭据缺少 auth_index");
});

test("resetQuota 在缺失 auth_index 时快速失败", async () => {
  expect(resetQuota({ name: "no-auth.json" })).rejects.toThrow("凭据缺少 auth_index");
});
