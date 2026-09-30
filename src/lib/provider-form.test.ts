import { expect, test } from "bun:test";
import {
  fetchProviderModels,
  formatModelRows,
  fromForm,
  KINDS,
  newKeyRow,
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

// 表格行:只覆盖需要的列,其余保持默认
const rows = (...items: { key: string; weight?: string; proxy?: string; ws?: boolean; cloak?: string }[]) =>
  items.map((item) => ({
    ...newKeyRow(),
    "api-key": item.key,
    weight: item.weight ?? "",
    "proxy-url": item.proxy ?? "",
    websockets: item.ws ?? false,
    cloakMode: item.cloak ?? "",
  }));

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
  const original = {
    name: "c1",
    keys: [{ "api-key": "k1", weight: 3, "proxy-url": "http://p", "alpha-search": true }, { "api-key": "k2" }],
  };
  const form = { ...toForm(original), keys: rows({ key: "k1", weight: "3", proxy: "http://p" }, { key: "k3" }) };
  const out = fromForm(claude, form, original);
  expect(out.keys).toEqual([
    { "api-key": "k1", weight: 3, "proxy-url": "http://p", "alpha-search": true },
    { "api-key": "k3" },
  ]);
  expect(out.name).toBe("c1");
});

test("清空 weight / proxy-url 会删除该键字段,不写入空值", () => {
  const original = { keys: [{ "api-key": "k1", weight: 5, "proxy-url": "http://p" }] };
  const out = fromForm(claude, { ...toForm(original), keys: rows({ key: "k1" }) }, original);
  expect(out.keys).toEqual([{ "api-key": "k1" }]);
});

test("OpenAI 兼容保留 key 的代理,不写分组级 proxy-url / excluded-models", () => {
  const original = {
    name: "or",
    "base-url": "https://x",
    disabled: true,
    keys: [{ "api-key": "k1", "proxy-url": "http://p" }],
  };
  const form = {
    ...toForm(original),
    keys: rows({ key: "k1", proxy: "http://p" }, { key: "k2" }),
    proxyUrl: "http://g",
    excluded: "m",
  };
  const out = fromForm(openai, form, original);
  expect(out.keys).toEqual([{ "api-key": "k1", "proxy-url": "http://p" }, { "api-key": "k2" }]);
  expect(out["proxy-url"]).toBeUndefined();
  expect(out["excluded-models"]).toBeUndefined();
  expect(out["disable-cooling"]).toBeUndefined();
  expect(out.disabled).toBe(true);
});

test("键级 WebSocket 与 cloak.mode 按行写入,未选择的渠道不写", () => {
  const original = { "base-url": "https://x", keys: [{ "api-key": "k1", websockets: true }, { "api-key": "k2" }] };
  const unchanged = fromForm(
    codex,
    { ...toForm(original), keys: rows({ key: "k1", ws: true }, { key: "k2" }) },
    original,
  );
  expect(unchanged.keys).toEqual([{ "api-key": "k1", websockets: true }, { "api-key": "k2" }]);

  const off = fromForm(codex, { ...toForm(original), keys: rows({ key: "k1" }, { key: "k2" }) }, original);
  expect(off.keys).toEqual([{ "api-key": "k1" }, { "api-key": "k2" }]);

  // claude 键上有其它 cloak 字段时只改 mode,保留 strict-mode
  const claudeOriginal = { keys: [{ "api-key": "k1", cloak: { "strict-mode": true } }] };
  const withCloak = fromForm(
    claude,
    { ...toForm(claudeOriginal), keys: rows({ key: "k1", cloak: "never" }) },
    claudeOriginal,
  );
  expect(withCloak.keys).toEqual([{ "api-key": "k1", cloak: { "strict-mode": true, mode: "never" } }]);
  const cleared = fromForm(claude, { ...toForm(claudeOriginal), keys: rows({ key: "k1" }) }, claudeOriginal);
  expect(cleared.keys).toEqual([{ "api-key": "k1", cloak: { "strict-mode": true } }]);
});

test("分组级 disable-cooling 三态与 request-retry", () => {
  const base = { keys: [{ "api-key": "k" }] };
  expect(fromForm(claude, { ...toForm(base), disableCooling: "true", requestRetry: "2" }, base)).toMatchObject({
    "disable-cooling": true,
    "request-retry": 2,
  });
  const existing = { ...base, "disable-cooling": false, "request-retry": 3 };
  const cleared = fromForm(claude, { ...toForm(existing), disableCooling: "", requestRetry: "" }, existing);
  expect(cleared["disable-cooling"]).toBeUndefined();
  expect(cleared["request-retry"]).toBeUndefined();
});

test("校验必填项", () => {
  expect(validate(claude, toForm({}))).toBe("请填写 API Key");
  expect(validate(openai, { ...toForm({}), name: "or", keys: rows({ key: "sk-test" }) })).toBe("请填写 Base URL");
  expect(validate(claude, { ...toForm({ keys: [{ "api-key": "k" }] }), priority: "1.5" })).toBe("优先级必须是整数");
  expect(validate(claude, { ...toForm({ keys: [{ "api-key": "k" }] }), requestRetry: "x" })).toBe("重试轮次必须是整数");
  expect(validate(claude, { ...toForm({ keys: [{ "api-key": "k" }] }), keys: rows({ key: "k", weight: "1.5" }) })).toBe(
    "密钥权重必须是整数",
  );
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

// 按上游地址返回不同响应,复现 SPA 式上游:未知路径返回 200 HTML
async function withRoutes(routes: Record<string, string>, run: (urls: string[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const call = JSON.parse(String(init?.body)) as { url: string };
    urls.push(call.url);
    return Response.json({ status_code: 200, body: routes[call.url] ?? "<!doctype html>" });
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("fetchProviderModels 上游 /models 返回 HTML 时继续试 /v1/models", () =>
  withRoutes({ "https://relay.example.com/v1/models": JSON.stringify({ data: [{ id: "m1" }] }) }, async (urls) => {
    expect(await fetchProviderModels(openai, "https://relay.example.com", "sk-test")).toEqual(["m1"]);
    expect(urls).toEqual(["https://relay.example.com/models", "https://relay.example.com/v1/models"]);
  }));

test("fetchProviderModels 上游全返回 HTML 时给出可读错误", () =>
  withRoutes({}, async () => {
    await expect(fetchProviderModels(openai, "https://relay.example.com", "sk-test")).rejects.toThrow(
      /不是 JSON.*HTTP 200/,
    );
  }));
