// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingTopic } from "../../../lib/pending-client";
import { FactsEditorModal } from "./FactsEditorModal";

// 内联 topic mock 用 satisfies PendingTopic 防缺字段(mock 队列泄漏教训:
// docs/solutions/test-failures/vitest-mock-queue-leak-and-stale-mocks-after-refactor)。
function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
	return {
		id: "t1",
		sourceUrl: "https://example.com/t1",
		siteName: "test-site",
		title: "选题 t1",
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

interface Overrides {
	topic?: PendingTopic;
	editedFacts?: Record<string, string> | undefined;
	busy?: boolean;
	onVerify?: () => void;
	verifying?: boolean;
}

function setup(overrides: Overrides = {}) {
	const onFactChange = vi.fn();
	render(
		<FactsEditorModal
			topic={overrides.topic ?? makeTopic()}
			editedFacts={overrides.editedFacts}
			busy={overrides.busy ?? false}
			onFactChange={onFactChange}
			onVerify={overrides.onVerify}
			verifying={overrides.verifying}
		/>,
	);
	return { onFactChange };
}

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("FactsEditorModal (事实往返编辑 — 净增覆盖)", () => {
	it("editedFacts 未定义时 → 字段回落 topic.facts 原值", () => {
		setup();
		expect(screen.getByDisplayValue("测试人物")).toBeTruthy();
		expect(screen.getByDisplayValue("测试摘要")).toBeTruthy();
	});

	it("editedFacts 提供时 → 优先显示编辑后的值(覆盖 topic.facts)", () => {
		setup({ editedFacts: { 當事人: "改后人物名" } });
		expect(screen.getByDisplayValue("改后人物名")).toBeTruthy();
		// 未编辑的字段仍回落 topic.facts
		expect(screen.getByDisplayValue("测试摘要")).toBeTruthy();
	});

	it("修改字段 → 以 (key, value) 上抛 onFactChange", () => {
		const { onFactChange } = setup();
		fireEvent.change(screen.getByDisplayValue("测试人物"), {
			target: { value: "新人物名" },
		});
		expect(onFactChange).toHaveBeenCalledWith("當事人", "新人物名");
	});

	it("空字段渲染为空输入框(rawVal '' → '')", () => {
		setup();
		// 起因/經過 等空字段:输入框 value=""(无 displayValue 可断 ⚠ 标记)
		const inputs = document.querySelectorAll(
			"input.field-input",
		) as NodeListOf<HTMLInputElement>;
		// 8 个 GOSSIP_FACT_KEYS → 8 个输入框
		expect(inputs.length).toBe(8);
		const emptyCount = Array.from(inputs).filter((i) => i.value === "").length;
		expect(emptyCount).toBe(6);
	});

	it("空字段显示「待补充」⚠ 标记", () => {
		setup();
		// 6 个空字段 → 6 个 ⚠
		const warns = screen.getAllByTitle("待补充");
		expect(warns.length).toBe(6);
	});

	it("U4：未溯源字段显示 ⛔ 标记", () => {
		const topic = makeTopic({
			verification: {
				grounding: {
					perField: { 當事人: false },
					unsourced: ["當事人"],
					ok: false,
				},
				validity: { ok: true, hardFail: false, qualityRatio: 1, reasons: [] },
				freshness: { ok: true, unknown: false, ageDays: 1 },
				fingerprint: "x",
				decision: "flag",
				reasons: [],
			},
		});
		setup({ topic });
		expect(screen.getByTitle(/未溯源/)).toBeTruthy();
	});

	it("U4：未核对 → 显示「确认核对」按钮，点击调 onVerify", () => {
		const onVerify = vi.fn();
		setup({ onVerify });
		const btn = screen.getByText(/确认核对/);
		fireEvent.click(btn);
		expect(onVerify).toHaveBeenCalledTimes(1);
	});

	it("U4：已核对(verifiedAt) → 显示已核对、无按钮", () => {
		const onVerify = vi.fn();
		setup({
			topic: makeTopic({ verifiedAt: "2026-06-18T00:00:00.000Z" }),
			onVerify,
		});
		expect(screen.getByText(/已核对/)).toBeTruthy();
		expect(screen.queryByText(/确认核对/)).toBeNull();
	});

	it("confidence != null → 显示置信度百分比", () => {
		setup({ topic: makeTopic({ confidence: 0.75 }) });
		expect(screen.getByText("置信度 75%")).toBeTruthy();
	});

	it("有 extractionMode → 与置信度一起显示", () => {
		setup({
			topic: makeTopic({ confidence: 0.6, extractionMode: "fallback" }),
		});
		expect(screen.getByText("置信度 60% · fallback")).toBeTruthy();
	});

	it("有 coverImageUrl → 渲染封面 img", () => {
		setup({
			topic: makeTopic({ coverImageUrl: "http://img.example.com/cover.jpg" }),
		});
		const img = document.querySelector(
			'img[alt="封面"]',
		) as HTMLImageElement | null;
		expect(img).not.toBeNull();
		expect(img?.src).toContain("cover.jpg");
	});

	it("无 coverImageUrl → 不渲染 img", () => {
		setup();
		expect(document.querySelector('img[alt="封面"]')).toBeNull();
	});

	it("有 rawContent.body → 显示原始内容前300字", () => {
		const body = "x".repeat(400);
		setup({
			topic: makeTopic({
				rawContent: { title: "t", body, url: "https://example.com/t1" },
			}),
		});
		expect(screen.getByText(/原始内容/)).toBeTruthy();
		// 截断到 300 字 + 省略号
		expect(screen.getByText(`${"x".repeat(300)}…`)).toBeTruthy();
	});

	it("busy=true → 字段输入框禁用", () => {
		setup({ busy: true });
		const input = screen.getByDisplayValue("测试人物") as HTMLInputElement;
		expect(input.disabled).toBe(true);
	});
});
