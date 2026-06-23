// @vitest-environment jsdom
import type { ContentDraft } from "@51guapi/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftReviewPanel } from "./DraftReviewPanel.js";

vi.mock("../../lib/storage", () => ({
	getSettings: vi.fn(async () => ({
		endpoint: "http://127.0.0.1:3002",
		model: "m",
		reviewCriteriaPrompt: "",
	})),
}));

// 保留真实 mergeRewriteResult(纯函数,白名单合并),仅桩 review/rewrite 网络代理。
vi.mock("../../lib/llm", async (orig) => ({
	...(await orig<typeof import("../../lib/llm")>()),
	reviewDraft: vi.fn(),
	rewriteDraft: vi.fn(),
}));

import { reviewDraft, rewriteDraft } from "../../lib/llm.js";
import { getSettings } from "../../lib/storage.js";

const mockReview = vi.mocked(reviewDraft);
const mockRewrite = vi.mocked(rewriteDraft);
const mockGetSettings = vi.mocked(getSettings);

const draft: ContentDraft = {
	id: "d1",
	title: "原标题",
	subtitle: "",
	category: "2",
	coverImageUrl: "cover.png",
	body: "<p>原正文</p>",
	tags: ["a"],
	description: "",
	status: "draft",
	createdAt: "2026-06-18T00:00:00.000Z",
};

afterEach(() => cleanup());

describe("DraftReviewPanel", () => {
	beforeEach(() => {
		mockReview.mockReset();
		mockRewrite.mockReset();
		mockGetSettings.mockResolvedValue({
			endpoint: "http://127.0.0.1:3002",
			model: "m",
			promptTemplate: "",
			fewShotPairs: [],
			recommendedTags: [],
			reviewCriteriaPrompt: "",
		});
	});

	it("AI 评审 → 渲染各维度反馈", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: {
				ok: false,
				dimensions: [
					{ name: "body_richness", pass: false, reason: "正文太短" },
					{ name: "title_quality", pass: true },
				],
			},
		});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		expect(await screen.findByText(/body_richness/)).toBeTruthy();
		expect(screen.getByText(/title_quality/)).toBeTruthy();
		expect(mockReview).toHaveBeenCalledOnce();
	});

	it("AI 评审 → 使用设置里的自定义评审标准", async () => {
		mockGetSettings.mockResolvedValue({
			endpoint: "http://127.0.0.1:3002",
			model: "m",
			promptTemplate: "",
			fewShotPairs: [],
			recommendedTags: [],
			reviewCriteriaPrompt: "只按是否适合导出评分",
		});
		mockReview.mockResolvedValue({
			ok: true,
			result: { ok: true, dimensions: [] },
		});

		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));

		await screen.findByText(/全部维度通过/);
		expect(mockReview).toHaveBeenCalledWith(
			draft,
			"只按是否适合导出评分",
			expect.objectContaining({
				settings: expect.objectContaining({
					reviewCriteriaPrompt: "只按是否适合导出评分",
				}),
			}),
		);
	});

	it("未达标维度 → 改写 → 采纳:应用合并草稿,保留 original 的 id/coverImageUrl", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: {
				ok: false,
				dimensions: [{ name: "body_richness", pass: false }],
			},
		});
		// 后端返回一个企图改写 id/cover 的草稿;mergeRewriteResult 必须挡住。
		mockRewrite.mockResolvedValue({
			ok: true,
			draft: {
				...draft,
				id: "evil",
				coverImageUrl: "evil.png",
				body: "<p>改写后更丰富的正文</p>",
			},
		});
		const onApply = vi.fn();
		render(<DraftReviewPanel draft={draft} onApply={onApply} />);
		fireEvent.click(screen.getByText("AI 评审"));
		fireEvent.click(await screen.findByText(/改写未达标维度/));
		fireEvent.click(await screen.findByText("采纳"));
		expect(onApply).toHaveBeenCalledOnce();
		const applied = onApply.mock.calls[0]?.[0] as ContentDraft;
		expect(applied.body).toContain("改写后更丰富的正文");
		expect(applied.id).toBe("d1");
		expect(applied.coverImageUrl).toBe("cover.png");
	});

	it("放弃 → 不应用改写", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: {
				ok: false,
				dimensions: [{ name: "body_richness", pass: false }],
			},
		});
		mockRewrite.mockResolvedValue({ ok: true, draft: { ...draft, body: "x" } });
		const onApply = vi.fn();
		render(<DraftReviewPanel draft={draft} onApply={onApply} />);
		fireEvent.click(screen.getByText("AI 评审"));
		fireEvent.click(await screen.findByText(/改写未达标维度/));
		fireEvent.click(await screen.findByText("放弃"));
		expect(onApply).not.toHaveBeenCalled();
	});

	it("评审失败 → 显示错误,不渲染维度/改写按钮", async () => {
		mockReview.mockResolvedValue({
			ok: false,
			kind: "network",
			error: "无法连接到后端服务。",
		});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		expect(await screen.findByText("无法连接到后端服务。")).toBeTruthy();
		expect(screen.queryByText(/改写未达标维度/)).toBeNull();
	});

	it("全维度通过 → 提示无需改写,无改写按钮", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: { ok: true, dimensions: [{ name: "body_richness", pass: true }] },
		});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		expect(await screen.findByText(/全部维度通过/)).toBeTruthy();
		expect(screen.queryByText(/改写未达标维度/)).toBeNull();
	});

	it("评审失败 → 错误节点带 role='alert' 且含消息", async () => {
		mockReview.mockResolvedValue({
			ok: false,
			kind: "network",
			error: "无法连接到后端服务。",
		});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("无法连接到后端服务。");
	});

	it("改写失败 → 错误节点带 role='alert' 且 phase 回到 reviewed", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: {
				ok: false,
				dimensions: [{ name: "body_richness", pass: false }],
			},
		});
		mockRewrite.mockResolvedValue({
			ok: false,
			kind: "network",
			error: "改写请求失败。",
		});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		fireEvent.click(await screen.findByText(/改写未达标维度/));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("改写请求失败。");
		// phase 回到 reviewed:改写按钮仍在(reviewed 才渲染)。
		expect(screen.getByText(/改写未达标维度/)).toBeTruthy();
	});

	it("评审失败后点重试 → 重新调用 reviewDraft 并清除旧错误", async () => {
		mockReview
			.mockResolvedValueOnce({
				ok: false,
				kind: "network",
				error: "无法连接到后端服务。",
			})
			.mockResolvedValueOnce({
				ok: true,
				result: { ok: true, dimensions: [] },
			});
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		await screen.findByText("无法连接到后端服务。");
		fireEvent.click(screen.getByText("重试"));
		await screen.findByText(/全部维度通过/);
		expect(mockReview).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("无法连接到后端服务。")).toBeNull();
	});

	it("改写失败后点重试 → 用相同 failedDims 重新调用 rewriteDraft", async () => {
		mockReview.mockResolvedValue({
			ok: true,
			result: {
				ok: false,
				dimensions: [{ name: "body_richness", pass: false }],
			},
		});
		mockRewrite
			.mockResolvedValueOnce({
				ok: false,
				kind: "network",
				error: "改写请求失败。",
			})
			.mockResolvedValueOnce({ ok: true, draft: { ...draft, body: "重写后" } });
		render(<DraftReviewPanel draft={draft} onApply={vi.fn()} />);
		fireEvent.click(screen.getByText("AI 评审"));
		fireEvent.click(await screen.findByText(/改写未达标维度/));
		await screen.findByText("改写请求失败。");
		fireEvent.click(screen.getByText("重试"));
		await screen.findByText("重写后");
		expect(mockRewrite).toHaveBeenCalledTimes(2);
		expect(mockRewrite).toHaveBeenLastCalledWith(
			draft,
			["body_richness"],
			expect.anything(),
		);
	});
});
