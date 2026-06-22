// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { useErrorLogger } from "./useErrorLogger";

describe("useErrorLogger", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	afterEach(() => {
		cleanup();
	});

	it("initializes with empty logs", () => {
		const { result } = renderHook(() => useErrorLogger());
		expect(result.current.logs).toEqual([]);
	});

	it("logs error", async () => {
		const { result } = renderHook(() => useErrorLogger());

		await act(async () => {
			await result.current.logError(new Error("测试错误"), {
				context: "测试",
			});
		});

		expect(result.current.logs).toHaveLength(1);
		expect(result.current.logs[0]?.message).toBe("测试错误");
	});

	it("exports error logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		await act(async () => {
			await result.current.logError(new Error("测试错误"));
		});

		const exported = result.current.exportLogs();
		expect(exported).toContain("测试错误");
	});

	it("keeps only last 100 logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		// Log 105 errors
		for (let i = 0; i < 105; i++) {
			await act(async () => {
				await result.current.logError(new Error(`错误 ${i}`));
			});
		}

		expect(result.current.logs).toHaveLength(100);
		expect(result.current.logs[0]?.message).toBe("错误 104");
		expect(result.current.logs[99]?.message).toBe("错误 5");
	});

	it("clears error logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		// Add some logs — separate act to avoid stale closure
		await act(async () => {
			await result.current.logError(new Error("错误1"));
		});
		await act(async () => {
			await result.current.logError(new Error("错误2"));
		});

		expect(result.current.logs).toHaveLength(2);

		// Clear logs
		await act(async () => {
			await result.current.clearLogs();
		});

		expect(result.current.logs).toEqual([]);
	});

	// A12(R14):logError 须持久化 —— 此前只 setLogs,刷新 side panel 即丢。
	it("持久化:logError 后 remount + retrieve 仍在(刷新不丢)", async () => {
		const first = renderHook(() => useErrorLogger());
		await act(async () => {
			await first.result.current.logError(new Error("可恢复错误"));
		});
		first.unmount();

		const second = renderHook(() => useErrorLogger());
		await act(async () => {
			await second.result.current.retrieveLogs();
		});
		expect(second.result.current.logs).toHaveLength(1);
		expect(second.result.current.logs[0]?.message).toBe("可恢复错误");
	});

	// U7:竞态 —— 同一 act 内两次 logError 不可互相覆盖(函数式更新 + deps [])。
	it("竞态:同一渲染周期内 logError(A)+logError(B) 两条都在(最新在前 [B,A])", async () => {
		const { result } = renderHook(() => useErrorLogger());

		await act(async () => {
			await Promise.all([
				result.current.logError(new Error("错误A")),
				result.current.logError(new Error("错误B")),
			]);
		});

		expect(result.current.logs).toHaveLength(2);
		const messages = result.current.logs.map((l) => l.message);
		expect(messages).toContain("错误A");
		expect(messages).toContain("错误B");
		// 最新在前:B 先于 A
		expect(result.current.logs[0]?.message).toBe("错误B");
		expect(result.current.logs[1]?.message).toBe("错误A");
	});

	it("竞态持久化:同一周期内两条 logError 后 remount + retrieve 两条都在", async () => {
		const first = renderHook(() => useErrorLogger());
		await act(async () => {
			await Promise.all([
				first.result.current.logError(new Error("持久A")),
				first.result.current.logError(new Error("持久B")),
			]);
		});
		first.unmount();

		const second = renderHook(() => useErrorLogger());
		await act(async () => {
			await second.result.current.retrieveLogs();
		});
		expect(second.result.current.logs).toHaveLength(2);
		const messages = second.result.current.logs.map((l) => l.message);
		expect(messages).toContain("持久A");
		expect(messages).toContain("持久B");
	});

	it("负向:持久化日志为结构化字段,不夹带密钥/鉴权字面", async () => {
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.logError(new Error("生成失败,请重试。"), {
				kind: "network",
			});
		});
		const serialized = result.current.exportLogs();
		expect(serialized).not.toContain("sk-");
		expect(serialized).not.toContain("Authorization");
		expect(serialized).not.toContain("Bearer");
	});
});
