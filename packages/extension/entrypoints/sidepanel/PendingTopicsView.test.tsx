// @vitest-environment jsdom

import type { GenerateDraftResponse } from "@51guapi/shared";
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
	requestGenerate: vi.fn(async () => ({
		ok: true,
		draft: { title: "", body: "", tags: [] },
	})),
}));

vi.mock("../../lib/export", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../lib/export")>();
	return { ...actual, downloadFile: vi.fn() };
});

import { downloadFile } from "../../lib/export";
import { requestGenerate } from "../../lib/messaging";

import {
	fetchAdapters,
	fetchPendingTopics,
	patchPendingTopic,
	triggerScrape,
	updatePendingStatus,
} from "../../lib/pending-client";

// 完整 GenerateDraftResponse(satisfies 守门防缺字段);内容对所有用例无关,
// 仅满足 useDraftGeneration hook 透传的类型契约(R5 只断言调用次数 + onDraftReady)。
function makeGenerateResponse(): GenerateDraftResponse {
	return {
		ok: true,
		draft: {
			id: "draft-1",
			title: "",
			subtitle: "",
			category: "",
			coverImageUrl: "",
			body: "",
			tags: [],
			description: "",
			status: "draft",
			createdAt: "2026-01-01T00:00:00.000Z",
		},
	} satisfies GenerateDraftResponse;
}

function makeTopic(
	id: string,
	overrides: Partial<PendingTopic> = {},
): PendingTopic {
	// satisfies PendingTopic 防缺字段(mock 队列泄漏教训配套)。
	return {
		id,
		sourceUrl: `https://example.com/${id}`,
		siteName: "test-site",
		title: `选题 ${id}`,
		facts: {
			當事人: "测试人物",
			事件摘要: "测试摘要",
			起因: "",
			經過: "",
			結果: "",
			來源連結: "",
			發生時間: "",
			熱度標籤: "",
		},
		confidence: 0.9,
		status: "pending",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} satisfies PendingTopic;
}

beforeEach(async () => {
	// resetAllMocks 排空 *Once FIFO 队列(clearAllMocks 不排空 → 跨用例泄漏:
	// docs/solutions/test-failures/vitest-mock-queue-leak-and-stale-mocks-after-refactor)。
	// 代价:也清掉 vi.mock 工厂里 mock 的实现,故下方重建安全默认值,
	// 让不显式设 mock 的用例(R1/R2/R4)仍拿到原工厂默认。
	vi.resetAllMocks();
	vi.mocked(fetchPendingTopics).mockResolvedValue([]);
	vi.mocked(updatePendingStatus).mockResolvedValue(true);
	vi.mocked(patchPendingTopic).mockResolvedValue(true);
	vi.mocked(triggerScrape).mockResolvedValue(true);
	vi.mocked(fetchAdapters).mockResolvedValue([]);
	vi.mocked(requestGenerate).mockResolvedValue(makeGenerateResponse());

	fakeBrowser.reset();
	// Create a fake active tab so browser.tabs.query returns a tab with an id.
	await fakeBrowser.tabs.create({ url: "https://example.com", active: true });
});

afterEach(() => {
	cleanup();
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
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("详情"));
		expect(screen.getByDisplayValue("测试人物")).toBeTruthy();
	});

	it("编辑「作品名」后值更新(折叠再展开保留编辑)", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([makeTopic("t1")]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		fireEvent.click(screen.getByText("详情"));
		const input = screen.getByDisplayValue("测试人物") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "新人物名" } });
		expect(input.value).toBe("新人物名");

		// 折叠再展开 → 编辑保留
		fireEvent.click(screen.getByText("收起"));
		fireEvent.click(screen.getByText("详情"));
		expect(screen.getByDisplayValue("新人物名")).toBeTruthy();
	});

	it("展开后批准 → PATCH 调用 facts，后跟 requestGenerate 和 updatePendingStatus", async () => {
		const topic = makeTopic("t1");
		vi.mocked(fetchPendingTopics).mockResolvedValue([topic]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		// 先展开 → initLocalFacts
		fireEvent.click(screen.getByText("详情"));
		await waitFor(() => screen.getByDisplayValue("测试人物"));

		// 再勾选
		fireEvent.click(screen.getByRole("checkbox"));
		await waitFor(() => screen.getByText(/批准并生成草稿/));

		fireEvent.click(screen.getByText(/批准并生成草稿/));
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
		const onDraftReady = vi.fn();
		vi.mocked(fetchPendingTopics).mockResolvedValue([topic]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={onDraftReady}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));

		// 展开并编辑
		fireEvent.click(screen.getByText("详情"));
		await waitFor(() => screen.getByDisplayValue("测试人物"));
		fireEvent.change(screen.getByDisplayValue("测试人物"), {
			target: { value: "改后人物名" },
		});
		await waitFor(() => screen.getByDisplayValue("改后人物名"));

		// 勾选
		fireEvent.click(screen.getByRole("checkbox"));
		await waitFor(() => screen.getByText(/批准并生成草稿/));

		fireEvent.click(screen.getByText(/批准并生成草稿/));
		await waitFor(() => {
			expect(patchPendingTopic).toHaveBeenCalledWith(
				"t1",
				expect.objectContaining({
					facts: expect.objectContaining({ 當事人: "改后人物名" }),
				}),
			);
		});
		expect(requestGenerate).toHaveBeenCalledWith(
			expect.stringContaining("改后人物名"),
			expect.objectContaining({
				facts: expect.objectContaining({
					當事人: "改后人物名",
					事件摘要: "测试摘要",
					來源連結: null,
				}),
			}),
		);
		expect(onDraftReady).toHaveBeenCalledWith(
			expect.objectContaining({
				draft: expect.objectContaining({ id: "draft-1" }),
				facts: expect.objectContaining({ 當事人: "改后人物名" }),
			}),
		);
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
				onDraftReady={vi.fn()}
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
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("详情"));
		expect(document.querySelector('img[alt="封面"]')).toBeNull();
	});
});

// ================================================================
// R4 — CSV export button
// ================================================================

describe("R4 — CSV export button", () => {
	it("点「导出 CSV」→ downloadFile 以 text/csv 与正确内容调用", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([makeTopic("t1")]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("选题 t1"));
		fireEvent.click(screen.getByText("导出 CSV"));
		expect(downloadFile).toHaveBeenCalledTimes(1);
		const [filename, content, mime] = vi.mocked(downloadFile).mock.calls[0]!;
		expect(filename).toMatch(/^topics-\d{4}-\d{2}-\d{2}\.csv$/);
		expect(mime).toBe("text/csv");
		expect(content).toContain("id,title,siteName");
		expect(content).toContain("选题 t1");
	});

	it("空列表时导出按钮禁用", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => screen.getByText("暂无待审核选题。"));
		expect((screen.getByText("导出 CSV") as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

// ================================================================
// R3 — Trigger button
// ================================================================

describe("R3 — scraper trigger button", () => {
	it("有适配器时点击触发按钮调用 triggerScrape，完成后状态清空", async () => {
		vi.mocked(fetchAdapters).mockResolvedValue(["test-adapter"]);
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());
		fireEvent.click(screen.getByText("⚡ 立即抓取"));
		await waitFor(() =>
			expect(triggerScrape).toHaveBeenCalledWith("test-adapter"),
		);
		// handleTriggerScrape awaits refresh() before clearing status — deterministic settle
		await waitFor(() => expect(screen.queryByText("抓取中…")).toBeNull());
	});

	it("无适配器时触发按钮禁用", async () => {
		vi.mocked(fetchAdapters).mockResolvedValue([]);
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());
		expect(
			(screen.getByText("⚡ 立即抓取") as HTMLButtonElement).disabled,
		).toBe(true);
	});
});

// ================================================================
// R5 — 今日一键备稿 (QuickDraft)
// ================================================================

describe("R5 — 今日一键备稿", () => {
	it("待审池为空时显示提示，不弹确认面板", async () => {
		vi.mocked(fetchAdapters).mockResolvedValue(["test-adapter"]);
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());

		fireEvent.click(screen.getByText("今日一键备稿"));
		await waitFor(() =>
			expect(screen.getByText(/待审池暂无选题/)).toBeDefined(),
		);
		expect(screen.queryByText(/将为最高分选题/)).toBeNull();
	});

	it("有选题时显示确认面板，取消后面板消失", async () => {
		vi.mocked(fetchAdapters).mockResolvedValue(["test-adapter"]);
		vi.mocked(fetchPendingTopics)
			.mockResolvedValueOnce([]) // initial refresh
			.mockResolvedValueOnce([
				makeTopic("t1"),
				makeTopic("t2"),
				makeTopic("t3"),
			]); // quickDraft fetch
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={vi.fn()}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());

		fireEvent.click(screen.getByText("今日一键备稿"));
		await waitFor(() =>
			expect(screen.getByText(/将为最高分选题/)).toBeDefined(),
		);
		// 显示第一条题目
		expect(screen.getByText("选题 t1")).toBeDefined();

		fireEvent.click(screen.getByText("取消"));
		await waitFor(() =>
			expect(screen.queryByText(/将为最高分选题/)).toBeNull(),
		);
	});

	it("确认生成 → 调 requestGenerate 并触发 onDraftReady", async () => {
		const onDraftReady = vi.fn();
		vi.mocked(fetchAdapters).mockResolvedValue(["test-adapter"]);
		vi.mocked(fetchPendingTopics)
			.mockResolvedValueOnce([]) // initial refresh
			.mockResolvedValueOnce([makeTopic("t1")]); // quickDraft fetch
		render(
			<PendingTopicsView
				onBack={vi.fn()}
				onDraftReady={onDraftReady}
				onError={vi.fn()}
			/>,
		);
		await waitFor(() => expect(fetchAdapters).toHaveBeenCalled());

		fireEvent.click(screen.getByText("今日一键备稿"));
		await waitFor(() =>
			expect(screen.getByText(/将为最高分选题/)).toBeDefined(),
		);

		fireEvent.click(screen.getByText("确认生成"));
		await waitFor(() =>
			expect(vi.mocked(requestGenerate)).toHaveBeenCalledTimes(1),
		);
		expect(requestGenerate).toHaveBeenCalledWith(
			expect.stringContaining("测试人物"),
			expect.objectContaining({
				facts: expect.objectContaining({
					當事人: "测试人物",
					事件摘要: "测试摘要",
				}),
			}),
		);
		await waitFor(() =>
			expect(onDraftReady).toHaveBeenCalledWith(
				expect.objectContaining({
					draft: expect.objectContaining({ id: "draft-1" }),
					facts: expect.objectContaining({ 當事人: "测试人物" }),
				}),
			),
		);
	});
});
