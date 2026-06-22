// @vitest-environment jsdom

import type { ContentDraft } from "@51guapi/shared";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const draft: ContentDraft = {
	id: "d1",
	title: "AI 标题",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>正文</p>",
	tags: ["奇幻"],
	description: "",
	status: "draft",
	createdAt: "2026-06-03T00:00:00.000Z",
};

const requestGenerate = vi.fn();
const saveCurrentDraftMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);
const getSettingsMock = vi.hoisted(() => vi.fn());
const getCurrentDraftMock = vi.hoisted(() =>
	vi.fn<() => Promise<unknown>>(async () => null),
);
const exportDraftAsJSONMock = vi.hoisted(() => vi.fn(() => '{"json":true}'));
const downloadFileMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/auth-client", () => ({
	isAuthenticated: vi.fn(async () => true),
	login: vi.fn(),
	getToken: vi.fn(),
	clearToken: vi.fn(),
	setToken: vi.fn(),
}));

vi.mock("../../lib/messaging", () => ({
	requestGenerate: (...a: unknown[]) => requestGenerate(...a),
	buildPrompt: (template: string, topic: string) =>
		template ? template.replaceAll("{{topic}}", topic) : topic,
}));

vi.mock("../../lib/storage", () => ({
	getSettings: getSettingsMock,
	getCurrentDraft: getCurrentDraftMock,
	saveCurrentDraft: saveCurrentDraftMock,
	clearCurrentDraft: async () => {},
}));

vi.mock("../../lib/export", () => ({
	exportDraftAsJSON: exportDraftAsJSONMock,
	exportDraftAsMarkdown: vi.fn(() => "# md"),
	copyToClipboard: vi.fn(async () => {}),
	downloadFile: downloadFileMock,
	safeFilename: vi.fn((_d: ContentDraft, ext: string) => `file.${ext}`),
}));

vi.mock("./PendingTopicsView", () => ({
	PendingTopicsView: ({
		onDraftReady,
	}: {
		onDraftReady: (payload: { draft: ContentDraft; facts: unknown }) => void;
	}) => (
		<button
			type="button"
			onClick={() =>
				onDraftReady({
					draft,
					facts: {
						當事人: "测试人物",
						事件摘要: "测试摘要",
						起因: null,
						經過: null,
						結果: null,
						來源連結: "https://example.com/source",
						發生時間: null,
						熱度標籤: null,
					},
				})
			}
		>
			mock approve pending
		</button>
	),
}));

import { isAuthenticated, login } from "../../lib/auth-client";
import { App } from "./App";

async function waitForAppReady() {
	await screen.findByText("吃瓜小帮手");
}

describe("App", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		getSettingsMock.mockReset();
		getSettingsMock.mockResolvedValue({
			promptTemplate: "{{topic}}",
			endpoint: "",
			model: "",
		});
		getCurrentDraftMock.mockReset();
		getCurrentDraftMock.mockResolvedValue(null);
		saveCurrentDraftMock.mockReset();
		exportDraftAsJSONMock.mockClear();
		downloadFileMock.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it("自用模式:无 token 启动 → 自动免密登入 → 直达主界面,无密码输入", async () => {
		vi.mocked(isAuthenticated).mockResolvedValueOnce(false);
		vi.mocked(login).mockResolvedValueOnce({ ok: true, token: "t" });
		const { container } = render(<App />);
		await waitForAppReady();
		expect(login).toHaveBeenCalled();
		expect(container.querySelector('input[type="password"]')).toBeNull();
	});

	it("空主题点生成 → 提示输入主题", async () => {
		render(<App />);
		await waitForAppReady();
		fireEvent.click(screen.getByText("生成草稿"));
		expect(await screen.findByText(/请先输入主题/)).toBeTruthy();
		expect(requestGenerate).not.toHaveBeenCalled();
	});

	it("输入主题生成 → 渲染可编辑草稿预览", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		const titleInput = await screen.findByDisplayValue("AI 标题");
		expect(titleInput).toBeTruthy();
		expect(requestGenerate).toHaveBeenCalledWith("某新番", undefined);
	});

	it("生成前重新读取最新 Prompt 模板", async () => {
		getSettingsMock.mockResolvedValue({
			promptTemplate: "OLD {{topic}}",
			endpoint: "",
			model: "",
		});
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		getSettingsMock.mockResolvedValueOnce({
			promptTemplate: "NEW {{topic}}",
			endpoint: "",
			model: "",
		});
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));

		await screen.findByDisplayValue("AI 标题");
		expect(requestGenerate).toHaveBeenCalledWith("NEW 某新番", undefined);
	});

	it("生成中进度条随定时器持续推进", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		requestGenerate.mockReturnValue(new Promise(() => {}));
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});

		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
			"30",
		);
	});

	it("取消生成后停止进度计时器并回到输入态", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		requestGenerate.mockReturnValue(new Promise(() => {}));
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
			"10",
		);

		fireEvent.click(screen.getByText("取消"));
		expect(screen.queryByRole("progressbar")).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});
		expect(screen.queryByRole("progressbar")).toBeNull();
		expect(screen.getByPlaceholderText(/输入选题/)).toBeTruthy();
	});

	it("生成失败(no-key)→ 提示配置后端 LLM_API_KEY", async () => {
		requestGenerate.mockResolvedValue({
			ok: false,
			kind: "no-key",
			error: "请先配置 key",
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		expect(await screen.findByText(/packages\/backend\/.env/)).toBeTruthy();
	});

	it("待审池生成草稿 → App 保留 facts 并传给导出", async () => {
		render(<App />);
		await waitForAppReady();
		fireEvent.click(screen.getByText("待审池"));
		fireEvent.click(await screen.findByText("mock approve pending"));
		expect(await screen.findByDisplayValue("AI 标题")).toBeTruthy();

		fireEvent.click(screen.getByText("导出 JSON"));

		expect(exportDraftAsJSONMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: "d1" }),
			expect.objectContaining({
				當事人: "测试人物",
				來源連結: "https://example.com/source",
			}),
		);
		expect(saveCurrentDraftMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: "d1" }),
			expect.objectContaining({
				當事人: "测试人物",
				來源連結: "https://example.com/source",
			}),
		);
	});

	it("恢复待审池草稿 → 仍保留 facts 并传给导出", async () => {
		getCurrentDraftMock.mockResolvedValueOnce({
			draft,
			facts: {
				當事人: "恢复人物",
				事件摘要: "恢复摘要",
				起因: null,
				經過: null,
				結果: null,
				來源連結: "https://example.com/restored",
				發生時間: null,
				熱度標籤: null,
			},
		});

		render(<App />);
		await waitForAppReady();
		expect(await screen.findByDisplayValue("AI 标题")).toBeTruthy();

		fireEvent.click(screen.getByText("导出 JSON"));

		expect(exportDraftAsJSONMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: "d1" }),
			expect.objectContaining({
				當事人: "恢复人物",
				來源連結: "https://example.com/restored",
			}),
		);
	});
});
