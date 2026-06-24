import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { getCurrentTabUrl } from "./current-tab";

// 通过注入 queryFn 模拟 browser.tabs.query，与 fetchFn 注入模式一致。

function makeQuery(
	tabs: Array<{ url?: string }>,
): (info: {
	active: boolean;
	currentWindow: boolean;
}) => Promise<Array<{ url?: string }>> {
	return (_info) => Promise.resolve(tabs);
}

function throwingQuery(_info: {
	active: boolean;
	currentWindow: boolean;
}): Promise<Array<{ url?: string }>> {
	return Promise.reject(new Error("tabs API not available"));
}

beforeEach(() => {
	fakeBrowser.reset();
});

describe("getCurrentTabUrl", () => {
	it("Happy: 当前 tab 为 https URL → 返回该 URL", async () => {
		const result = await getCurrentTabUrl(
			makeQuery([{ url: "https://example.com/article/123" }]),
		);
		expect(result).toBe("https://example.com/article/123");
	});

	it("Happy: http URL 也接受", async () => {
		const result = await getCurrentTabUrl(
			makeQuery([{ url: "http://gossip-site.com/news/456" }]),
		);
		expect(result).toBe("http://gossip-site.com/news/456");
	});

	it("Edge: tabs 为空数组 → null", async () => {
		const result = await getCurrentTabUrl(makeQuery([]));
		expect(result).toBeNull();
	});

	it("Edge: URL 是 chrome://newtab/ → null(非 http/https)", async () => {
		const result = await getCurrentTabUrl(
			makeQuery([{ url: "chrome://newtab/" }]),
		);
		expect(result).toBeNull();
	});

	it("Edge: URL 是 about:blank → null", async () => {
		const result = await getCurrentTabUrl(makeQuery([{ url: "about:blank" }]));
		expect(result).toBeNull();
	});

	it("Edge: tab 的 url 字段为 undefined → null", async () => {
		const result = await getCurrentTabUrl(makeQuery([{}]));
		expect(result).toBeNull();
	});

	it("Error: queryFn 抛出异常 → null(不向外抛)", async () => {
		const result = await getCurrentTabUrl(throwingQuery);
		expect(result).toBeNull();
	});
});
