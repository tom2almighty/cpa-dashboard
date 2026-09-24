import { expect, test } from "bun:test";
import { fromForm, KINDS, toForm, validate } from "./provider-form";

const claude = KINDS.find((k) => k.endpoint === "claude-api-key");
const openai = KINDS.find((k) => k.endpoint === "openai-compatibility");
if (!claude || !openai) throw new Error("缺少提供商定义");

test("编辑时保留表单不管的字段,清空的字段会删除", () => {
  const original = {
    "api-key": "sk-a",
    "auth-index": "a1b2",
    "proxy-url": "socks5://p",
    cloak: { mode: "auto" },
    models: [{ name: "claude-x", alias: "x", "force-mapping": true }],
  };
  const form = { ...toForm(original), proxyUrl: "", models: "claude-x => y\nclaude-z", headers: "X-Team: a" };
  expect(fromForm(claude, form, original)).toEqual({
    "api-key": "sk-a",
    cloak: { mode: "auto" },
    models: [{ name: "claude-x", alias: "y", "force-mapping": true }, { name: "claude-z" }],
    headers: { "X-Team": "a" },
  });
});

test("OpenAI 兼容保留已有 key 条目的代理设置", () => {
  const original = {
    name: "or",
    "base-url": "https://x",
    "api-key-entries": [{ "api-key": "k1", "proxy-url": "http://p" }],
  };
  const out = fromForm(openai, { ...toForm(original), keys: "k1\nk2" }, original);
  expect(out["api-key-entries"]).toEqual([{ "api-key": "k1", "proxy-url": "http://p" }, { "api-key": "k2" }]);
  expect(out.disabled).toBeUndefined();
});

test("校验必填项", () => {
  expect(validate(claude, toForm({}))).toBe("请填写 API Key");
  expect(validate(openai, { ...toForm({}), name: "or" })).toBe("请填写 Base URL");
  expect(validate(claude, { ...toForm({ "api-key": "k" }), priority: "1.5" })).toBe("优先级必须是整数");
});
