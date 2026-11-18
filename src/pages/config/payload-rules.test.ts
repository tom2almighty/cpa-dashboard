import { expect, test } from "vitest";
import { parseReplaceEntry, parseReplacePaths, parseReplacePositions } from "./payload-rules";

test("parseReplacePositions 解析逗号分隔的从 1 开始的位置", () => {
  expect(parseReplacePositions("1, 3")).toEqual([1, 3]);
  expect(parseReplacePositions(" 2 ,2 ")).toEqual([2]);
});

test("parseReplacePositions 拒绝空值与非法位置", () => {
  expect(parseReplacePositions("")).toBeNull();
  expect(parseReplacePositions("  ")).toBeNull();
  expect(parseReplacePositions("0")).toBeNull();
  expect(parseReplacePositions("-1")).toBeNull();
  expect(parseReplacePositions("1.5")).toBeNull();
  expect(parseReplacePositions("a")).toBeNull();
});

test("parseReplacePaths 按行收集路径并忽略空行", () => {
  expect(parseReplacePaths("metadata.description\n\n  tools.0.name  \n")).toEqual([
    "metadata.description",
    "tools.0.name",
  ]);
  expect(parseReplacePaths("\n  \n")).toBeNull();
});

test("parseReplaceEntry 区分字面替换与正则替换", () => {
  expect(parseReplaceEntry({ "old name": "new name" })).toEqual({
    kind: "literal",
    from: "old name",
    to: "new name",
  });
  expect(parseReplaceEntry({ pattern: "(?i)user-(\\d+)", replacement: "account-$1" })).toEqual({
    kind: "regex",
    from: "(?i)user-(\\d+)",
    to: "account-$1",
  });
});

test("parseReplaceEntry 拒绝无法识别的条目", () => {
  expect(parseReplaceEntry({})).toBeNull();
  expect(parseReplaceEntry({ foo: "a", bar: "b" })).toBeNull();
});
