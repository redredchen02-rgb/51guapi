// @vitest-environment jsdom

import type { ContentDraft } from "@51guapi/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
	buildPrompt: (_t: string, topic: string) => topic,
}));

vi.mock("../../lib/storage", () => ({
	getSettings: async () => ({
		promptTemplate: "{{topic}}",
		endpoint: "",
		model: "",
	}),
	getCurrentDraft: async () => null,
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

import { App } from "./App";

async function waitForAppReady() {
	await screen.findByText("吃瓜小帮手");
}

describe("App", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		saveCurrentDraftMock.mockReset();
		exportDraftAsJSONMock.mockClear();
		downloadFileMock.mockClear();
	});
	afterEach(() => cleanup());

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

	it("生成失败(no-key)→ 显示去设置的提示", async () => {
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
		expect(await screen.findByText(/点右上角设置/)).toBeTruthy();
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
	});
});
