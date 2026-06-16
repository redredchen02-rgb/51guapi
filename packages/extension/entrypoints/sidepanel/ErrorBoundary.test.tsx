// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

// 子组件抛错会触发 React 与 componentDidCatch 的 console.error，测试中静默。
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	errSpy.mockRestore();
	cleanup();
});

function Boom(): never {
	throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
	it("无异常 → 正常渲染子节点", () => {
		render(
			<ErrorBoundary>
				<div>正常内容</div>
			</ErrorBoundary>,
		);
		expect(screen.getByText("正常内容")).toBeTruthy();
	});

	it("子节点抛错 → 渲染默认兜底 UI（含错误消息）", () => {
		render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>,
		);
		expect(screen.getByText("发生了错误")).toBeTruthy();
		expect(screen.getByText("kaboom")).toBeTruthy();
	});

	it("提供 fallback → 渲染自定义兜底", () => {
		render(
			<ErrorBoundary fallback={<div>自定义兜底</div>}>
				<Boom />
			</ErrorBoundary>,
		);
		expect(screen.getByText("自定义兜底")).toBeTruthy();
		expect(screen.queryByText("发生了错误")).toBeNull();
	});

	it("点击「重试」执行 setState（子仍抛错 → 兜底再现，不崩溃）", () => {
		render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>,
		);
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		// 重试后子节点再次抛错，兜底 UI 仍在
		expect(screen.getByText("发生了错误")).toBeTruthy();
	});
});
