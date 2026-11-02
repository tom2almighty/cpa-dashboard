import { expect, test } from "vitest";
import { pluginOAuthIdentifiers, pluginOAuthProviders, resolvePluginAsset, resolvePluginMenuUrl } from "./plugins";

test("resolvePluginMenuUrl 解析插件相对路径与绝对路径", () => {
  expect(resolvePluginMenuUrl("cpa-usage-stats", "/dashboard")).toBe("/v0/resource/plugins/cpa-usage-stats/dashboard");
  expect(resolvePluginMenuUrl("cpa-usage-stats", "dashboard")).toBe("/v0/resource/plugins/cpa-usage-stats/dashboard");
  expect(resolvePluginMenuUrl("cpa-usage-stats", "/v0/resource/plugins/cpa-usage-stats/dashboard")).toBe(
    "/v0/resource/plugins/cpa-usage-stats/dashboard",
  );
  expect(resolvePluginMenuUrl("cpa-usage-stats", "https://example.com/foo")).toBe("https://example.com/foo");
});

test("pluginOAuthIdentifiers 支持多个入口并去除重复与空白", () => {
  expect(pluginOAuthIdentifiers({ id: "p" })).toEqual([]);
  expect(pluginOAuthIdentifiers({ id: "p", oauth_provider: "zcode-zai" })).toEqual(["zcode-zai"]);
  expect(
    pluginOAuthIdentifiers({
      id: "p",
      oauth_provider: "zcode-zai",
      oauth_providers: [" zcode-zai ", "zcode-bigmodel", "", "zcode-bigmodel"],
    }),
  ).toEqual(["zcode-zai", "zcode-bigmodel"]);
});

test("pluginOAuthProviders 使用逐入口名称与图标,缺省时回退插件元数据", () => {
  const base = {
    id: "p",
    metadata: { name: "ZCode", logo: "https://cdn.example/plugin.png" },
    oauth_provider: "zcode-zai",
  };
  expect(pluginOAuthProviders(base)).toEqual([
    { id: "zcode-zai", name: "ZCode", logo: "https://cdn.example/plugin.png" },
  ]);

  const withEntries = {
    ...base,
    oauth_providers: ["zcode-zai"],
    oauth_provider_entries: [
      { identifier: "zcode-zai", name: " Z.ai " },
      { identifier: "zcode-bigmodel", name: "BigModel", logo: "https://cdn.example/bigmodel.png" },
    ],
  };
  expect(pluginOAuthProviders(withEntries)).toEqual([
    { id: "zcode-zai", name: "Z.ai", logo: "https://cdn.example/plugin.png" },
    { id: "zcode-bigmodel", name: "BigModel", logo: "https://cdn.example/bigmodel.png" },
  ]);
  expect(pluginOAuthIdentifiers(withEntries)).toEqual(["zcode-zai", "zcode-bigmodel"]);
});

test("resolvePluginAsset 解析网络与本地图片资产", () => {
  expect(resolvePluginAsset("")).toBe("");
  expect(resolvePluginAsset("   ")).toBe("");
  expect(resolvePluginAsset("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
  expect(resolvePluginAsset("data:image/svg+xml;base64,abc")).toBe("data:image/svg+xml;base64,abc");
  expect(resolvePluginAsset("/assets/logo.png")).toBe("/assets/logo.png");
});
