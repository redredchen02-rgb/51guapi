// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorDisplay } from "./ErrorDisplay.js";

afterEach(() => cleanup());

describe("ErrorDisplay", () => {
	it("renders error message", () => {
		render(<ErrorDisplay message="测试错误" />);
		expect(screen.getByText("测试错误")).toBeTruthy();
	});

	it("renders with retry button", () => {
		const onRetry = vi.fn();
		render(<ErrorDisplay message="测试错误" onRetry={onRetry} />);

		expect(screen.getByText("重试")).toBeTruthy();
		fireEvent.click(screen.getByText("重试"));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("renders with dismiss button", () => {
		const onDismiss = vi.fn();
		render(<ErrorDisplay message="测试错误" onDismiss={onDismiss} />);

		expect(screen.getByText("关闭")).toBeTruthy();
		fireEvent.click(screen.getByText("关闭"));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it("shows solution hint", () => {
		render(<ErrorDisplay message="网络错误" solution="请检查网络连接" />);
		expect(screen.getByText("请检查网络连接")).toBeTruthy();
	});

	it("shows error details on toggle", () => {
		render(<ErrorDisplay message="错误" details="详细信息" />);
		expect(screen.queryByText("详细信息")).toBeNull();
		fireEvent.click(screen.getByText("显示详情"));
		expect(screen.getByText("详细信息")).toBeTruthy();
	});
});
