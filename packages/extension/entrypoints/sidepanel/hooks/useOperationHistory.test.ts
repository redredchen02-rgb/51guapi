// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOperationHistory } from "./useOperationHistory";

describe("useOperationHistory", () => {
	afterEach(() => {
		cleanup();
	});

	it("initializes with empty history", () => {
		const { result } = renderHook(() => useOperationHistory());
		expect(result.current.history).toEqual([]);
	});

	it("records operation", async () => {
		const { result } = renderHook(() => useOperationHistory());

		await act(async () => {
			await result.current.recordOperation({
				type: "generate",
				topic: "测试选题",
				success: true,
			});
		});

		expect(result.current.history).toHaveLength(1);
		expect(result.current.history[0]?.type).toBe("generate");
		expect(result.current.history[0]?.topic).toBe("测试选题");
	});

	it("exports history", async () => {
		const { result } = renderHook(() => useOperationHistory());

		await act(async () => {
			await result.current.recordOperation({
				type: "generate",
				topic: "测试选题",
				success: true,
			});
		});

		const exported = result.current.exportHistory();
		expect(exported).toContain("测试选题");
	});

	it("clears history", async () => {
		const { result } = renderHook(() => useOperationHistory());

		await act(async () => {
			await result.current.recordOperation({
				type: "generate",
				topic: "测试选题",
				success: true,
			});
		});

		expect(result.current.history).toHaveLength(1);

		await act(async () => {
			await result.current.clearHistory();
		});

		expect(result.current.history).toEqual([]);
	});

	it("keeps only last 100 records", async () => {
		const { result } = renderHook(() => useOperationHistory());

		for (let i = 0; i < 105; i++) {
			await act(async () => {
				await result.current.recordOperation({
					type: "generate",
					topic: `选题 ${i}`,
					success: true,
				});
			});
		}

		expect(result.current.history).toHaveLength(100);
	});
});
