import type { LookupAddress } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertHostResolvesPublic,
	deleteChannel,
	getChannelByHostname,
	insertChannel,
	listChannels,
	MAX_CHANNELS,
	MAX_DEPTH,
	normalizeChannelHost,
} from "./channel-store.js";
import { getDb, initPendingDb, resetPendingDb } from "./pending-db.js";

function fakeLookup(...ips: string[]) {
	return vi.fn(async () =>
		ips.map((address) => ({
			address,
			family: address.includes(":") ? 6 : 4,
		})),
	) as unknown as Parameters<typeof assertHostResolvesPublic>[1];
}

describe("normalizeChannelHost", () => {
	it("接受裸域名,小写化", () => {
		expect(normalizeChannelHost("51CG1.com")).toEqual({
			hostname: "51cg1.com",
		});
	});

	it("接受 https URL,取 hostname", () => {
		expect(normalizeChannelHost("https://news-a.com/path")).toEqual({
			hostname: "news-a.com",
		});
	});

	it("拒绝 http(非 https)", () => {
		expect(normalizeChannelHost("http://news-a.com").error).toMatch(/https/);
	});

	it("拒绝通配 *.", () => {
		expect(normalizeChannelHost("*.evil.com").error).toMatch(/通配/);
	});

	it("拒绝 IP literal", () => {
		expect(normalizeChannelHost("127.0.0.1").error).toMatch(/IP/);
		expect(normalizeChannelHost("https://127.0.0.1/").error).toMatch(/IP/);
	});

	it("拒绝 IDN 混合脚本同形域名(西里尔 аpple.com)", () => {
		// 第一个字符是西里尔 а (U+0430)
		const res = normalizeChannelHost("аpple.com");
		expect(res.error).toMatch(/同形|homograph/i);
		expect(res.hostname).toBeUndefined();
	});

	it("Security(IDN 脚本白名单):纯西里尔同形 субер.com → 拒绝", () => {
		const res = normalizeChannelHost("субер.com");
		expect(res.error).toMatch(/同形|homograph|脚本/i);
		expect(res.hostname).toBeUndefined();
	});

	it("Security(IDN 脚本白名单):纯希腊脚本同形 αβγ.com → 拒绝", () => {
		const res = normalizeChannelHost("αβγ.com");
		expect(res.error).toMatch(/同形|homograph|脚本/i);
	});

	it("Security(IDN):全角拉丁 U+FF41(ａｐｐｌｅ.com) → 拒绝", () => {
		expect(normalizeChannelHost("ａｐｐｌｅ.com").error).toMatch(
			/同形|homograph|脚本/i,
		);
	});

	it("Security(IDN):零宽字符 U+200B → 拒绝", () => {
		expect(normalizeChannelHost("a​b.com").error).toMatch(
			/同形|homograph|脚本/i,
		);
	});

	it("Security(IDN):BIDI 控制符 U+202E → 拒绝", () => {
		expect(normalizeChannelHost("‮apple.com").error).toMatch(
			/同形|homograph|脚本/i,
		);
	});

	it("Security(IDN):组合附加符 U+0301 → 拒绝", () => {
		expect(normalizeChannelHost("ápple.com").error).toMatch(
			/同形|homograph|脚本/i,
		);
	});

	it("放行纯 CJK(例子.com)并转 punycode", () => {
		const res = normalizeChannelHost("例子.com");
		expect(res.hostname).toMatch(/^xn--/);
		expect(res.error).toBeUndefined();
	});

	it("放行 ASCII+CJK 混合(新闻.example.com)", () => {
		const res = normalizeChannelHost("新闻.example.com");
		expect(res.hostname).toBeTruthy();
		expect(res.error).toBeUndefined();
	});

	it("空输入拒绝", () => {
		expect(normalizeChannelHost("").error).toBeTruthy();
		expect(normalizeChannelHost("   ").error).toBeTruthy();
	});

	it("https URL 解析失敗（格式錯誤）→ 非法 URL (line 121)", () => {
		expect(normalizeChannelHost("https://[invalid-ipv6").error).toMatch(
			/非法 URL/,
		);
	});

	it("https URL 含憑證 (user:pass@) → 拒絕 (line 128)", () => {
		expect(normalizeChannelHost("https://user:pass@example.com").error).toMatch(
			/凭证/,
		);
	});

	it("IPv6 字面量 ([::1]) → 禁止 IP 字面量 (line 145)", () => {
		expect(normalizeChannelHost("https://[::1]:8080").error).toMatch(
			/IP 字面量/,
		);
	});

	it("單標籤域名（無點）→ 非法域名格式 (line 163)", () => {
		expect(normalizeChannelHost("localhost").error).toMatch(/非法域名格式/);
	});
});

describe("assertHostResolvesPublic", () => {
	it("解析到公网通过", async () => {
		await expect(
			assertHostResolvesPublic("ok.example", fakeLookup("1.1.1.1")),
		).resolves.toBeUndefined();
	});

	it("解析到元数据 IP 169.254.169.254 拒绝", async () => {
		await expect(
			assertHostResolvesPublic("evil.example", fakeLookup("169.254.169.254")),
		).rejects.toThrow(/非公网/);
	});

	it("解析到私网 10.x 拒绝", async () => {
		await expect(
			assertHostResolvesPublic("evil.example", fakeLookup("10.0.0.5")),
		).rejects.toThrow(/非公网/);
	});

	it("公私混合也拒绝(检查全部地址)", async () => {
		await expect(
			assertHostResolvesPublic(
				"rebind.example",
				fakeLookup("1.1.1.1", "10.0.0.1"),
			),
		).rejects.toThrow(/非公网/);
	});

	it("DNS 失败 fail-closed", async () => {
		const lk = vi.fn(async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as typeof import("node:dns/promises").lookup;
		await expect(assertHostResolvesPublic("x.example", lk)).rejects.toThrow(
			/解析失败/,
		);
	});

	it("空记录拒绝", async () => {
		const lk = vi.fn(
			async () => [] as LookupAddress[],
		) as unknown as typeof import("node:dns/promises").lookup;
		await expect(assertHostResolvesPublic("x.example", lk)).rejects.toThrow(
			/无 DNS/,
		);
	});
});

describe("channel store (SQLite)", () => {
	beforeEach(() => {
		resetPendingDb();
		initPendingDb();
		getDb().exec("DELETE FROM channels");
	});
	afterEach(() => {
		resetPendingDb();
	});

	it("insert + list + getByHostname", () => {
		const r = insertChannel({
			hostname: "51cg1.com",
			displayName: "51cg1",
			createdBy: "operator",
			reason: "吃瓜源",
		});
		expect(r.channel?.hostname).toBe("51cg1.com");
		expect(listChannels()).toHaveLength(1);
		expect(getChannelByHostname("51cg1.com")?.displayName).toBe("51cg1");
	});

	it("去重:重复 hostname 返回既有且不新增", () => {
		insertChannel({ hostname: "a.com", displayName: "a", createdBy: "op" });
		const r2 = insertChannel({
			hostname: "a.com",
			displayName: "a",
			createdBy: "op",
		});
		expect(r2.deduped).toBe(true);
		expect(listChannels()).toHaveLength(1);
	});

	it("删除后即移除", () => {
		const r = insertChannel({
			hostname: "a.com",
			displayName: "a",
			createdBy: "op",
		});
		expect(deleteChannel(r.channel!.id)).toBe(true);
		expect(listChannels()).toHaveLength(0);
		expect(deleteChannel("nope")).toBe(false);
	});

	it("记审计栏位 created_by/created_at/reason", () => {
		const r = insertChannel({
			hostname: "a.com",
			displayName: "a",
			createdBy: "alice",
			reason: "测试源",
		});
		expect(r.channel?.createdBy).toBe("alice");
		expect(r.channel?.reason).toBe("测试源");
		expect(r.channel?.createdAt).toBeTruthy();
	});

	it("默认 pathPrefix/maxDepth/maxBytes 安全兜底", () => {
		const r = insertChannel({
			hostname: "a.com",
			displayName: "a",
			createdBy: "op",
		});
		expect(r.channel?.pathPrefix).toBe("/");
		expect(r.channel?.maxDepth).toBe(1);
		expect(r.channel?.maxBytes).toBe(5 * 1024 * 1024);
	});

	it("maxDepth 超大值 clamp 到 MAX_DEPTH 上限", () => {
		const r = insertChannel({
			hostname: "big.com",
			displayName: "big",
			maxDepth: 99999,
			createdBy: "op",
		});
		expect(r.channel?.maxDepth).toBe(MAX_DEPTH);
		// 读回持久化值也已 clamp
		expect(getChannelByHostname("big.com")?.maxDepth).toBe(MAX_DEPTH);
	});

	it("maxDepth=0/负值/非整数 收敛到 1", () => {
		const zero = insertChannel({
			hostname: "z.com",
			displayName: "z",
			maxDepth: 0,
			createdBy: "op",
		});
		expect(zero.channel?.maxDepth).toBe(1);
		const neg = insertChannel({
			hostname: "n.com",
			displayName: "n",
			maxDepth: -5,
			createdBy: "op",
		});
		expect(neg.channel?.maxDepth).toBe(1);
	});

	it("数量上限 MAX_CHANNELS 拒绝", () => {
		for (let i = 0; i < MAX_CHANNELS; i++) {
			insertChannel({
				hostname: `h${i}.com`,
				displayName: "x",
				createdBy: "op",
			});
		}
		const over = insertChannel({
			hostname: "over.com",
			displayName: "x",
			createdBy: "op",
		});
		expect(over.error).toMatch(/上限/);
	});
});
