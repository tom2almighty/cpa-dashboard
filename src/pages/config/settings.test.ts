import { expect, test } from "bun:test";
import en from "@/i18n/locales/en.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import { COMMON, GROUPS, parseValue } from "./settings";

// 词条以 endpoint 为键平铺在 config.fields 下,这里按字符串索引读取,失败信息里带上具体项
type ConfigLocale = {
  tabs: Record<string, string | undefined>;
  groups: Record<string, string | undefined>;
  sections: Record<string, Record<string, string | undefined> | undefined>;
  fields: Record<string, { label: string; hint: string } | undefined>;
};

const locales: Record<string, ConfigLocale> = {
  "zh-CN": zhCN.config as unknown as ConfigLocale,
  en: en.config as unknown as ConfigLocale,
};
const endpoints = GROUPS.flatMap((group) =>
  group.sections.flatMap((section) => section.items.map((item) => item.endpoint)),
);

test("配置项 endpoint 不重复,常用项只引用已定义的字段", () => {
  expect(new Set(endpoints).size).toBe(endpoints.length);
  expect(COMMON.length).toBeGreaterThan(0);

  const defined = new Set(endpoints);
  expect(COMMON.filter((setting) => !defined.has(setting.endpoint)).map((s) => s.endpoint)).toEqual([]);
});

test("每个配置项的中英文 label 与 hint 齐全,且没有界面已移除的多余词条", () => {
  const missing: string[] = [];
  const stale: string[] = [];

  for (const [lang, locale] of Object.entries(locales)) {
    for (const endpoint of endpoints) {
      const entry = locale.fields[endpoint];
      if (!entry?.label?.trim()) missing.push(`${lang} ${endpoint} label`);
      if (!entry?.hint?.trim()) missing.push(`${lang} ${endpoint} hint`);
    }
    for (const endpoint of Object.keys(locale.fields)) {
      if (!endpoints.includes(endpoint)) stale.push(`${lang} ${endpoint}`);
    }
  }

  expect(missing).toEqual([]);
  expect(stale).toEqual([]);
});

test("tab 名称、分组说明与小节标题中英文齐全", () => {
  const missing: string[] = [];

  for (const [lang, locale] of Object.entries(locales)) {
    for (const id of ["common", ...GROUPS.map((group) => group.id)]) {
      if (!locale.tabs[id]) missing.push(`${lang} tabs.${id}`);
    }
    for (const group of GROUPS) {
      if (!locale.groups[group.id]) missing.push(`${lang} groups.${group.id}`);
      for (const section of group.sections) {
        if (!locale.sections[group.id]?.[section.id]) missing.push(`${lang} sections.${group.id}.${section.id}`);
      }
    }
  }

  expect(missing).toEqual([]);
});

test("json 类型字段接受对象与数组,拒绝标量", () => {
  expect(parseValue("json", '{"codex":[{"name":"gpt-6-sol","max-context-length":524288}]}')).toEqual({
    codex: [{ name: "gpt-6-sol", "max-context-length": 524288 }],
  });
  expect(parseValue("json", '[{"match":"https://x/","type":"bearer","token-env":"TOKEN"}]')).toEqual([
    { match: "https://x/", type: "bearer", "token-env": "TOKEN" },
  ]);
  expect(parseValue("json", "true")).toBeUndefined();
  expect(parseValue("json", "null")).toBeUndefined();
  expect(parseValue("json", "{")).toBeUndefined();
});
