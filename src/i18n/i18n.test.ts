import { expect, test } from "bun:test";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

test("i18n keys parity between zh-CN and en", () => {
  const zhKeys = Object.keys(zhCN) as (keyof typeof zhCN)[];
  const enKeys = Object.keys(en) as (keyof typeof en)[];
  expect(zhKeys.sort()).toEqual(enKeys.sort());

  for (const moduleKey of zhKeys) {
    const zhModule = zhCN[moduleKey];
    const enModule = en[moduleKey];
    expect(Object.keys(zhModule).sort()).toEqual(Object.keys(enModule).sort());
  }
});

test("common terms match official CPA terminology", () => {
  expect(zhCN.nav.auth_files).toBe("认证文件");
  expect(en.nav.auth_files).toBe("Auth Files");

  expect(zhCN.nav.overview).toBe("运行概览");
  expect(en.nav.overview).toBe("Overview");

  expect(zhCN.nav.providers).toBe("提供商");
  expect(en.nav.providers).toBe("AI Providers");

  expect(zhCN.common.login).toBe("登录");
  expect(en.common.login).toBe("Login");

  expect(zhCN.language.zh_cn).toBe("简体中文");
  expect(en.language.en).toBe("English");
});
