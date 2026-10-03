import { expect, test } from "bun:test";
import en from "@/i18n/locales/en.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import {
  AUTH_APPLY_TO,
  AUTH_TYPE_FIELDS,
  AUTH_TYPES,
  GROUPS,
  parseAuthRules,
  parseChannelEntries,
  parseValue,
  readPath,
} from "./settings";

// 词条以 endpoint 为键平铺在 config.fields 下,这里按字符串索引读取,失败信息里带上具体项
type ConfigLocale = {
  tabs: Record<string, string | undefined>;
  groups: Record<string, string | undefined>;
  sections: Record<string, Record<string, string | undefined> | undefined>;
  fields: Record<string, { label: string; hint: string } | undefined>;
  settings: Record<string, string | undefined>;
};

/** 配置页编辑器实际用到的 config.settings.* 词条 */
const SETTINGS_KEYS = [
  "copied_value",
  "copy_value",
  "secret_key_set",
  "secret_key_unset",
  "show_secret",
  "modified",
  "invalid_value",
  "list_add",
  "list_remove",
  "auth_add_rule",
  "auth_rule",
  "auth_empty",
  "auth_invalid_json",
  "auth_match",
  "auth_apply_to",
  "auth_apply_hint",
  "auth_type",
  "auth_allow_insecure",
  "channel_add",
  "channel_name",
  "channel_remove",
  "channel_entry",
  "channel_entry_add",
  "channel_empty",
  "channel_invalid_json",
  ...AUTH_TYPES.map((type) => `auth_type_${type}`),
  ...AUTH_APPLY_TO.map((kind) => `auth_apply_${kind}`),
  ...Object.values(AUTH_TYPE_FIELDS)
    .flat()
    .map((field) => `auth_field_${field}`),
  ...new Set(
    GROUPS.flatMap((group) =>
      group.sections.flatMap((section) => section.items.flatMap((item) => item.entryFields ?? [])),
    ).map((field) => `entry_${field.key}`),
  ),
];

const locales: Record<string, ConfigLocale> = {
  "zh-CN": zhCN.config as unknown as ConfigLocale,
  en: en.config as unknown as ConfigLocale,
};
const endpoints = GROUPS.flatMap((group) =>
  group.sections.flatMap((section) => section.items.map((item) => item.endpoint)),
);

test("配置项 endpoint 不重复", () => {
  expect(new Set(endpoints).size).toBe(endpoints.length);
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
    for (const id of GROUPS.map((group) => group.id)) {
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

test("auth-rules 只接受规则对象数组", () => {
  expect(parseValue("auth-rules", '[{"match":"https://x/","type":"bearer","token_env":"TOKEN"}]')).toEqual([
    { match: "https://x/", type: "bearer", token_env: "TOKEN" },
  ]);
  expect(parseValue("auth-rules", "[]")).toEqual([]);
  // 顶层不是数组、或数组里混入非对象,都视为非法
  expect(parseValue("auth-rules", '{"match":"https://x/"}')).toBeUndefined();
  expect(parseValue("auth-rules", '["https://x/"]')).toBeUndefined();
  expect(parseValue("auth-rules", "[[1]]")).toBeUndefined();
  expect(parseValue("auth-rules", "null")).toBeUndefined();
});

test("parseAuthRules 把空文本当作空数组,非法结构返回 null", () => {
  expect(parseAuthRules("")).toEqual([]);
  expect(parseAuthRules("   ")).toEqual([]);
  expect(parseAuthRules('[{"match":"https://x/"}]')).toEqual([{ match: "https://x/" }]);
  // 顶层不是数组、或数组里混入非对象,可视化编辑无从下手
  expect(parseAuthRules('{"match":"https://x/"}')).toBeNull();
  expect(parseAuthRules('["https://x/"]')).toBeNull();
  expect(parseAuthRules("{")).toBeNull();
});

test("parseChannelEntries 只接受「渠道 -> 条目数组」", () => {
  expect(parseChannelEntries('{"codex":[{"name":"gpt-6-sol","max-context-length":524288}]}')).toEqual({
    codex: [{ name: "gpt-6-sol", "max-context-length": 524288 }],
  });
  expect(parseChannelEntries("{}")).toEqual({});
  expect(parseChannelEntries("")).toEqual({});
  expect(parseChannelEntries('[{"codex":[]}]')).toBeNull();
  expect(parseChannelEntries('{"codex":{}}')).toBeNull();
  expect(parseChannelEntries('{"codex":["x"]}')).toBeNull();
  expect(parseChannelEntries("{")).toBeNull();
});

test("parseValue 与可视化解析对同一份文本判断一致", () => {
  const text = '{"codex":[{"name":"gpt-6-sol"}]}';
  expect(parseValue("channel-entries", text)).toEqual(parseChannelEntries(text));
  expect(parseValue("channel-entries", '{"codex":{}}')).toBeUndefined();
  // 空文本在保存流程里表示「删除该项」,与可视化侧的「空对象」等价
  expect(parseValue("channel-entries", "")).toBeUndefined();
});

test("channel-entries 配置项都声明了 entryFields", () => {
  const items = GROUPS.flatMap((group) => group.sections.flatMap((section) => section.items)).filter(
    (item) => item.type === "channel-entries",
  );
  expect(items.length).toBeGreaterThan(0);
  expect(items.filter((item) => !item.entryFields?.length).map((item) => item.endpoint)).toEqual([]);
});

test("配置页编辑器用到的 config.settings 词条中英文齐全,且没有多余词条", () => {
  const missing: string[] = [];
  const stale: string[] = [];

  for (const [lang, locale] of Object.entries(locales)) {
    for (const key of SETTINGS_KEYS) {
      if (!locale.settings[key]?.trim()) missing.push(`${lang} settings.${key}`);
    }
    for (const key of Object.keys(locale.settings)) {
      if (!SETTINGS_KEYS.includes(key)) stale.push(`${lang} settings.${key}`);
    }
  }

  expect(missing).toEqual([]);
  expect(stale).toEqual([]);
});

test("readPath 支持新版 canonical 路径以及历史别名回退", () => {
  const canonicalConfig = {
    upstream: {
      codex: {
        "disable-codex-cloaking": true,
      },
      claude: {
        "disable-claude-cloak-mode": true,
      },
    },
    client: {
      codex: {
        "optimize-multi-agent-v2": true,
      },
    },
  };
  expect(readPath(canonicalConfig, "upstream/codex/disable-codex-cloaking")).toBe(true);
  expect(readPath(canonicalConfig, "upstream/claude/disable-claude-cloak-mode")).toBe(true);
  expect(readPath(canonicalConfig, "client/codex/optimize-multi-agent-v2")).toBe(true);

  const legacyConfig = {
    oauth: {
      providers: {
        codex: {
          "disable-codex-cloaking": true,
          "optimize-multi-agent-v2": true,
        },
        claude: {
          "disable-claude-cloak-mode": true,
        },
      },
    },
  };
  expect(readPath(legacyConfig, "upstream/codex/disable-codex-cloaking")).toBe(true);
  expect(readPath(legacyConfig, "upstream/claude/disable-claude-cloak-mode")).toBe(true);
  expect(readPath(legacyConfig, "client/codex/optimize-multi-agent-v2")).toBe(true);
});
