import { expect, test } from "bun:test";
import {
  fetchProviderModels,
  formatModelRows,
  fromForm,
  KINDS,
  parseModelRows,
  toForm,
  validate,
} from "./provider-form";

const rawClaude = KINDS.find((k) => k.endpoint === "claude-api-key");
const rawOpenai = KINDS.find((k) => k.endpoint === "openai-compatibility");
if (!rawClaude || !rawOpenai) throw new Error("缺少提供商定义");
const claude = rawClaude;
const openai = rawOpenai;

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

test("解析与格式化模型行", () => {
  const text = "gpt-4o => 4o\ngpt-4o-mini\nclaude-3-5-sonnet => sonnet";
  const rows = parseModelRows(text);
  expect(rows).toEqual([
    { name: "gpt-4o", alias: "4o" },
    { name: "gpt-4o-mini", alias: "" },
    { name: "claude-3-5-sonnet", alias: "sonnet" },
  ]);
  expect(formatModelRows(rows)).toBe("gpt-4o => 4o\ngpt-4o-mini\nclaude-3-5-sonnet => sonnet");

  // 别名与原名相同时应省略 =>
  expect(formatModelRows([{ name: "gpt-4o", alias: "gpt-4o" }])).toBe("gpt-4o");
  // 空行或空名称过滤
  expect(
    formatModelRows([
      { name: "", alias: "x" },
      { name: "model-a", alias: "" },
    ]),
  ).toBe("model-a");
});

test("fetchProviderModels 填写 Base URL 时使用上游模型且包含 Claude 专属 Header，不混入内置渠道定义", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedHeaders: Record<string, string> = {};

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(JSON.stringify({ data: [{ id: "custom-claude-3-7-sonnet" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const list = await fetchProviderModels(claude, "https://custom.api.com", "sk-ant-test");
    expect(list).toEqual(["custom-claude-3-7-sonnet"]);
    expect(requestedUrl).toBe("https://custom.api.com/models");
    expect(requestedHeaders["x-api-key"]).toBe("sk-ant-test");
    expect(requestedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(requestedHeaders.Authorization).toBe("Bearer sk-ant-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchProviderModels 填写 Base URL 失败时直接报错，不静默降级为内置模型", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response("Unauthorized", { status: 401 });
  }) as typeof fetch;

  try {
    await expect(fetchProviderModels(claude, "https://custom.api.com", "bad-key")).rejects.toThrow(
      "获取上游模型失败：上游返回 HTTP 401",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchProviderModels 自定义 Base URL 若以 /models 结尾不重复追加", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (url: string | URL | Request) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ id: "m1" }]), { status: 200 });
  }) as typeof fetch;

  try {
    const list = await fetchProviderModels(claude, "https://custom.api.com/v1/models", "k");
    expect(list).toEqual(["m1"]);
    expect(requestedUrl).toBe("https://custom.api.com/v1/models");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
