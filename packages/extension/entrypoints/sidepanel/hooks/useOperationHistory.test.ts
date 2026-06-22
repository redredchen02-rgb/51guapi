// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { useOperationHistory } from "./useOperationHistory";

describe("useOperationHistory", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

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

	it("persists history for later retrieval", async () => {
		const first = renderHook(() => useOperationHistory());

		await act(async () => {
			await first.result.current.recordOperation({
				type: "generate",
				topic: "可恢复选题",
				success: true,
			});
		});
		first.unmount();

		const second = renderHook(() => useOperationHistory());
		await act(async () => {
			await second.result.current.retrieveHistory();
		});

		expect(second.result.current.history).toHaveLength(1);
		expect(second.result.current.history[0]?.topic).toBe("可恢复选题");
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

	// U7:竞态 —— 同一 act 内两次 recordOperation 不可互相覆盖(函数式更新 + deps [])。
	it("竞态:同一渲染周期内两次 recordOperation 两条都在(最新在前)", async () => {
		const { result } = renderHook(() => useOperationHistory());

		await act(async () => {
			await Promise.all([
				result.current.recordOperation({
					type: "generate",
					topic: "选题A",
					success: true,
				}),
				result.current.recordOperation({
					type: "generate",
					topic: "选题B",
					success: true,
				}),
			]);
		});

		expect(result.current.history).toHaveLength(2);
		const topics = result.current.history.map((r) => r.topic);
		expect(topics).toContain("选题A");
		expect(topics).toContain("选题B");
		// 最新在前:B 先于 A
		expect(result.current.history[0]?.topic).toBe("选题B");
		expect(result.current.history[1]?.topic).toBe("选题A");
	});

	it("竞态持久化:同一周期内两次 recordOperation 后 remount + retrieve 两条都在", async () => {
		const first = renderHook(() => useOperationHistory());
		await act(async () => {
			await Promise.all([
				first.result.current.recordOperation({
					type: "generate",
					topic: "持久选题A",
					success: true,
				}),
				first.result.current.recordOperation({
					type: "generate",
					topic: "持久选题B",
					success: true,
				}),
			]);
		});
		first.unmount();

		const second = renderHook(() => useOperationHistory());
		await act(async () => {
			await second.result.current.retrieveHistory();
		});
		expect(second.result.current.history).toHaveLength(2);
		const topics = second.result.current.history.map((r) => r.topic);
		expect(topics).toContain("持久选题A");
		expect(topics).toContain("持久选题B");
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
