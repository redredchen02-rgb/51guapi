// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddSiteForm, type AddSiteWarning } from "./AddSiteForm";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

interface Overrides {
	newName?: string;
	newUrl?: string;
	addError?: string;
	addBusy?: boolean;
	addWarning?: AddSiteWarning | null;
}

function setup(overrides: Overrides = {}) {
	const handlers = {
		onNewNameChange: vi.fn(),
		onNewUrlChange: vi.fn(),
		onAdd: vi.fn(),
		onProceed: vi.fn(),
		onCancelWarning: vi.fn(),
	};
	render(
		<AddSiteForm
			newName={overrides.newName ?? ""}
			newUrl={overrides.newUrl ?? ""}
			addError={overrides.addError ?? ""}
			addBusy={overrides.addBusy ?? false}
			addWarning={overrides.addWarning ?? null}
			{...handlers}
		/>,
	);
	return handlers;
}

describe("AddSiteForm (受控展示子组件 — 净增覆盖)", () => {
	it("输入站点名称 → 触发 onNewNameChange", () => {
		const h = setup();
		fireEvent.change(screen.getByPlaceholderText("站點名稱"), {
			target: { value: "新站點" },
		});
		expect(h.onNewNameChange).toHaveBeenCalledWith("新站點");
	});

	it("输入 URL → 触发 onNewUrlChange", () => {
		const h = setup();
		fireEvent.change(screen.getByPlaceholderText(/清單頁 URL/), {
			target: { value: "https://x.com/list" },
		});
		expect(h.onNewUrlChange).toHaveBeenCalledWith("https://x.com/list");
	});

	it("点新增 → 触发 onAdd", () => {
		const h = setup();
		fireEvent.click(screen.getByText("新增"));
		expect(h.onAdd).toHaveBeenCalledTimes(1);
	});

	it("addBusy=true → 新增按钮禁用且文案变「新增中…」", () => {
		setup({ addBusy: true });
		const button = screen.getByText("新增中…") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});

	it("addError 非空 → 显示错误文本", () => {
		setup({ addError: "請填寫站點名稱和 URL" });
		expect(screen.getByText("請填寫站點名稱和 URL")).toBeDefined();
	});

	it("addWarning 非空 → 显示白名单 warning 含 hostname", () => {
		setup({
			addWarning: { hostname: "evil.com", proceed: vi.fn() },
		});
		// hostname 在 warning 文案中出现(strong + 提示句)
		expect(screen.getAllByText("evil.com").length).toBeGreaterThan(0);
		expect(screen.getByText("仍然继续")).toBeDefined();
		expect(screen.getByText("取消")).toBeDefined();
	});

	it("warning 下点「仍然继续」→ 触发 onProceed", () => {
		const h = setup({
			addWarning: { hostname: "evil.com", proceed: vi.fn() },
		});
		fireEvent.click(screen.getByText("仍然继续"));
		expect(h.onProceed).toHaveBeenCalledTimes(1);
	});

	it("warning 下点「取消」→ 触发 onCancelWarning", () => {
		const h = setup({
			addWarning: { hostname: "evil.com", proceed: vi.fn() },
		});
		fireEvent.click(screen.getByText("取消"));
		expect(h.onCancelWarning).toHaveBeenCalledTimes(1);
	});

	it("无 warning 时不渲染「仍然继续」按钮", () => {
		setup();
		expect(screen.queryByText("仍然继续")).toBeNull();
	});
});
