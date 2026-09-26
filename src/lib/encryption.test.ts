import { expect, test } from "bun:test";
import { deobfuscate, isObfuscated, obfuscate } from "./encryption";

test("混淆与解密还原", () => {
  const secret = "sk-admin-secret-key-123456!@#$%^&*()_+";
  const encrypted = obfuscate(secret);

  expect(isObfuscated(encrypted)).toBe(true);
  expect(encrypted.startsWith("enc::v1::")).toBe(true);
  expect(encrypted.includes(secret)).toBe(false);

  const decrypted = deobfuscate(encrypted);
  expect(decrypted).toBe(secret);
});

test("空值与非混淆旧值兼容", () => {
  expect(obfuscate("")).toBe("");
  expect(deobfuscate("")).toBe("");

  const legacyPlaintext = "old-plain-secret";
  expect(isObfuscated(legacyPlaintext)).toBe(false);
  expect(deobfuscate(legacyPlaintext)).toBe(legacyPlaintext);
});

test("中文与特殊字符混淆解密", () => {
  const text = "管理密钥：密码_123456_🚀";
  const encrypted = obfuscate(text);
  expect(isObfuscated(encrypted)).toBe(true);
  expect(deobfuscate(encrypted)).toBe(text);
});
