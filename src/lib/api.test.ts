import { expect, test } from "bun:test";
import { ApiError, errorText } from "./api";

test("CPA 错误码映射为文案", () => {
  expect(errorText(new ApiError(404, "auth not found", "auth not found"))).toBe("CPA 里找不到这个凭据");
  expect(errorText(new ApiError(503, "core auth manager unavailable", "core auth manager unavailable"))).toBe(
    "CPA 的认证管理器不可用，请稍后重试",
  );
  expect(errorText(new ApiError(400, "boom", "read_only_field"))).toBe("该字段由 CPA 托管，不能修改");
});

test("未覆盖的错误码与非 ApiError 直接用原文", () => {
  expect(errorText(new ApiError(500, "write failed", "write_failed"))).toBe("write failed");
  expect(errorText(new Error("network down"))).toBe("network down");
  expect(errorText("boom")).toBe("boom");
});
