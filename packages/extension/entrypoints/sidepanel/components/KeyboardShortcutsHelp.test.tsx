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
});
