// @vitest-environment jsdom
import type { ContentDraft } from "@51guapi/shared";
import {
	act,
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

	it("2s 窗口内卸载 + advanceTimers → 无 unmount 后 setState 警告", () => {
		vi.useFakeTimers();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const { unmount } = render(<ExportPanel draft={makeDraft()} />);
			fireEvent.click(screen.getByText("导出 JSON"));
			expect(screen.getByText("已导出 JSON")).toBeTruthy();
			unmount();
			act(() => {
				vi.advanceTimersByTime(2000);
			});
			// timer 已在 cleanup 中清除:卸载后推进时钟既不报 unmount 后 setState
			// 警告,也不产生任何 console.error
			const warned = errSpy.mock.calls.some((args) =>
				String(args[0]).includes("unmounted component"),
			);
			expect(warned).toBe(false);
			expect(errSpy).not.toHaveBeenCalled();
		} finally {
			errSpy.mockRestore();
			vi.useRealTimers();
		}
	});

	it("快速重 flash → 旧 timer 被清,新提示在旧倒计时到点后仍在", () => {
		vi.useFakeTimers();
		try {
			render(<ExportPanel draft={makeDraft()} />);
			fireEvent.click(screen.getByText("导出 JSON"));
			expect(screen.getByText("已导出 JSON")).toBeTruthy();
			act(() => {
				vi.advanceTimersByTime(1000);
			});
			fireEvent.click(screen.getByText("导出 Markdown"));
			// 旧 timer 已被清:再走到旧 timer 的 2000ms 点,新提示不应被清空
			act(() => {
				vi.advanceTimersByTime(1000);
			});
			expect(screen.getByText("已导出 Markdown")).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	});

	it("正常 hint 生命周期:显示后在 2000ms 消失", () => {
		vi.useFakeTimers();
		try {
			render(<ExportPanel draft={makeDraft()} />);
			fireEvent.click(screen.getByText("导出 JSON"));
			expect(screen.getByText("已导出 JSON")).toBeTruthy();
			act(() => {
				vi.advanceTimersByTime(2000);
			});
			expect(screen.queryByText("已导出 JSON")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
