import { expect, test } from "bun:test";
import { resolvePluginAsset, resolvePluginMenuUrl } from "./plugins";

test("resolvePluginMenuUrl 解析插件相对路径与绝对路径", () => {
  expect(resolvePluginMenuUrl("cpa-usage-stats", "/dashboard")).toBe("/v0/resource/plugins/cpa-usage-stats/dashboard");
  expect(resolvePluginMenuUrl("cpa-usage-stats", "dashboard")).toBe("/v0/resource/plugins/cpa-usage-stats/dashboard");
  expect(resolvePluginMenuUrl("cpa-usage-stats", "/v0/resource/plugins/cpa-usage-stats/dashboard")).toBe(
    "/v0/resource/plugins/cpa-usage-stats/dashboard",
  );
  expect(resolvePluginMenuUrl("cpa-usage-stats", "https://example.com/foo")).toBe("https://example.com/foo");
});

test("resolvePluginAsset 解析网络与本地图片资产", () => {
  expect(resolvePluginAsset("")).toBe("");
  expect(resolvePluginAsset("   ")).toBe("");
  expect(resolvePluginAsset("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
  expect(resolvePluginAsset("data:image/svg+xml;base64,abc")).toBe("data:image/svg+xml;base64,abc");
  expect(resolvePluginAsset("/assets/logo.png")).toBe("/assets/logo.png");
});
