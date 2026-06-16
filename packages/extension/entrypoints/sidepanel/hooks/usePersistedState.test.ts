// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePersistedState } from "./usePersistedState";

describe("usePersistedState", () => {
	afterEach(() => {
		cleanup();
	});

	it("initializes with default value", () => {
		const { result } = renderHook(() =>
			usePersistedState("test-key", "默认值"),
		);
		expect(result.current[0]).toBe("默认值");
	});

	it("updates value", () => {
		const { result } = renderHook(() =>
			usePersistedState("test-key", "默认值"),
		);

		act(() => {
			result.current[1]("新值");
		});

		expect(result.current[0]).toBe("新值");
	});

	it("updates with function", () => {
		const { result } = renderHook(() =>
			usePersistedState<number>("test-key", 0),
		);

		act(() => {
			result.current[1]((prev) => prev + 1);
		});

		expect(result.current[0]).toBe(1);
	});

	it("handles different types", () => {
		const { result } = renderHook(() =>
			usePersistedState<{ name: string }>("test-key", { name: "初始" }),
		);

		act(() => {
			result.current[1]({ name: "更新" });
		});

		expect(result.current[0]).toEqual({ name: "更新" });
	});
});
