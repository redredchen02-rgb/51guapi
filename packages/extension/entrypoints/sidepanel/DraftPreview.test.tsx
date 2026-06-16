// @vitest-environment jsdom
import type { ContentDraft } from "@51guapi/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftPreview } from "./DraftPreview.js";

afterEach(() => cleanup());

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "d1",
		title: "标题",
		subtitle: "副标题",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文</p>",
		tags: ["标签A", "标签B"],
		description: "描述",
		postStatus: "1",
		publishedAt: "2026-06-15",
		mediaId: "m1",
		status: "draft",
		createdAt: "2026-06-15T00:00:00Z",
		...overrides,
	} as ContentDraft;
}

describe("DraftPreview", () => {
	it("渲染各字段当前值（含 tags 逗号拼接）", () => {
		render(<DraftPreview draft={makeDraft()} onChange={vi.fn()} />);
		expect(screen.getByDisplayValue("标题")).toBeTruthy();
		expect(screen.getByDisplayValue("副标题")).toBeTruthy();
		// tags 数组以 ", " 拼接展示
		expect(screen.getByDisplayValue("标签A, 标签B")).toBeTruthy();
	});

	it("编辑标题 → onChange 收到合并后的 draft", () => {
		const onChange = vi.fn();
		render(<DraftPreview draft={makeDraft()} onChange={onChange} />);
		fireEvent.change(screen.getByDisplayValue("标题"), {
			target: { value: "新标题" },
		});
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ title: "新标题", subtitle: "副标题" }),
		);
	});

	it("编辑标签 → 字符串被拆分/去空白/过滤空项为数组", () => {
		const onChange = vi.fn();
		render(<DraftPreview draft={makeDraft()} onChange={onChange} />);
		fireEvent.change(screen.getByDisplayValue("标签A, 标签B"), {
			target: { value: " x , y ,, z " },
		});
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ tags: ["x", "y", "z"] }),
		);
	});

	it("postStatus 输入 '1' → 归一为 '1'，其它 → '0'", () => {
		const onChange = vi.fn();
		render(
			<DraftPreview
				draft={makeDraft({ postStatus: "0" })}
				onChange={onChange}
			/>,
		);
		const statusInput = screen.getByDisplayValue("0");
		fireEvent.change(statusInput, { target: { value: "1" } });
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ postStatus: "1" }),
		);
		fireEvent.change(statusInput, { target: { value: "9" } });
		expect(onChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ postStatus: "0" }),
		);
	});

	it("coverImageUrl 有值 → 渲染封面预览 img", () => {
		render(
			<DraftPreview
				draft={makeDraft({ coverImageUrl: "https://cdn.example.com/c.jpg" })}
				onChange={vi.fn()}
			/>,
		);
		const img = screen.getByAltText("封面预览") as HTMLImageElement;
		expect(img.src).toContain("https://cdn.example.com/c.jpg");
	});

	it("coverImageUrl 为空 → 不渲染封面预览", () => {
		render(
			<DraftPreview
				draft={makeDraft({ coverImageUrl: "" })}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.queryByAltText("封面预览")).toBeNull();
	});

	it("编辑正文 textarea → onChange 收到新 body", () => {
		const onChange = vi.fn();
		render(<DraftPreview draft={makeDraft()} onChange={onChange} />);
		fireEvent.change(screen.getByDisplayValue("<p>正文</p>"), {
			target: { value: "<p>改后</p>" },
		});
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ body: "<p>改后</p>" }),
		);
	});
});
