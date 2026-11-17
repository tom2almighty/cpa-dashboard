import { expect, test } from "vitest";
import { parseReplacePositions } from "./payload-rules";

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
