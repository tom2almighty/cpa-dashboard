import { expect, test } from "vitest";
import { paginate } from "./pagination";

test("paginate 按页切片并把越界页码收回到最后一页", () => {
  const items = Array.from({ length: 95 }, (_, i) => i);

  expect(paginate(items, 1, 50)).toEqual({ pageItems: items.slice(0, 50), current: 1, pageCount: 2 });
  expect(paginate(items, 2, 50)).toEqual({ pageItems: items.slice(50), current: 2, pageCount: 2 });
  expect(paginate(items, 99, 50)).toEqual({ pageItems: items.slice(50), current: 2, pageCount: 2 });
});

test("空列表也保留一个空页", () => {
  expect(paginate([], 1, 50)).toEqual({ pageItems: [], current: 1, pageCount: 1 });
});
