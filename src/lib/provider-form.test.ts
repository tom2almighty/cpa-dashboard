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

function kindOf(endpoint: string) {
  const kind = KINDS.find((k) => k.endpoint === endpoint);
  if (!kind) throw new Error(`缺少提供商定义 ${endpoint}`);
  return kind;
}
const claude = kindOf("claude");
const openai = kindOf("openai-compatibility");
const codex = kindOf("codex");
const vertex = kindOf("vertex");

test("编辑时保留表单不管的字段,清空的字段会删除", () => {
  const original = {
    keys: [{ "api-key": "sk-a" }],
    "proxy-url": "socks5://p",
    cloak: { mode: "auto" },
    models: [{ name: "claude-x", alias: "x", "force-mapping": true }],
  };
  const form = { ...toForm(original), proxyUrl: "", models: "claude-x => y\nclaude-z", headers: "X-Team: a" };
  expect(fromForm(claude, form, original)).toEqual({
    keys: [{ "api-key": "sk-a" }],
    cloak: { mode: "auto" },
    models: [{ name: "claude-x", alias: "y", "force-mapping": true }, { name: "claude-z" }],
    headers: { "X-Team": "a" },
  });
});

test("非 OpenAI 分组可改 key、多 key,并按 api-key 保留每个 key 的字段", () => {
  const original = { name: "c1", keys: [{ "api-key": "k1", weight: 3, "proxy-url": "http://p" }, { "api-key": "k2" }] };
  const out = fromForm(claude, { ...toForm(original), keys: "k1\nk3" }, original);
  expect(out.keys).toEqual([{ "api-key": "k1", weight: 3, "proxy-url": "http://p" }, { "api-key": "k3" }]);
  expect(out.name).toBe("c1");
});

test("OpenAI 兼容保留 key 的代理,不写分组级 proxy-url / excluded-models", () => {
  const original = {
    name: "or",
    "base-url": "https://x",
    disabled: true,
    keys: [{ "api-key": "k1", "proxy-url": "http://p" }],
  };
  const out = fromForm(openai, { ...toForm(original), keys: "k1\nk2", proxyUrl: "http://g", excluded: "m" }, original);
  expect(out.keys).toEqual([{ "api-key": "k1", "proxy-url": "http://p" }, { "api-key": "k2" }]);
  expect(out["proxy-url"]).toBeUndefined();
  expect(out["excluded-models"]).toBeUndefined();
  expect(out.disabled).toBe(true);
});

test("WebSocket 开关:关闭时删除,未改动时不影响已有 key", () => {
  const original = { "base-url": "https://x", keys: [{ "api-key": "k1", websockets: true }, { "api-key": "k2" }] };
  const unchanged = fromForm(codex, { ...toForm(original), keys: "k1\nk2\nk3" }, original);
  expect(unchanged.keys).toEqual([
    { "api-key": "k1", websockets: true },
    { "api-key": "k2" },
    { "api-key": "k3", websockets: true },
  ]);
  const off = fromForm(codex, { ...toForm(original), websockets: false }, original);
  expect(off.keys).toEqual([{ "api-key": "k1" }, { "api-key": "k2" }]);
});

test("校验必填项", () => {
  expect(validate(claude, toForm({}))).toBe("请填写 API Key");
  expect(validate(openai, { ...toForm({}), name: "or", keys: "sk-test" })).toBe("请填写 Base URL");
  expect(validate(claude, { ...toForm({ keys: [{ "api-key": "k" }] }), priority: "1.5" })).toBe("优先级必须是整数");
  const vertexForm = toForm({ keys: [{ "api-key": "k" }], models: [{ name: "gemini-pro", alias: "gemini-pro" }] });
  expect(validate(vertex, vertexForm)).toBeNull();
  expect(validate(vertex, { ...vertexForm, models: "gemini-pro" })).not.toBeNull();
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

  // 别名与原名相同也保留(Vertex 需要显式别名)
  expect(formatModelRows([{ name: "gpt-4o", alias: "gpt-4o" }])).toBe("gpt-4o => gpt-4o");
  // 空行或空名称过滤
  expect(
    formatModelRows([
      { name: "", alias: "x" },
      { name: "model-a", alias: "" },
    ]),
  ).toBe("model-a");
});

// api() 读取存储里的服务地址与密钥,测试环境给个空实现
const storage = { getItem: () => null } as unknown as Storage;
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

// 模拟 CPA 的 /api-call:记录转发请求,返回指定的上游状态码与响应体
async function withApiCall(
  statusCode: number,
  body: unknown,
  run: (calls: { url: string; header: Record<string, string> }[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; header: Record<string, string> }[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ status_code: statusCode, body: JSON.stringify(body) });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("fetchProviderModels 填写 Base URL 时经 /api-call 拉上游模型并带 Claude 专属 Header", () =>
  withApiCall(200, { data: [{ id: "custom-claude-3-7-sonnet" }] }, async (calls) => {
    const list = await fetchProviderModels(claude, "https://custom.api.com", "sk-ant-test");
    expect(list).toEqual(["custom-claude-3-7-sonnet"]);
    expect(calls[0].url).toBe("https://custom.api.com/models");
    expect(calls[0].header["x-api-key"]).toBe("sk-ant-test");
    expect(calls[0].header["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].header.Authorization).toBe("Bearer sk-ant-test");
  }));

test("fetchProviderModels 上游失败时直接报出状态码", () =>
  withApiCall(401, "Unauthorized", async () => {
    await expect(fetchProviderModels(claude, "https://custom.api.com", "bad-key")).rejects.toThrow(
      "获取上游模型失败：上游返回 HTTP 401",
    );
  }));

test("fetchProviderModels 自定义 Base URL 若以 /models 结尾不重复追加", () =>
  withApiCall(200, [{ id: "m1" }], async (calls) => {
    const list = await fetchProviderModels(claude, "https://custom.api.com/v1/models", "k");
    expect(list).toEqual(["m1"]);
    expect(calls.map((c) => c.url)).toEqual(["https://custom.api.com/v1/models"]);
  }));
