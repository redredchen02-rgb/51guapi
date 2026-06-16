import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
	clearToken,
	getAuthHeaders,
	getToken,
	isAuthenticated,
	setToken,
} from "./auth-client";

describe("auth-client — getAuthHeaders / token 生命周期", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("Edge: 无 token → 仅 Content-Type，无 Authorization", async () => {
		const headers = await getAuthHeaders();
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers.Authorization).toBeUndefined();
	});

	it("Happy: 有 token → 含 Bearer Authorization 头", async () => {
		await setToken("tok-xyz");
		const headers = await getAuthHeaders();
		expect(headers["Content-Type"]).toBe("application/json");
		expect(headers.Authorization).toBe("Bearer tok-xyz");
	});

	it("clearToken() → 移除 token，后续 getToken 返回 null", async () => {
		await setToken("tok-xyz");
		expect(await getToken()).toBe("tok-xyz");
		await clearToken();
		expect(await getToken()).toBeNull();
		const headers = await getAuthHeaders();
		expect(headers.Authorization).toBeUndefined();
	});

	it("isAuthenticated 反映 token 是否存在", async () => {
		expect(await isAuthenticated()).toBe(false);
		await setToken("tok-xyz");
		expect(await isAuthenticated()).toBe(true);
		await clearToken();
		expect(await isAuthenticated()).toBe(false);
	});
});
