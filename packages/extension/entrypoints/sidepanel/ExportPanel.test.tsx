// @vitest-environment jsdom
import type { ContentDraft } from "@51guapi/shared";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/export", () => ({
	exportDraftAsJSON: vi.fn(() => '{"json":true}'),
	exportDraftAsMarkdown: vi.fn(() => "# md"),
	copyToClipboard: vi.fn(async () => {}),
	downloadFile: vi.fn(),
	safeFilename: vi.fn((_d: ContentDraft, ext: string) => `file.${ext}`),
}));

import {
	copyToClipboard,
	downloadFile,
	exportDraftAsMarkdown,
} from "../../lib/export";
import { ExportPanel } from "./ExportPanel.js";

const mockDownload = vi.mocked(downloadFile);
const mockCopy = vi.mocked(copyToClipboard);
const mockMd = vi.mocked(exportDraftAsMarkdown);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function makeDraft(): ContentDraft {
	return {
		id: "d1",
		title: "标题",
		subtitle: "",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文</p>",
		tags: [],
		description: "",
		status: "draft",
		createdAt: "2026-06-15T00:00:00Z",
	} as ContentDraft;
}

describe("ExportPanel", () => {
	it("点「导出 Markdown」→ downloadFile 被调且内容/mime 正确", () => {
		render(<ExportPanel draft={makeDraft()} />);
		fireEvent.click(screen.getByText("导出 Markdown"));
		expect(mockDownload).toHaveBeenCalledWith(
			"file.md",
			"# md",
			"text/markdown",
		);
	});

	it("点「导出 JSON」→ downloadFile 被调", () => {
		render(<ExportPanel draft={makeDraft()} />);
		fireEvent.click(screen.getByText("导出 JSON"));
		expect(mockDownload).toHaveBeenCalledWith(
			"file.json",
			'{"json":true}',
			"application/json",
		);
	});

	it("点「复制」→ 写入剪贴板内容与 Markdown 一致", async () => {
		render(<ExportPanel draft={makeDraft()} />);
		fireEvent.click(screen.getByText("复制"));
		await waitFor(() => expect(mockCopy).toHaveBeenCalledWith("# md"));
		expect(mockMd).toHaveBeenCalled();
		expect(await screen.findByText("已复制到剪贴板")).toBeTruthy();
	});
});
