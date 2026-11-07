import { expect, test } from "vitest";
import {
  decodePluginText,
  normalizePlugin,
  pluginOAuthIdentifiers,
  pluginOAuthProviders,
  resolvePluginAsset,
  resolvePluginMenuUrl,
} from "./plugins";

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

test("decodePluginText 只还原一次后端转义", () => {
  expect(decodePluginText("Z.ai &lt;International&gt; &amp; &#34;Team&#34; &#39;云端&#39;")).toBe(
    "Z.ai <International> & \"Team\" '云端'",
  );
  expect(decodePluginText("Literal &amp;lt;tag&amp;gt; &amp;#39; &amp;amp;")).toBe("Literal &lt;tag&gt; &#39; &amp;");
  expect(decodePluginText("https://a.test/logo.svg?a=1&amp;b=2")).toBe("https://a.test/logo.svg?a=1&b=2");
});

test("normalizePlugin 还原名称、图标、菜单与配置字段", () => {
  const plugin = normalizePlugin({
    id: "p",
    logo: "https://cdn.test/p.svg?a=1&amp;b=2",
    oauth_providers: ["portal"],
    oauth_provider_entries: [
      { identifier: "portal", name: " Portal &amp; Co ", logo: "https://cdn.test/e.svg?x=1&amp;y=2" },
    ],
    menus: [{ path: "/dashboard?a=1&amp;b=2", menu: "Usage &amp; Stats", description: "&lt;b&gt;usage&lt;/b&gt;" }],
    config_fields: [
      {
        name: "labels",
        type: "array",
        description: "&#34;Tag&#34; &amp; label",
        enum_values: ["a&amp;b", "c&lt;d"],
        default: ["x&amp;y"],
      },
    ],
    metadata: {
      name: "ZCode &amp; Friends",
      logo: "https://cdn.test/meta.svg?a=1&amp;b=2",
      config_fields: [{ name: "note", description: "&lt;i&gt;note&lt;/i&gt;" }],
    },
  });
  expect(plugin.logo).toBe("https://cdn.test/p.svg?a=1&b=2");
  expect(plugin.oauth_provider_entries).toEqual([
    { identifier: "portal", name: " Portal & Co ", logo: "https://cdn.test/e.svg?x=1&y=2" },
  ]);
  expect(plugin.menus).toEqual([{ path: "/dashboard?a=1&b=2", menu: "Usage & Stats", description: "<b>usage</b>" }]);
  expect(plugin.config_fields).toEqual([
    {
      name: "labels",
      type: "array",
      description: '"Tag" & label',
      enum_values: ["a&b", "c<d"],
      default: ["x&y"],
    },
  ]);
  expect(plugin.metadata?.name).toBe("ZCode & Friends");
  expect(plugin.metadata?.logo).toBe("https://cdn.test/meta.svg?a=1&b=2");
  expect(plugin.metadata?.config_fields).toEqual([{ name: "note", description: "<i>note</i>" }]);
});

test("pluginOAuthProviders 使用还原后的入口名称与图标", () => {
  const plugin = normalizePlugin({
    id: "p",
    supports_oauth: true,
    oauth_providers: ["portal"],
    oauth_provider_entries: [
      { identifier: "portal", name: "Z.ai &lt;International&gt;", logo: "https://cdn.test/e.svg?a=1&amp;b=2" },
    ],
  });
  expect(pluginOAuthProviders(plugin)).toEqual([
    { id: "portal", name: "Z.ai <International>", logo: "https://cdn.test/e.svg?a=1&b=2" },
  ]);
});

test("resolvePluginAsset 解析网络与本地图片资产", () => {
  expect(resolvePluginAsset("")).toBe("");
  expect(resolvePluginAsset("   ")).toBe("");
  expect(resolvePluginAsset("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
  expect(resolvePluginAsset("data:image/svg+xml;base64,abc")).toBe("data:image/svg+xml;base64,abc");
  expect(resolvePluginAsset("/assets/logo.png")).toBe("/assets/logo.png");
});
