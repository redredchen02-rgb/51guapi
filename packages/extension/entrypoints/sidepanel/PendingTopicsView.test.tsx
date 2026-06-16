// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import type { PendingTopic } from "../../lib/pending-client";
import { PendingTopicsView } from "./PendingTopicsView";

// ---- mocks ----

vi.mock("../../lib/pending-client", () => ({
	fetchPendingTopics: vi.fn(async () => []),
	updatePendingStatus: vi.fn(async () => true),
	patchPendingTopic: vi.fn(async () => true),
	triggerScrape: vi.fn(async () => true),
	fetchAdapters: vi.fn(async () => []),
}));

vi.mock("../../lib/messaging", () => ({
	runBatch: vi.fn(async () => null),
}));

import {
	fetchAdapters,
	fetchPendingTopics,
	patchPendingTopic,
	triggerScrape,
	updatePendingStatus,
} from "../../lib/pending-client";

function makeTopic(
	id: string,
	overrides: Partial<PendingTopic> = {},
): PendingTopic {
	return {
		id,
		sourceUrl: `https://example.com/${id}`,
		siteName: "test-site",
		title: `选题 ${id}`,
		facts: {
			作品名: "测试作品",
			集数: "01",
			制作: "",
			漢化: "",
			無修: "",
			题材: "",
			简介: "",
		},
		confidence: 0.9,
		status: "pending",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

beforeEach(async () => {
	fakeBrowser.reset();
	// Create a fake active tab so browser.tabs.query returns a tab with an id.
	await fakeBrowser.tabs.create({ url: "https://example.com", active: true });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// ================================================================
// R1 — Inline fact editing
// ================================================================

describe("R1 — inline fact editing", () => {
	it("展开选题后渲染事实输入框", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([makeTopic("t1")]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("详情"));
		expect(screen.getByDisplayValue("测试作品")).toBeTruthy();
	});

	it("编辑「作品名」后值更新(折叠再展开保留编辑)", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([makeTopic("t1")]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		fireEvent.click(screen.getByText("详情"));
		const input = screen.getByDisplayValue("测试作品") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "新作品名" } });
		expect(input.value).toBe("新作品名");

		// 折叠再展开 → 编辑保留
		fireEvent.click(screen.getByText("收起"));
		fireEvent.click(screen.getByText("详情"));
		expect(screen.getByDisplayValue("新作品名")).toBeTruthy();
	});

	it("展开后批准 → PATCH 调用 facts，后跟 updatePendingStatus 和 runBatch", async () => {
		const topic = makeTopic("t1");
		vi.mocked(fetchPendingTopics).mockResolvedValue([topic]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		// 先展开 → initLocalFacts
		fireEvent.click(screen.getByText("详情"));
		await waitFor(() => screen.getByDisplayValue("测试作品"));

		// 再勾选
		fireEvent.click(screen.getByRole("checkbox"));
		await waitFor(() => screen.getByText(/批准 \(1\)/));

		fireEvent.click(screen.getByText(/批准/));
		await waitFor(() => {
			expect(patchPendingTopic).toHaveBeenCalledWith(
				"t1",
				expect.objectContaining({ facts: expect.any(Object) }),
			);
			expect(updatePendingStatus).toHaveBeenCalledWith("t1", "approved");
		});
	});

	it("编辑 facts 后批准 → PATCH 含更新后的值", async () => {
		const topic = makeTopic("t1");
		vi.mocked(fetchPendingTopics).mockResolvedValue([topic]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		// 展开并编辑
		fireEvent.click(screen.getByText("详情"));
		await waitFor(() => screen.getByDisplayValue("测试作品"));
		fireEvent.change(screen.getByDisplayValue("测试作品"), {
			target: { value: "改后作品名" },
		});
		await waitFor(() => screen.getByDisplayValue("改后作品名"));

		// 勾选
		fireEvent.click(screen.getByRole("checkbox"));
		await waitFor(() => screen.getByText(/批准 \(1\)/));

		fireEvent.click(screen.getByText(/批准/));
		await waitFor(() => {
			expect(patchPendingTopic).toHaveBeenCalledWith(
				"t1",
				expect.objectContaining({
					facts: expect.objectContaining({ 作品名: "改后作品名" }),
				}),
			);
		});
	});
});

// ================================================================
// R2 — Cover thumbnail
// ================================================================

describe("R2 — cover thumbnail", () => {
	it("有 coverImageUrl 时展开后显示 img", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([
			makeTopic("t1", { coverImageUrl: "http://img.example.com/cover.jpg" }),
		]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("详情"));
		const img = document.querySelector(
			'img[alt="封面"]',
		) as HTMLImageElement | null;
		expect(img).not.toBeNull();
		expect(img?.src).toContain("cover.jpg");
	});

	it("无 coverImageUrl 时不渲染 img", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([makeTopic("t1")]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("详情"));
		expect(document.querySelector('img[alt="封面"]')).toBeNull();
	});
});

// ================================================================
// R3 — Trigger button
// ================================================================

describe("R3 — scraper trigger button", () => {
	it("有适配器时点击触发按钮调用 triggerScrape", async () => {
		vi.mocked(fetchAdapters).mockResolvedValue(["test-adapter"]);
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onBatchStarted={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());
		fireEvent.click(screen.getByText("⚡ 立即抓取"));
		// 点击→triggerScrape 为异步:适配器状态落定前同步断言会偶发「0 调用」,故包进 waitFor。
		await waitFor(() =>
			expect(triggerScrape).toHaveBeenCalledWith("test-adapter"),
		);
	});
});
