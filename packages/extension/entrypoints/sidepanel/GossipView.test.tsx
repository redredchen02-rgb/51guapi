// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GossipView } from "./GossipView";

vi.mock("../../lib/gossip-client", () => ({
	fetchGossipSites: vi.fn(),
	createGossipSite: vi.fn(),
	deleteGossipSite: vi.fn(),
	discoverGossipSite: vi.fn(),
	fetchGossipTopicFromUrl: vi.fn(),
}));

vi.mock("../../lib/channel-client", () => ({
	fetchChannels: vi.fn(async () => []),
	createChannel: vi.fn(),
	deleteChannel: vi.fn(),
}));

import { createChannel, fetchChannels } from "../../lib/channel-client";
import {
	createGossipSite,
	discoverGossipSite,
	fetchGossipSites,
	fetchGossipTopicFromUrl,
} from "../../lib/gossip-client";

const mockFetchChannels = vi.mocked(fetchChannels);
const mockCreateChannel = vi.mocked(createChannel);

const mockFetchSites = vi.mocked(fetchGossipSites);
const mockCreateSite = vi.mocked(createGossipSite);
const mockDiscover = vi.mocked(discoverGossipSite);
const mockFromUrl = vi.mocked(fetchGossipTopicFromUrl);

const onBack = vi.fn();
const onTopicAdded = vi.fn();

function makeSite(id: string, name: string) {
	return {
		id,
		name,
		listUrl: `https://${id}.com/latest`,
		enabled: true,
		createdAt: "2024-01-01T00:00:00Z",
		updatedAt: "2024-01-01T00:00:00Z",
	};
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("GossipView", () => {
	it("渲染 2 個站點列表", async () => {
		mockFetchSites.mockResolvedValueOnce([
			makeSite("site-a", "站點A"),
			makeSite("site-b", "站點B"),
		]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => {
			expect(screen.getByText("站點A")).toBeDefined();
			expect(screen.getByText("站點B")).toBeDefined();
		});
	});

	it("空站點時顯示提示文字", async () => {
		mockFetchSites.mockResolvedValueOnce([]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => {
			expect(screen.getByText(/尚未新增站點/)).toBeDefined();
		});
	});

	it("輸入 name + listUrl 點新增 → 站點列表更新", async () => {
		mockFetchSites
			.mockResolvedValueOnce([]) // 初始
			.mockResolvedValueOnce([makeSite("new-1", "新站點")]); // 新增後重新載入
		mockCreateSite.mockResolvedValueOnce(makeSite("new-1", "新站點"));

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText("站點名稱"));

		fireEvent.change(screen.getByPlaceholderText("站點名稱"), {
			target: { value: "新站點" },
		});
		fireEvent.change(screen.getByPlaceholderText(/清單頁 URL/), {
			target: { value: "https://new-gossip.com/latest" },
		});
		fireEvent.click(screen.getByText("新增"));

		await waitFor(() => {
			expect(mockCreateSite).toHaveBeenCalledWith(
				"新站點",
				"https://new-gossip.com/latest",
			);
		});
	});

	it("點刷新 → mock discover 返回 5 條 → 顯示 5 條素材", async () => {
		mockFetchSites.mockResolvedValueOnce([makeSite("site-a", "站點A")]);
		mockDiscover.mockResolvedValueOnce(
			Array.from({ length: 5 }, (_, i) => ({
				url: `https://site-a.com/article/${i + 1}`,
				title: `標題${i + 1}`,
			})),
		);

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByText("站點A"));

		fireEvent.click(screen.getByText("🔄 刷新"));
		await waitFor(() => {
			expect(screen.getByText("標題1")).toBeDefined();
			expect(screen.getByText("標題5")).toBeDefined();
		});
	});

	it("點生成文章 → mock from-url 成功 → 呼叫 onTopicAdded", async () => {
		mockFetchSites.mockResolvedValueOnce([makeSite("site-a", "站點A")]);
		mockDiscover.mockResolvedValueOnce([
			{ url: "https://site-a.com/article/1", title: "某吃瓜事件" },
		]);
		mockFromUrl.mockResolvedValueOnce({ id: "pending_1", title: "某吃瓜事件" });

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByText("站點A"));

		fireEvent.click(screen.getByText("🔄 刷新"));
		await waitFor(() => screen.getByText("某吃瓜事件"));

		fireEvent.click(screen.getByText("生成文章"));
		await waitFor(() => {
			expect(onTopicAdded).toHaveBeenCalledTimes(1);
		});
	});

	it("POST /gossip/sites 返回錯誤 → 顯示錯誤訊息不 crash", async () => {
		mockFetchSites.mockResolvedValueOnce([]);
		mockCreateSite.mockRejectedValueOnce(
			new Error("Invalid listUrl: IP literal URLs are not allowed"),
		);

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText("站點名稱"));

		fireEvent.change(screen.getByPlaceholderText("站點名稱"), {
			target: { value: "壞站點" },
		});
		fireEvent.change(screen.getByPlaceholderText(/清單頁 URL/), {
			target: { value: "http://192.168.1.1/list" },
		});
		fireEvent.click(screen.getByText("新增"));

		await waitFor(() => {
			expect(screen.getByText(/IP literal/)).toBeDefined();
		});
	});

	it("discover API 返回錯誤 → 顯示錯誤橫幅，清單保留上次結果", async () => {
		mockFetchSites.mockResolvedValueOnce([makeSite("site-a", "站點A")]);
		mockDiscover
			.mockResolvedValueOnce([
				{ url: "https://site-a.com/article/1", title: "舊文章" },
			])
			.mockRejectedValueOnce(new Error("網路錯誤"));

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByText("站點A"));

		// 第一次刷新成功
		fireEvent.click(screen.getByText("🔄 刷新"));
		await waitFor(() => screen.getByText("舊文章"));

		// 第二次刷新失敗
		fireEvent.click(screen.getByText("🔄 刷新"));
		await waitFor(() => {
			expect(screen.getByText(/網路錯誤/)).toBeDefined();
			// 舊結果保留
			expect(screen.getByText("舊文章")).toBeDefined();
		});
	});

	// U6 渠道白名单 UI
	it("加载时显示渠道列表", async () => {
		mockFetchSites.mockResolvedValue([]);
		mockFetchChannels.mockResolvedValueOnce([
			{
				id: "chan_1",
				hostname: "51cg1.com",
				displayName: "51cg1",
				pathPrefix: "/",
				maxDepth: 1,
				maxBytes: 5242880,
				createdBy: "operator",
				reason: "",
				createdAt: "now",
			},
		]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => expect(screen.getByText("51cg1.com")).toBeDefined());
	});

	it("输入渠道域名 → 确认新增 → 调 createChannel 并刷新", async () => {
		mockFetchSites.mockResolvedValue([]);
		mockFetchChannels.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				id: "chan_2",
				hostname: "news-a.com",
				displayName: "news-a.com",
				pathPrefix: "/",
				maxDepth: 1,
				maxBytes: 5242880,
				createdBy: "operator",
				reason: "",
				createdAt: "now",
			},
		]);
		mockCreateChannel.mockResolvedValueOnce({
			id: "chan_2",
			hostname: "news-a.com",
			displayName: "news-a.com",
			pathPrefix: "/",
			maxDepth: 1,
			maxBytes: 5242880,
			createdBy: "operator",
			reason: "",
			createdAt: "now",
		});

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText(/钉死 https/));
		fireEvent.change(screen.getByPlaceholderText(/钉死 https/), {
			target: { value: "news-a.com" },
		});
		// step-up:新增渠道须输入管理员口令。
		fireEvent.change(screen.getByPlaceholderText(/管理员口令/), {
			target: { value: "pw" },
		});
		fireEvent.click(screen.getByText("确认新增"));
		await waitFor(() =>
			expect(mockCreateChannel).toHaveBeenCalledWith("news-a.com", {
				adminPassword: "pw",
			}),
		);
		await waitFor(() => expect(screen.getByText("news-a.com")).toBeDefined());
	});

	it("新增渠道失败(如同形被拒)显示错误", async () => {
		mockFetchSites.mockResolvedValue([]);
		mockFetchChannels.mockResolvedValue([]);
		mockCreateChannel.mockRejectedValueOnce(new Error("拒绝混合脚本/同形域名"));
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText(/钉死 https/));
		fireEvent.change(screen.getByPlaceholderText(/钉死 https/), {
			target: { value: "аpple.com" },
		});
		fireEvent.change(screen.getByPlaceholderText(/管理员口令/), {
			target: { value: "pw" },
		});
		fireEvent.click(screen.getByText("确认新增"));
		await waitFor(() => expect(screen.getByText(/同形/)).toBeDefined());
	});

	it("新增站点 — 空名称/URL 显示验证错误，不调 createGossipSite", async () => {
		mockFetchSites.mockResolvedValue([]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText("站點名稱"));
		// 点新增但不填任何内容
		fireEvent.click(screen.getByText("新增"));
		await waitFor(() =>
			expect(screen.getByText(/請填寫站點名稱和 URL/)).toBeDefined(),
		);
		expect(mockCreateSite).not.toHaveBeenCalled();
	});

	it("新增渠道 — 未填口令显示验证错误，不调 createChannel", async () => {
		mockFetchSites.mockResolvedValue([]);
		mockFetchChannels.mockResolvedValue([]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByPlaceholderText(/钉死 https/));
		fireEvent.change(screen.getByPlaceholderText(/钉死 https/), {
			target: { value: "example.com" },
		});
		// 故意不填口令
		fireEvent.click(screen.getByText("确认新增"));
		await waitFor(() =>
			expect(screen.getByText(/管理员口令重验/)).toBeDefined(),
		);
		expect(mockCreateChannel).not.toHaveBeenCalled();
	});

	it("删除站点 → 站点从列表消失", async () => {
		const { deleteGossipSite } = await import("../../lib/gossip-client");
		const mockDelete = vi.mocked(deleteGossipSite);
		mockDelete.mockResolvedValueOnce(undefined);
		mockFetchSites.mockResolvedValueOnce([makeSite("site-a", "站點A")]);
		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByText("站點A"));
		fireEvent.click(screen.getByText("刪除"));
		await waitFor(() => expect(screen.queryByText("站點A")).toBeNull());
		expect(mockDelete).toHaveBeenCalledWith("site-a");
	});

	it("生成文章 — DUPLICATE_URL 时同样调用 onTopicAdded 并移除该条目", async () => {
		mockFetchSites.mockResolvedValueOnce([makeSite("site-a", "站點A")]);
		mockDiscover.mockResolvedValueOnce([
			{ url: "https://site-a.com/dup", title: "已存在文章" },
		]);
		mockFromUrl.mockRejectedValueOnce(new Error("DUPLICATE_URL"));

		render(<GossipView onBack={onBack} onTopicAdded={onTopicAdded} />);
		await waitFor(() => screen.getByText("站點A"));
		fireEvent.click(screen.getByText("🔄 刷新"));
		await waitFor(() => screen.getByText("已存在文章"));

		fireEvent.click(screen.getByText("生成文章"));
		await waitFor(() => {
			expect(onTopicAdded).toHaveBeenCalledTimes(1);
			// 条目被移除
			expect(screen.queryByText("已存在文章")).toBeNull();
		});
	});
});
