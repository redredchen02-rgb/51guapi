import { afterEach, describe, expect, it, vi } from "vitest";
import {
	assertUrlSafe,
	isPublicUnicastIp,
	SsrfError,
	safeFetch,
} from "./ssrf-guard.js";

describe("isPublicUnicastIp", () => {
	it("allows public unicast addresses", () => {
		for (const ip of [
			"8.8.8.8",
			"1.1.1.1",
			"203.0.114.1",
			"2606:4700:4700::1111",
			"::ffff:8.8.8.8",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(true);
		}
	});

	it("blocks private / loopback / link-local / CGNAT IPv4", () => {
		for (const ip of [
			"127.0.0.1",
			"10.0.0.1",
			"172.16.5.5",
			"192.168.1.1",
			"169.254.1.1",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("blocks IPv6 special ranges and mapped loopback", () => {
		for (const ip of [
			"::1",
			"::",
			"fe80::1",
			"fc00::1",
			"fd12:3456::1",
			"ff02::1",
			"::ffff:127.0.0.1",
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("blocks hex-form IPv4-in-IPv6 (compat / mapped / NAT64) pointing at private space", () => {
		for (const ip of [
			"::a00:1", // ::/96 compat = 10.0.0.1
			"::7f00:1", // ::/96 compat = 127.0.0.1
			"::a9fe:a9fe", // ::/96 compat = 169.254.169.254 (cloud metadata)
			"::ffff:a00:1", // mapped = 10.0.0.1
			"64:ff9b::7f00:1", // NAT64 = 127.0.0.1
		]) {
			expect(isPublicUnicastIp(ip), ip).toBe(false);
		}
	});

	it("still allows public hex-form embedded IPv4", () => {
		expect(isPublicUnicastIp("::ffff:808:808")).toBe(true); // mapped = 8.8.8.8
	});

	it("rejects non-IP input", () => {
		expect(isPublicUnicastIp("not-an-ip")).toBe(false);
	});
});

describe("assertUrlSafe", () => {
	it("rejects a literal loopback host", async () => {
		await expect(assertUrlSafe("http://127.0.0.1/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects localhost (resolves to loopback)", async () => {
		await expect(assertUrlSafe("http://localhost/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects non-http(s) protocols", async () => {
		await expect(assertUrlSafe("ftp://example.com/x")).rejects.toBeInstanceOf(
			SsrfError,
		);
		await expect(assertUrlSafe("file:///etc/passwd")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects URLs carrying credentials", async () => {
		await expect(
			assertUrlSafe("http://user:pass@1.1.1.1/"),
		).rejects.toBeInstanceOf(SsrfError);
	});

	it("accepts a literal public IP host", async () => {
		await expect(assertUrlSafe("https://1.1.1.1/")).resolves.toBeInstanceOf(
			URL,
		);
	});
});

describe("safeFetch", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("returns the response for an allowed host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("ok", { status: 200 })),
		);
		const res = await safeFetch("https://1.1.1.1/");
		expect(res.status).toBe(200);
	});

	it("rejects a redirect that points at a loopback address", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "http://127.0.0.1/" },
					}),
			),
		);
		await expect(safeFetch("https://1.1.1.1/")).rejects.toBeInstanceOf(
			SsrfError,
		);
	});

	it("rejects after too many redirects", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: "https://1.1.1.1/next" },
					}),
			),
		);
		await expect(safeFetch("https://1.1.1.1/", {}, 2)).rejects.toThrow(
			/Too many redirects/,
		);
	});
});
