import { expect, test } from "vitest";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

function flattenKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? flattenKeys(child, path) : [path];
  });
}

test("i18n keys parity between zh-CN and en", () => {
  expect(flattenKeys(zhCN).sort()).toEqual(flattenKeys(en).sort());
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
