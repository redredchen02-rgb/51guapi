// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Settings 组件依赖 storage / prompt-client / connection-test，全部 mock 掉以隔离渲染。
vi.mock("../../lib/storage", () => ({
	DEFAULT_SETTINGS: {},
	deriveFewShotExamples: vi.fn(() => ""),
	getApiKey: vi.fn(async () => ""),
	getBackendToken: vi.fn(async () => ""),
	getSettings: vi.fn(async () => ({
		endpoint: "",
		model: "gpt-4o-mini",
		promptTemplate: "{{topic}}",
		recommendedTags: ["漢化"],
		fieldMapping: {},
		backendUrl: "",
		reviewCriteriaPrompt: "",
		dailyBatchSize: 5,
		fewShotPairs: [],
	})),
	saveApiKey: vi.fn(async () => {}),
	saveBackendToken: vi.fn(async () => {}),
	saveSettings: vi.fn(async () => {}),
}));

vi.mock("../../lib/prompt-client", () => ({
	fetchPrompts: vi.fn(async () => ({ ok: true, prompts: [] })),
	createPrompt: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../lib/connection-test", () => ({
	testConnection: vi.fn(async () => ({ status: "ok", message: "连接正常" })),
}));

import { testConnection } from "../../lib/connection-test";
import { getSettings, saveSettings } from "../../lib/storage";
import { Settings } from "./Settings.js";

const mockSaveSettings = vi.mocked(saveSettings);
const mockTestConn = vi.mocked(testConnection);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

async function renderLoaded(onClose = vi.fn()) {
	render(<Settings onClose={onClose} />);
	// 等待 load effect 注水（model 输入回填）
	await screen.findByDisplayValue("gpt-4o-mini");
	return { onClose };
}

describe("Settings 组件渲染", () => {
	it("加载后渲染主要分区与回填的设置值", async () => {
		await renderLoaded();
		expect(screen.getByText("设置")).toBeTruthy();
		expect(screen.getByText("LLM 配置")).toBeTruthy();
		expect(screen.getByText("后端连接（可选）")).toBeTruthy();
		expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
		// getSettings 被 load effect 调用
		expect(vi.mocked(getSettings)).toHaveBeenCalled();
	});

	it("点击「← 返回」→ 调用 onClose", async () => {
		const { onClose } = await renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: "← 返回" }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("默认配置点击「保存」→ 调 saveSettings 并显示「已保存。」", async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(mockSaveSettings).toHaveBeenCalledOnce());
		expect(await screen.findByText("已保存。")).toBeTruthy();
	});

	it("endpoint 非 https → 保存被拦截，显示错误，不调 saveSettings", async () => {
		await renderLoaded();
		fireEvent.change(screen.getByLabelText("LLM Endpoint (https://)"), {
			target: { value: "http://insecure.example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("https");
		expect(mockSaveSettings).not.toHaveBeenCalled();
	});

	it("点击「测试连接」→ 调 testConnection 并展示结果", async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
		await waitFor(() => expect(mockTestConn).toHaveBeenCalledOnce());
		const status = await screen.findByRole("status");
		expect(status.textContent).toContain("連線成功");
	});

	it("展开「备用 LLM 模型」→ 出现备用模型输入框", async () => {
		await renderLoaded();
		expect(screen.queryByLabelText("备用模型名(可选)")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /备用 LLM 模型/ }));
		expect(screen.getByLabelText("备用模型名(可选)")).toBeTruthy();
	});
});
