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

import { App } from "./App";

async function waitForAppReady() {
	await screen.findByText("吃瓜小帮手");
}

describe("App", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		saveCurrentDraftMock.mockReset();
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
		expect(requestGenerate).toHaveBeenCalledWith("某新番");
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
});
