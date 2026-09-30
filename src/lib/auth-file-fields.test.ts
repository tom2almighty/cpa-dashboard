import { expect, test } from "bun:test";
import { diffFields, readFields } from "./auth-file-fields";

const empty = readFields({});

test("读取认证文件字段,兼容连字符旧写法", () => {
  const fields = readFields({
    note: "备用号",
    "proxy-url": "socks5://127.0.0.1:1080",
    "request-retry": 2,
    weight: 5,
    websockets: true,
    headers: { "X-Team": "core" },
    timezone: "Asia/Singapore",
    model_aliases: [{ name: "claude-sonnet-4-5", alias: "cs4.5" }],
    "excluded-models": ["claude-3-5-haiku-20241022"],
  });

  expect(fields.note).toBe("备用号");
  expect(fields.proxy_url).toBe("socks5://127.0.0.1:1080");
  expect(fields.request_retry).toBe("2");
  expect(fields.weight).toBe("5");
  expect(fields.websockets).toBe(true);
  expect(fields.headers).toBe("X-Team: core");
  expect(fields.timezone).toBe("Asia/Singapore");
  expect(fields.model_aliases).toBe("claude-sonnet-4-5 => cs4.5");
  expect(fields.excluded_models).toBe("claude-3-5-haiku-20241022");
});

test("未改动的字段不进补丁,清空的数字写成 null", () => {
  const before = { ...empty, note: "a", priority: "3" };
  expect(diffFields(before, before)).toEqual({});

  const cleared = diffFields(before, { ...before, priority: "" });
  expect(cleared).toEqual({ priority: null });
});

test("别名按 name 合并,保留 fork/display-name 且支持重复 name", () => {
  const source = {
    model_aliases: [
      { name: "gpt-5", alias: "g5", fork: true, "display-name": "GPT-5" },
      { name: "gpt-5", alias: "g5-alt" },
    ],
  };
  const before = readFields(source);

  // 只改别名值,其它字段与顺序保持
  const after = { ...before, model_aliases: "gpt-5 => g5-new\ngpt-5 => g5-alt" };
  expect(diffFields(before, after).model_aliases).toEqual([
    { name: "gpt-5", alias: "g5-new", fork: true, "display-name": "GPT-5" },
    { name: "gpt-5", alias: "g5-alt" },
  ]);

  // 新增条目不带旧字段,清空则写空数组
  const added = diffFields(before, { ...before, model_aliases: "gpt-5 => g5\ngpt-6 => g6" });
  expect(added.model_aliases).toEqual([
    { name: "gpt-5", alias: "g5", fork: true, "display-name": "GPT-5" },
    { name: "gpt-6", alias: "g6" },
  ]);
  expect(diffFields(before, { ...before, model_aliases: "" }).model_aliases).toEqual([]);
});

test("排除模型按行解析,清空的请求头写成空值", () => {
  const before = { ...empty, excluded_models: "a", headers: "X-A: 1" };
  const patch = diffFields(before, { ...before, excluded_models: "a\nb*", headers: "X-B: 2" });

  expect(patch.excluded_models).toEqual(["a", "b*"]);
  expect(patch.headers).toEqual({ "X-A": "", "X-B": "2" });
});
