// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { clearBackendUrlCache, getBackendUrl } from "./backend-url";

describe("getBackendUrl", () => {
	beforeEach(() => {
		clearBackendUrlCache();
		fakeBrowser.reset();
	});

	it("返回配置的 backendUrl", async () => {
		await fakeBrowser.storage.local.set({
			settings: { backendUrl: "http://custom:8080" },
		});
		expect(await getBackendUrl()).toBe("http://custom:8080");
	});

	it("未配置时返回默认值", async () => {
		expect(await getBackendUrl()).toBe("http://127.0.0.1:3001");
	});

	it("结果被缓存", async () => {
		await fakeBrowser.storage.local.set({
			settings: { backendUrl: "http://cached:9090" },
		});
		await getBackendUrl();
		const url2 = await getBackendUrl();
		expect(url2).toBe("http://cached:9090");
	});

	it("clearBackendUrlCache 后重新读取", async () => {
		await fakeBrowser.storage.local.set({
			settings: { backendUrl: "http://first:8080" },
		});
		await getBackendUrl();
		clearBackendUrlCache();
		await fakeBrowser.storage.local.set({
			settings: { backendUrl: "http://second:9090" },
		});
		expect(await getBackendUrl()).toBe("http://second:9090");
	});
});
