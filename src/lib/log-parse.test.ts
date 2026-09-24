import { expect, test } from "bun:test";
import { appendLines } from "./log-parse";

test("解析 CPA 日志行、合并续行、限制条数", () => {
  const lines = [
    "[2025-12-23 20:14:04] [--------] [info ] [server.go:88] API server started",
    "[2025-12-23 20:14:05] [a1b2c3d4] [warn ] [manager.go:524] quota exceeded model=gpt-5",
    "  at retry.go:12",
    "[2025-12-23 20:14:06] [a1b2c3d4] [error] upstream 500",
  ];
  const entries = appendLines([], lines, 1, 10);
  expect(entries.map((e) => [e.id, e.level, e.requestId, e.caller])).toEqual([
    [1, "info", null, "server.go:88"],
    [2, "warn", "a1b2c3d4", "manager.go:524"],
    [3, "error", "a1b2c3d4", ""],
  ]);
  expect(entries[1].message).toBe("quota exceeded model=gpt-5\n  at retry.go:12");
  expect(appendLines(entries, ["[2025-12-23 20:14:07] [--------] [debug] x"], 4, 2).map((e) => e.id)).toEqual([3, 4]);
});
