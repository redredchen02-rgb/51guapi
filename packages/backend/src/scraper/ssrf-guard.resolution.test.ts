import { afterEach, describe, expect, it, vi } from "vitest";

// 解析态边角:这些用例 mock node:dns/promises.lookup 以确定性地驱动「host 解析成什么」,
// 覆盖既有 ssrf-guard.test.ts(用真实解析:localhost / 字面 IP)够不到的分支:
// - 混合公/私网解析(守卫须检查全部地址,而非只看第一个)
// - 只解析到云元数据 / IPv6 ULA(确定性,不依赖测试机解析器)
// - 空 DNS 记录、解析失败 → fail-closed 拒
// - 重定向到「解析为私网的 hostname」/ 非 http(s) 协议
// 注意:DNS-rebinding 的 lookup→fetch TOCTOU 残留是 ssrf-guard.ts 顶部明确文档化的、
// 刻意不 pin 的设计取舍(由上游 hostname allowlist 兜),不在本测试范围内。

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { assertUrlSafe, SsrfError, safeFetch } from "./ssrf-guard.js";

// lookup 是重载函数;vi.mocked 会挑到单数 LookupAddress 重载,使 mockResolvedValue 拒收数组。
// 显式 cast 成 {all:true} 形态(返回 LookupAddress[]),让各 mock 设值 typecheck 通过。
const mockLookup = vi.mocked(
	lookup as unknown as (
		hostname: string,
		options: { all: true; verbatim: boolean },
	) => Promise<LookupAddress[]>,
);

/** 构造 lookup({all:true}) 形态的返回(LookupAddress[])。 */
function resolved(...ips: string[]) {
	return ips.map((address) => ({
		address,
		family: address.includes(":") ? 6 : 4,
	}));
}

afterEach(() => {
	vi.unstubAllGlobals();
	mockLookup.mockReset();
});

describe("assertUrlSafe — 解析态拒绝(mock DNS)", () => {
	it("拒绝:host 解析出公网+私网混合(守卫检查全部地址,非只第一个)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1", "10.0.0.1"));
		await expect(
			assertUrlSafe("https://rebind.example/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("拒绝:host 只解析到云元数据 IP 169.254.169.254", async () => {
		mockLookup.mockResolvedValue(resolved("169.254.169.254"));
		await expect(
			assertUrlSafe("https://metadata.evil/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("拒绝:host 只解析到 IPv6 unique-local(fd00::/8)", async () => {
		mockLookup.mockResolvedValue(resolved("fd12:3456::1"));
		await expect(
			assertUrlSafe("https://v6priv.example/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("拒绝:DNS 返回空记录", async () => {
		mockLookup.mockResolvedValue(resolved());
		await expect(assertUrlSafe("https://nodata.example/")).rejects.toThrow(
			/No DNS records/,
		);
	});

	it("拒绝:DNS 解析抛错 → 归一为 SsrfError(fail-closed,不外泄裸 DNS 错误)", async () => {
		mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
		await expect(
			assertUrlSafe("https://broken-dns.example/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("放行:host 只解析到公网地址(v4+v6)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1", "2606:4700:4700::1111"));
		await expect(assertUrlSafe("https://ok.example/")).resolves.toBeInstanceOf(
			URL,
		);
	});
});

describe("safeFetch — 重定向解析态边角(mock DNS + fetch)", () => {
	it("拒绝:重定向到「解析为私网地址」的 hostname(非字面 IP)", async () => {
		// hop0 解析 good.example → 公网;hop1(重定向后)解析 evil.example → 私网。
		mockLookup
			.mockResolvedValueOnce(resolved("1.1.1.1"))
			.mockResolvedValueOnce(resolved("10.0.0.1"));
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "https://evil.example/" },
					}),
			),
		);
		await expect(safeFetch("https://good.example/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("拒绝:重定向到非 http(s) 协议(file://)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "file:///etc/passwd" },
					}),
			),
		);
		await expect(safeFetch("https://good.example/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("放行:重定向到另一个公网 host 并返回其响应(无 allowlistCheck,仅私网检查)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://other.example/x" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const res = await safeFetch("https://good.example/");
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

// U6:动态渠道把信任边界降为运行期,redirect 必须逐跳重过 allowlist。
// 堵住「加 good.example,一个 302 导向 other.example(不在 allowlist 的公网 host)」缺口。
describe("safeFetch — 逐跳重过 allowlist(U6)", () => {
	it("拒绝:302 导向不在 allowlist 的公网 host(逐跳重过 allowlist,不跟随)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1")); // 两跳都解析公网
		const fetchMock = vi.fn().mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "https://other.example/x" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		// allowlist 只含 good.example;redirect 目标 other.example 不在内 → 拒。
		const allowlistCheck = (u: URL) => u.hostname === "good.example";
		await expect(
			safeFetch("https://good.example/", {}, { allowlistCheck }),
		).rejects.toThrow(/allowlist/);
		// 只 fetch 了第一跳,未跟随 redirect。
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("放行:redirect 目标也在 allowlist 时跟随", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://other.example/x" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const allow = new Set(["good.example", "other.example"]);
		const res = await safeFetch(
			"https://good.example/",
			{},
			{
				allowlistCheck: (u: URL) => allow.has(u.hostname),
			},
		);
		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("拒绝:首跳 host 即不在 allowlist", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		vi.stubGlobal("fetch", vi.fn());
		await expect(
			safeFetch(
				"https://blocked.example/",
				{},
				{
					allowlistCheck: (u: URL) => u.hostname === "good.example",
				},
			),
		).rejects.toThrow(/allowlist/);
	});
});
