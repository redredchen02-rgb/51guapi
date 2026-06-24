// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch } from "../../../lib/__test-utils__/mock-fetch";
import { QuickFetchPanel } from "./QuickFetchPanel";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// tabs.query 注入工厂
function makeTabsQuery(url: string | undefined) {
	return (_info: { active: boolean; currentWindow: boolean }) =>
		Promise.resolve(url ? [{ url }] : []);
}

function renderPanel(
	overrides: {
		fetchFn?: typeof fetch;
		tabsQueryFn?: Parameters<typeof QuickFetchPanel>[0]["tabsQueryFn"];
		onTopicAdded?: () => void;
	} = {},
) {
	const onTopicAdded = overrides.onTopicAdded ?? vi.fn();
	render(
		<QuickFetchPanel
			onTopicAdded={onTopicAdded}
			fetchFn={overrides.fetchFn}
			tabsQueryFn={overrides.tabsQueryFn}
		/>,
	);
	return { onTopicAdded };
}

describe("QuickFetchPanel — 手动 URL 抓取", () => {
	it("Happy: 填入有效 URL 点「🔗 抓取」→ fetchGossipTopicFromUrl 调用成功 → onTopicAdded 触发", async () => {
		const { fn } = mockFetch({ ok: true, topic: { id: "t1", title: "标题" } });
		const { onTopicAdded } = renderPanel({ fetchFn: fn });

		fireEvent.change(screen.getByPlaceholderText(/粘贴 URL/), {
			target: { value: "https://example.com/article/1" },
		});
		fireEvent.click(screen.getByText("🔗 抓取"));

		await waitFor(() => expect(onTopicAdded).toHaveBeenCalledTimes(1));
		expect(screen.queryByText(/只支持|格式无效|域名/)).toBeNull();
	});

	it("Error: 输入非 http/https URL → 客户端拦截，显示格式提示", async () => {
		renderPanel();
		fireEvent.change(screen.getByPlaceholderText(/粘贴 URL/), {
			target: { value: "ftp://example.com" },
		});
		fireEvent.click(screen.getByText("🔗 抓取"));

		await waitFor(() =>
			expect(screen.getByText(/只支持 http\/https 链接/)).toBeDefined(),
		);
	});

	it("Error: 后端返 502 + not in allowlist → 显示「渠道白名单」提示", async () => {
		const { fn } = mockFetch(
			{ error: "Failed to fetch URL: Host not in allowlist (hop 0): evil.com" },
			502,
		);
		renderPanel({ fetchFn: fn });

		fireEvent.change(screen.getByPlaceholderText(/粘贴 URL/), {
			target: { value: "https://evil.com/article" },
		});
		fireEvent.click(screen.getByText("🔗 抓取"));

		await waitFor(() => expect(screen.getByText(/渠道白名单/)).toBeDefined());
	});

	it("Error: 后端返其他错误 → 原样显示错误消息", async () => {
		const { fn } = mockFetch({ error: "抓取失败：超时" }, 502);
		renderPanel({ fetchFn: fn });

		fireEvent.change(screen.getByPlaceholderText(/粘贴 URL/), {
			target: { value: "https://example.com/article" },
		});
		fireEvent.click(screen.getByText("🔗 抓取"));

		await waitFor(() =>
			expect(screen.getByText("抓取失败：超时")).toBeDefined(),
		);
	});

	it("Edge: 409 重复 URL → 视为成功，触发 onTopicAdded", async () => {
		const { fn } = mockFetch({ error: "duplicate" }, 409);
		const { onTopicAdded } = renderPanel({ fetchFn: fn });

		fireEvent.change(screen.getByPlaceholderText(/粘贴 URL/), {
			target: { value: "https://example.com/article" },
		});
		fireEvent.click(screen.getByText("🔗 抓取"));

		await waitFor(() => expect(onTopicAdded).toHaveBeenCalledTimes(1));
	});

	it("Edge: URL 输入框为空 → 「🔗 抓取」按钮禁用", () => {
		renderPanel();
		const manualBtn = screen.getByText("🔗 抓取") as HTMLButtonElement;
		expect(manualBtn.disabled).toBe(true);
	});
});

describe("QuickFetchPanel — 抓取当前页面", () => {
	it("Happy: 当前 tab 为 https URL → 抓取成功 → onTopicAdded 触发", async () => {
		const { fn } = mockFetch({ ok: true, topic: { id: "t2", title: "标题2" } });
		const { onTopicAdded } = renderPanel({
			fetchFn: fn,
			tabsQueryFn: makeTabsQuery("https://gossip-site.com/news/99"),
		});

		fireEvent.click(screen.getByText("📋 抓取当前页面"));

		await waitFor(() => expect(onTopicAdded).toHaveBeenCalledTimes(1));
	});

	it("Error: 当前 tab URL 为 null（chrome://）→ 显示「不是有效网页」提示", async () => {
		renderPanel({
			tabsQueryFn: makeTabsQuery("chrome://newtab/"),
		});

		fireEvent.click(screen.getByText("📋 抓取当前页面"));

		await waitFor(() => expect(screen.getByText(/不是有效网页/)).toBeDefined());
	});

	it("Edge: busy 中再次点击「📋 抓取当前页面」→ 按钮禁用，无二次触发", async () => {
		// 模拟慢速响应
		let resolveReq!: () => void;
		const slowFn = (() =>
			new Promise<Response>((res) => {
				resolveReq = () =>
					res(
						new Response(
							JSON.stringify({ ok: true, topic: { id: "t3", title: "x" } }),
							{ status: 200 },
						),
					);
			})) as unknown as typeof fetch;

		const { onTopicAdded } = renderPanel({
			fetchFn: slowFn,
			tabsQueryFn: makeTabsQuery("https://example.com/slow"),
		});

		fireEvent.click(screen.getByText("📋 抓取当前页面"));

		// 等 busy 状态生效（两个按钮都变成「抓取中…」）
		await waitFor(() => {
			const btns = screen.getAllByText("抓取中…") as HTMLButtonElement[];
			expect(btns.length).toBeGreaterThanOrEqual(1);
			// biome-ignore lint/style/noNonNullAssertion: waitFor 已确保至少一个按钮存在
			expect(btns[0]!.disabled).toBe(true);
		});

		// 再次点击当前页面按钮（已禁用，不应触发新请求）
		const btnsNow = screen.getAllByText("抓取中…") as HTMLButtonElement[];
		// biome-ignore lint/style/noNonNullAssertion: waitFor 已确保至少一个按钮存在
		fireEvent.click(btnsNow[0]!);

		// 完成请求
		resolveReq();
		await waitFor(() => expect(onTopicAdded).toHaveBeenCalledTimes(1));
	});
});
