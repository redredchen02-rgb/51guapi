// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";

describe("useKeyboardShortcuts", () => {
	it("Ctrl+Enter 触发 onGenerate", () => {
		const onGenerate = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onGenerate }));

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
			);
		});

		expect(onGenerate).toHaveBeenCalled();
	});

	it("普通按键不触发任何回调", () => {
		const onGenerate = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onGenerate }));

		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
		});

		expect(onGenerate).not.toHaveBeenCalled();
	});

	it("unmount 后移除监听", () => {
		const onGenerate = vi.fn();
		const { unmount } = renderHook(() => useKeyboardShortcuts({ onGenerate }));

		unmount();

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
			);
		});

		expect(onGenerate).not.toHaveBeenCalled();
	});

	it("Ctrl+Shift+Enter 触发 onFill", () => {
		const onFill = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onFill }));

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					ctrlKey: true,
					shiftKey: true,
				}),
			);
		});

		expect(onFill).toHaveBeenCalled();
	});

	it("Ctrl+ArrowRight 触发 onNext", () => {
		const onNext = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onNext }));

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", ctrlKey: true }),
			);
		});

		expect(onNext).toHaveBeenCalled();
	});

	it("Ctrl+S 触发 onSave", () => {
		const onSave = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onSave }));

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
			);
		});

		expect(onSave).toHaveBeenCalled();
	});

	it("Cmd 键在 macOS 上也可用", () => {
		const onGenerate = vi.fn();
		renderHook(() => useKeyboardShortcuts({ onGenerate }));

		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
			);
		});

		expect(onGenerate).toHaveBeenCalled();
	});
});
