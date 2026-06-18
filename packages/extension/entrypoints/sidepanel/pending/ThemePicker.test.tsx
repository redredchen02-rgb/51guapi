// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemePicker } from "./ThemePicker";

afterEach(cleanup);

describe("ThemePicker", () => {
	it("loading → 加载提示", () => {
		render(
			<ThemePicker themes={[]} selected={null} onSelect={() => {}} loading />,
		);
		expect(screen.getByText(/加载中/)).toBeTruthy();
	});

	it("空题材 → 空态引导", () => {
		render(<ThemePicker themes={[]} selected={null} onSelect={() => {}} />);
		expect(screen.getByTestId("theme-picker-empty")).toBeTruthy();
	});

	it("渲染全部 + 题材计数", () => {
		render(
			<ThemePicker
				themes={[
					{ theme: "出軌", count: 3 },
					{ theme: "解約", count: 1 },
				]}
				selected={null}
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText("全部")).toBeTruthy();
		expect(screen.getByText("出軌 3")).toBeTruthy();
		expect(screen.getByText("解約 1")).toBeTruthy();
	});

	it("点题材 → onSelect(题材)；点全部 → onSelect(null)", () => {
		const onSelect = vi.fn();
		render(
			<ThemePicker
				themes={[{ theme: "出軌", count: 3 }]}
				selected={null}
				onSelect={onSelect}
			/>,
		);
		fireEvent.click(screen.getByText("出軌 3"));
		expect(onSelect).toHaveBeenCalledWith("出軌");
		fireEvent.click(screen.getByText("全部"));
		expect(onSelect).toHaveBeenCalledWith(null);
	});

	it("选中题材 → aria-pressed=true", () => {
		render(
			<ThemePicker
				themes={[{ theme: "出軌", count: 3 }]}
				selected="出軌"
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByText("出軌 3").getAttribute("aria-pressed")).toBe(
			"true",
		);
	});
});
