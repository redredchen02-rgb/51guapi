// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.js";

afterEach(() => cleanup());

describe("KeyboardShortcutsHelp", () => {
	it("renders help button", () => {
		render(<KeyboardShortcutsHelp />);
		expect(screen.getByRole("button", { name: "快捷键帮助" })).toBeTruthy();
	});

	it("shows shortcuts list when opened", () => {
		render(<KeyboardShortcutsHelp />);

		fireEvent.click(screen.getByRole("button", { name: "快捷键帮助" }));

		expect(screen.getByText("快捷键帮助")).toBeTruthy();
		expect(screen.getByText("Ctrl + Enter")).toBeTruthy();
		expect(screen.getByText("生成草稿")).toBeTruthy();
		expect(screen.queryByText("填充到当前页")).toBeNull();
	});

	it("shows help when triggered", () => {
		render(<KeyboardShortcutsHelp />);

		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "快捷键帮助" }));

		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("closes when close button clicked", () => {
		render(<KeyboardShortcutsHelp />);

		fireEvent.click(screen.getByRole("button", { name: "快捷键帮助" }));

		fireEvent.click(screen.getByLabelText("关闭"));

		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("打开后对话框获焦(使真实 Esc 可达) + Escape 关闭(A11/R10)", () => {
		render(<KeyboardShortcutsHelp />);
		fireEvent.click(screen.getByRole("button", { name: "快捷键帮助" }));
		const dialog = screen.getByRole("dialog");
		// 修复点:容器须可聚焦且打开后获焦,否则 role=dialog 的 div 收不到真实键盘事件。
		expect(dialog.getAttribute("tabindex")).toBe("-1");
		expect(document.activeElement).toBe(dialog);
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
