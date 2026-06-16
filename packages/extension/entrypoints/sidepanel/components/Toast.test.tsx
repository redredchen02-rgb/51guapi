// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast.js";

afterEach(() => cleanup());

describe("Toast", () => {
	it("渲染成功消息", () => {
		render(<Toast message="操作成功" type="success" />);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText("操作成功")).toBeTruthy();
	});

	it("渲染错误消息", () => {
		render(<Toast message="操作失败" type="error" />);
		expect(screen.getByText("操作失败")).toBeTruthy();
	});

	it("超时后调用 onClose", async () => {
		vi.useFakeTimers();
		const onClose = vi.fn();
		render(
			<Toast message="ok" type="success" onClose={onClose} duration={1000} />,
		);
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});
		expect(onClose).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it("点关闭按钮调用 onClose", () => {
		const onClose = vi.fn();
		render(<Toast message="ok" type="success" onClose={onClose} />);
		fireEvent.click(screen.getByLabelText("关闭"));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("无 onClose 时不渲染关闭按钮", () => {
		render(<Toast message="info" type="info" />);
		expect(screen.queryByLabelText("关闭")).toBeNull();
	});
});
