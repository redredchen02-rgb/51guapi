// @vitest-environment jsdom

import type { ContentDraft, GenerateDraftResponse } from "@51guapi/shared";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock messaging.requestGenerate(hook 唯一外部依赖)
vi.mock("../../../lib/messaging", () => ({
	requestGenerate: vi.fn(),
}));

import { requestGenerate } from "../../../lib/messaging";
import { useDraftGeneration } from "./useDraftGeneration";

const draft: ContentDraft = {
	id: "d1",
	title: "T",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "B",
	tags: [],
	description: "",
	status: "draft",
	createdAt: "2026-06-03T00:00:00.000Z",
};

beforeEach(() => {
	vi.resetAllMocks();
});

afterEach(cleanup);

describe("useDraftGeneration", () => {
	it("成功响应 → status ok,携带 draft", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: true,
			draft,
		} satisfies GenerateDraftResponse);
		const { result } = renderHook(() => useDraftGeneration());
		const out = await result.current.generate("prompt");
		expect(out).toEqual({ status: "ok", draft });
	});

	it("no-key 失败 → status no-key,携带 error", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: false,
			kind: "no-key",
			error: "请先配置 key",
		} satisfies GenerateDraftResponse);
		const { result } = renderHook(() => useDraftGeneration());
		const out = await result.current.generate("p");
		expect(out).toEqual({ status: "no-key", error: "请先配置 key" });
	});

	it("非 no-key 失败 → status error,携带 error", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: false,
			kind: "network",
			error: "网络错误",
		} satisfies GenerateDraftResponse);
		const { result } = renderHook(() => useDraftGeneration());
		const out = await result.current.generate("p");
		expect(out).toEqual({ status: "error", error: "网络错误" });
	});

	it("无 kind 的失败也归为 error", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: false,
			error: "未知",
		} satisfies GenerateDraftResponse);
		const { result } = renderHook(() => useDraftGeneration());
		const out = await result.current.generate("p");
		expect(out).toEqual({ status: "error", error: "未知" });
	});

	it("requestGenerate 抛错 → status exception,透传原始 error(不替调用方决定文案)", async () => {
		const thrown = new Error("SW 已回收");
		vi.mocked(requestGenerate).mockRejectedValue(thrown);
		const { result } = renderHook(() => useDraftGeneration());
		const out = await result.current.generate("p");
		expect(out).toEqual({ status: "exception", error: thrown });
	});
});
