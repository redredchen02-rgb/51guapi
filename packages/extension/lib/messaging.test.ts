import { describe, expect, it } from "vitest";
import { pickAdminTabId } from "./messaging";

const HOST = "dx-999-adm.ympxbys.xyz";
const adminUrl = `https://${HOST}/admin/index/index`;

describe("pickAdminTabId", () => {
	it("当前活动 tab 就是后台页 → 用它", () => {
		const active = { id: 7, url: adminUrl };
		expect(pickAdminTabId(active, [{ id: 9 }], HOST)).toBe(7);
	});

	it("活动 tab 不是后台页(url 不含 host)→ 取 host 匹配的后台页 tab", () => {
		const active = { id: 7, url: "https://hackmd.io/abc" };
		expect(pickAdminTabId(active, [{ id: 42 }], HOST)).toBe(42);
	});

	it("活动 tab 无 url 权限(url undefined)→ 退回 host 匹配 tab(本次真实故障场景)", () => {
		const active = { id: 7 }; // 非后台域,扩展无该 tab 的 url 权限
		expect(pickAdminTabId(active, [{ id: 42 }], HOST)).toBe(42);
	});

	it("活动 tab 不是后台页且无 host 匹配 → null", () => {
		expect(
			pickAdminTabId({ id: 7, url: "https://x.com" }, [], HOST),
		).toBeNull();
	});

	it("host 匹配项里跳过没有 id 的,取第一个有 id 的", () => {
		expect(pickAdminTabId(undefined, [{}, { id: 5 }], HOST)).toBe(5);
	});

	it("完全无可用 tab → null", () => {
		expect(pickAdminTabId(undefined, [], HOST)).toBeNull();
	});

	it("活动 tab 是后台页但缺 id(异常)→ 退回 host 匹配", () => {
		expect(pickAdminTabId({ url: adminUrl }, [{ id: 3 }], HOST)).toBe(3);
	});
});
