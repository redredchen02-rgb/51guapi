// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useErrorHandler } from "./useErrorHandler";

describe("useErrorHandler", () => {
	it("initializes with no error", () => {
		const { result } = renderHook(() => useErrorHandler());
		expect(result.current.error).toBeNull();
	});

	it("captures error", () => {
		const { result } = renderHook(() => useErrorHandler());

		act(() => {
			result.current.handleError(new Error("测试错误"));
		});

		expect(result.current.error).toBe("测试错误");
	});

	it("clears error", () => {
		const { result } = renderHook(() => useErrorHandler());

		act(() => {
			result.current.handleError(new Error("测试错误"));
		});

		act(() => {
			result.current.clearError();
		});

		expect(result.current.error).toBeNull();
	});

	it("handles string error", () => {
		const { result } = renderHook(() => useErrorHandler());

		act(() => {
			result.current.handleError("字符串错误");
		});

		expect(result.current.error).toBe("字符串错误");
	});
});
