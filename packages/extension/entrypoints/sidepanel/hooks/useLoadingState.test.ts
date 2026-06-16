// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLoadingState } from "./useLoadingState";

describe("useLoadingState", () => {
	afterEach(cleanup);

	it("initializes with zero progress and empty message", () => {
		const { result } = renderHook(() => useLoadingState());
		expect(result.current.progress).toBe(0);
		expect(result.current.message).toBe("");
	});

	it("startLoading sets message and resets progress", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		expect(result.current.message).toBe("正在生成草稿...");
		expect(result.current.progress).toBe(0);
	});

	it("updates progress", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		act(() => {
			result.current.updateProgress(50);
		});
		expect(result.current.progress).toBe(50);
	});

	it("completeLoading resets state", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		act(() => {
			result.current.completeLoading();
		});
		expect(result.current.progress).toBe(0);
		expect(result.current.message).toBe("");
	});
});
