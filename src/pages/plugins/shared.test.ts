import { expect, test } from "vitest";
import { localizeStorePlugin, type StorePlugin } from "./shared";

function plugin(overrides: Partial<StorePlugin>): StorePlugin {
  return { store_id: "source:p", source_id: "source", id: "p", ...overrides };
}

test("商店条目按界面语言覆盖文案,缺失字段回退原文", () => {
  const item = plugin({
    name: "Sample Plugin",
    description: "English description",
    author: "author",
    license: "MIT",
    tags: ["provider"],
    locales: {
      "zh-CN": { name: "示例插件", description: "中文描述", tags: ["插件"] },
    },
  });

  expect(localizeStorePlugin(item, "zh-CN")).toMatchObject({
    name: "示例插件",
    description: "中文描述",
    author: "author",
    license: "MIT",
    tags: ["插件"],
  });
  expect(localizeStorePlugin(item, "en")).toBe(item);
});

test("语言标签按主语言回退", () => {
  const item = plugin({
    name: "Sample Plugin",
    locales: { zh: { description: "中文描述" } },
  });

  expect(localizeStorePlugin(item, "zh-CN").description).toBe("中文描述");
  expect(localizeStorePlugin(item, "zh-TW").description).toBe("中文描述");
  expect(localizeStorePlugin(item, "en").description).toBeUndefined();
});
