// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveFewShotExamples } from "../../lib/storage";
import { parseTagsText, Settings } from "./Settings";

// Settings 组件测试 — mock hook 层以隔离 UI 行为
const mockSave = vi.fn();
const mockLoad = vi.fn();

vi.mock("./hooks/useSettingsForm", () => ({
	useSettingsForm: () => ({
		formValues: {
			endpoint: "https://api.example.com",
			model: "gpt-4",
			promptTemplate: "",
			fewShotPairs: [],
			tagsText: "",
			fallbackModel: "",
			recommendedTags: [],
			backendUrl: "http://localhost:3002",
			reviewCriteriaPrompt: "",
		},
		setFormValue: vi.fn(),
		getBackendToken: vi.fn(),
		setBackendToken: vi.fn(),
		derivedFewShotExamples: "",
		prompts: [],
		promptStatus: "",
		loadPrompts: vi.fn(),
		selectPrompt: vi.fn(),
		savePromptToBackend: vi.fn(),
		testConnectionFn: vi.fn(),
		load: mockLoad,
		save: mockSave,
	}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("Settings UI — handleSave", () => {
	it("save() 返回错误字串 → 显示 role=alert 错误信息", async () => {
		mockSave.mockResolvedValue("endpoint 必须是 https:// 地址");
		render(<Settings onClose={vi.fn()} />);
		fireEvent.click(screen.getByText("保存"));
		await waitFor(() => {
			const alert = screen.getByRole("alert");
			expect(alert.textContent).toContain("endpoint 必须是 https://");
		});
	});

	it("二次保存时 [已保存] 先消失再出现（saved 重置）", async () => {
		mockSave.mockResolvedValue(null);
		render(<Settings onClose={vi.fn()} />);
		// 第一次保存 → 显示"已保存。"
		fireEvent.click(screen.getByText("保存"));
		await waitFor(() => expect(screen.getByText("已保存。")).toBeTruthy());
		// 第二次保存 → 期间"已保存。"消失再现
		mockSave.mockResolvedValue(null);
		fireEvent.click(screen.getByText("保存"));
		// 点击瞬间 saved 被重置，"已保存。"应消失
		expect(screen.queryByText("已保存。")).toBeNull();
		// 等待再次显示
		await waitFor(() => expect(screen.getByText("已保存。")).toBeTruthy());
	});

	it("不再展示扩展端 API Key 输入框", () => {
		render(<Settings onClose={vi.fn()} />);

		expect(screen.queryByLabelText("API Key")).toBeNull();
		expect(screen.getByText(/扩展不会保存或发送 LLM 密钥/)).toBeTruthy();
	});
});

describe("parseTagsText", () => {
	it("换行分隔 → 标签数组", () => {
		expect(parseTagsText("漢化\n無修正")).toEqual(["漢化", "無修正"]);
	});

	it("逗号分隔并自动 trim → 标签数组", () => {
		expect(parseTagsText("漢化, 無修正")).toEqual(["漢化", "無修正"]);
	});

	it("空文本 → 空数组（不含空字符串）", () => {
		expect(parseTagsText("")).toEqual([]);
	});

	it("多空行 → 过滤空项", () => {
		expect(parseTagsText("漢化\n\n無修正\n")).toEqual(["漢化", "無修正"]);
	});

	it("settings.recommendedTags join 后能完整还原", () => {
		const tags = ["漢化", "無修正", "校園"];
		expect(parseTagsText(tags.join("\n"))).toEqual(tags);
	});
});

describe("deriveFewShotExamples", () => {
	it("空列表 → 空字符串", () => {
		expect(deriveFewShotExamples([])).toBe("");
	});

	it("单条 → input\\n---\\noutput", () => {
		expect(deriveFewShotExamples([{ input: "Q1", output: "A1" }])).toBe(
			"Q1\n---\nA1",
		);
	});

	it("多条 → 条间 \\n\\n 分隔", () => {
		const result = deriveFewShotExamples([
			{ input: "Q1", output: "A1" },
			{ input: "Q2", output: "A2" },
		]);
		expect(result).toBe("Q1\n---\nA1\n\nQ2\n---\nA2");
	});

	it("input/output 含换行 → 保留原样", () => {
		const result = deriveFewShotExamples([
			{ input: "line1\nline2", output: "out" },
		]);
		expect(result).toBe("line1\nline2\n---\nout");
	});
});
