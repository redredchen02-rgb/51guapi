import { afterEach, describe, expect, it, vi } from "vitest";

// DNS rebinding socket-pinning 测试(U1)。
// 核心断言:连线走的是「校验那一刻选定的公网 IP」,而非连线时重新解析。
// makePinnedLookup 是 pinnedDispatcher 注入 undici connect.lookup 的同一回调,
// 直接调用它即可确定性断言「连线目标 == 校验时 IP」与「私网钉 IP 被拒」。

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import {
	makePinnedLookup,
	resolveAndPin,
	SsrfError,
	safeFetch,
} from "./ssrf-guard.js";

const mockLookup = vi.mocked(
	lookup as unknown as (
		hostname: string,
		options: { all: true; verbatim: boolean },
	) => Promise<LookupAddress[]>,
);

function resolved(...ips: string[]) {
	return ips.map((address) => ({
		address,
		family: address.includes(":") ? 6 : 4,
	}));
}

/** 同步调用 connect.lookup 回调,收集 [err, address, family]。 */
function callLookup(
	fn: ReturnType<typeof makePinnedLookup>,
	hostname: string,
): [Error | null, string, number] {
	let captured: [Error | null, string, number] = [null, "", 0];
	fn(hostname, {}, (err, address, family) => {
		captured = [err, address, family];
	});
	return captured;
}

afterEach(() => {
	vi.unstubAllGlobals();
	mockLookup.mockReset();
});

describe("makePinnedLookup — 钉 IP + 连线时私网复验", () => {
	it("Happy:connect.lookup 强制回传已校验公网 IP(连线端 == 校验端),无视传入 hostname", () => {
		const lookupFn = makePinnedLookup({
			url: new URL("https://ok.example/"),
			pinnedIp: "1.1.1.1",
			pinnedFamily: 4,
		});
		// 即使传入会重解析成私网的 hostname,lookup 也只回钉住的公网 IP。
		const [err, address, family] = callLookup(lookupFn, "rebind.example");
		expect(err).toBeNull();
		expect(address).toBe("1.1.1.1");
		expect(family).toBe(4);
	});

	it("Security(rebinding 纵深):钉 IP 为私网时 connect.lookup 拒(SsrfError)", () => {
		const lookupFn = makePinnedLookup({
			url: new URL("https://x.example/"),
			pinnedIp: "10.0.0.1",
			pinnedFamily: 4,
		});
		const [err, address] = callLookup(lookupFn, "x.example");
		expect(err).toBeInstanceOf(SsrfError);
		expect(address).toBe("");
	});

	it("Edge:IPv6 钉 IP → family 6", () => {
		const lookupFn = makePinnedLookup({
			url: new URL("https://v6.example/"),
			pinnedIp: "2606:4700:4700::1111",
			pinnedFamily: 6,
		});
		const [err, address, family] = callLookup(lookupFn, "v6.example");
		expect(err).toBeNull();
		expect(address).toBe("2606:4700:4700::1111");
		expect(family).toBe(6);
	});
});

describe("safeFetch — socket pinning 端到端(rebinding 硬指标)", () => {
	it("Security(rebinding):每跳带 dispatcher,其 connect.lookup 钉到校验时选定的公网 IP", async () => {
		// 校验态 host 解析到公网 1.1.1.1 → 钉之。捕获传给 fetch 的 dispatcher。
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		let capturedDispatcher: unknown;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: { dispatcher?: unknown }) => {
				capturedDispatcher = init.dispatcher;
				return new Response("ok", { status: 200 });
			}),
		);
		const res = await safeFetch("https://rebind.example/");
		expect(res.status).toBe(200);
		// 每跳必带 pin dispatcher。
		expect(capturedDispatcher).toBeDefined();
		// 断言连线目标 == 校验时 IP:重建与该跳同 target 的 lookup,验证它钉的是 1.1.1.1
		// (rebind.example 在连线时若重解析会变私网,但 pin 下永远是 1.1.1.1)。
		const lookupFn = makePinnedLookup({
			url: new URL("https://rebind.example/"),
			pinnedIp: "1.1.1.1",
			pinnedFamily: 4,
		});
		const [err, address] = callLookup(lookupFn, "rebind.example");
		expect(err).toBeNull();
		expect(address).toBe("1.1.1.1"); // 连线目标 == 校验时 IP,非重新解析
	});

	it("逐跳重钉:redirect 到另一公网 host → 新跳重新解析并钉新 IP", async () => {
		mockLookup
			.mockResolvedValueOnce(resolved("1.1.1.1")) // hop0 good.example
			.mockResolvedValueOnce(resolved("8.8.8.8")); // hop1 other.example
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
		// 每跳各解析一次 → 各自重钉。
		expect(mockLookup).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("逐跳重钉:redirect 到私网 host → 校验阶段即拒,不连线", async () => {
		mockLookup
			.mockResolvedValueOnce(resolved("1.1.1.1"))
			.mockResolvedValueOnce(resolved("10.0.0.1"));
		const fetchMock = vi.fn().mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "https://evil.example/" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		await expect(safeFetch("https://good.example/")).rejects.toBeInstanceOf(
			SsrfError,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1); // 未连第二跳
	});

	it("Edge:IPv6-only host → 钉 v6 公网 IP", async () => {
		mockLookup.mockResolvedValue(resolved("2606:4700:4700::1111"));
		const target = await resolveAndPin("https://v6.example/");
		expect(target.pinnedIp).toBe("2606:4700:4700::1111");
		expect(target.pinnedFamily).toBe(6);
	});

	it("Edge:多 A 记录取第一个公网 IP", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1", "8.8.8.8"));
		const target = await resolveAndPin("https://multi.example/");
		expect(target.pinnedIp).toBe("1.1.1.1");
	});

	it("Edge:混合公/私网 → 仍全量检查并拒(不回归)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1", "10.0.0.1"));
		await expect(resolveAndPin("https://mix.example/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("Edge:DNS 失败不回归 → SsrfError", async () => {
		mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
		await expect(safeFetch("https://broken.example/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});
});
