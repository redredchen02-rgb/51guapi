import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { getStorage, isStorageAvailable } from "./chrome-storage-utils";

describe("chrome-storage-utils", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	// ---- isStorageAvailable ----

	it("Happy: fakeBrowser 環境下 isStorageAvailable() 返回 true", () => {
		expect(isStorageAvailable()).toBe(true);
	});

	// ---- getStorage ----

	it("Happy: getStorage() 返回非 null 的 storage 物件", () => {
		const storage = getStorage();
		expect(storage).not.toBeNull();
	});

	it("Happy: getStorage().set + get 往返一致", async () => {
		const storage = getStorage();
		expect(storage).not.toBeNull();

		await storage!.set({ testKey: "hello-world" });
		const result = await storage!.get("testKey");
		// chrome.storage.local.get 返回 Record<string, unknown>
		expect((result as Record<string, unknown>).testKey).toBe("hello-world");
	});

	it("Happy: getStorage().set 多個 key，各自讀取正確", async () => {
		const storage = getStorage();
		await storage!.set({ keyA: "valueA", keyB: 42 });

		const resultA = await storage!.get("keyA");
		const resultB = await storage!.get("keyB");
		expect((resultA as Record<string, unknown>).keyA).toBe("valueA");
		expect((resultB as Record<string, unknown>).keyB).toBe(42);
	});

	it("Happy: getStorage().remove 移除後 get 返回空物件", async () => {
		const storage = getStorage();
		await storage!.set({ removeMe: "value" });
		await storage!.remove("removeMe");
		const result = await storage!.get("removeMe");
		// 移除後 chrome.storage.local.get 返回空 Record
		expect((result as Record<string, unknown>).removeMe).toBeUndefined();
	});

	it("Edge: get 不存在的 key → 返回空 Record（無該 key）", async () => {
		const storage = getStorage();
		const result = await storage!.get("nonexistent_key_xyz");
		expect(
			(result as Record<string, unknown>).nonexistent_key_xyz,
		).toBeUndefined();
	});

	it("Integration: set A + set B → remove A → B 仍存在", async () => {
		const storage = getStorage();
		await storage!.set({ alpha: "1", beta: "2" });
		await storage!.remove("alpha");

		const alphaResult = await storage!.get("alpha");
		const betaResult = await storage!.get("beta");
		expect((alphaResult as Record<string, unknown>).alpha).toBeUndefined();
		expect((betaResult as Record<string, unknown>).beta).toBe("2");
	});
});
