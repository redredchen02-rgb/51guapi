import { describe, expect, it } from "vitest";
import { isHostAllowed, loadSSRFAllowlist } from "./ssrf-allowlist.js";

// 注入 fake env 对象,绝不改 process.env。
function load(allowedHosts?: string) {
	return loadSSRFAllowlist(
		(allowedHosts === undefined
			? {}
			: { ALLOWED_HOSTS: allowedHosts }) as NodeJS.ProcessEnv,
	);
}

describe("loadSSRFAllowlist + isHostAllowed (fail-closed 契约)", () => {
	it("精确 host 命中,非命中 host 拒绝", () => {
		const cfg = load("example.com");
		const cases: [string, boolean][] = [
			["https://example.com/x", true],
			["http://example.com/x", true],
			["https://other.com/x", false],
			["https://sub.example.com/x", false], // 非通配 → 子域不命中
		];
		for (const [url, want] of cases) {
			expect(isHostAllowed(new URL(url), cfg), url).toBe(want);
		}
	});

	it("通配 *.example.com 命中子域与根域", () => {
		const cfg = load("*.example.com");
		const cases: [string, boolean][] = [
			["https://sub.example.com/x", true],
			["https://deep.sub.example.com/x", true],
			["https://example.com/x", true], // === host 也命中
		];
		for (const [url, want] of cases) {
			expect(isHostAllowed(new URL(url), cfg), url).toBe(want);
		}
	});

	it("ALLOWED_HOSTS 未设置 → length 0 → 任何 host 拒绝(fail-closed)", () => {
		const cfg = load();
		expect(cfg.allowedHosts.length).toBe(0);
		expect(cfg.mode).toBe("fail-closed");
		expect(isHostAllowed(new URL("https://example.com/x"), cfg)).toBe(false);
	});

	it("ALLOWED_HOSTS 为空字符串 → length 0 → 拒绝", () => {
		const cfg = load("");
		expect(cfg.allowedHosts.length).toBe(0);
		expect(isHostAllowed(new URL("https://example.com/x"), cfg)).toBe(false);
	});

	it("ALLOWED_HOSTS=',,, '(全空白)→ 无有效 pattern → 全部拒绝", () => {
		const cfg = load(",,, ");
		expect(cfg.allowedHosts.length).toBe(0);
		expect(isHostAllowed(new URL("https://example.com/x"), cfg)).toBe(false);
	});

	it("协议钉死 https://example.com,候选 http://example.com → 拒绝", () => {
		const cfg = load("https://example.com");
		expect(isHostAllowed(new URL("https://example.com/x"), cfg)).toBe(true);
		expect(isHostAllowed(new URL("http://example.com/x"), cfg)).toBe(false);
	});

	it("evilexample.com 不应命中 *.example.com(.endsWith 边界)", () => {
		const cfg = load("*.example.com");
		expect(isHostAllowed(new URL("https://evilexample.com/x"), cfg)).toBe(
			false,
		);
	});

	it("authority 伪造 https://example.com@evil.com 解析为 evil.com → 拒绝", () => {
		const url = new URL("https://example.com@evil.com");
		expect(url.hostname).toBe("evil.com");
		const cfg = load("example.com");
		expect(isHostAllowed(url, cfg)).toBe(false);
	});

	it("尾点 host example.com. 的实际行为", () => {
		const cfg = load("example.com");
		const url = new URL("https://example.com./x");
		// fail-closed 契约:allowlist 只放行精确匹配的 host;尾点变体
		// "example.com." !== "example.com" → 拒绝。对 allowlist 而言「非精确即拒」
		// 正是应然方向(宁可拒一个变体,不可误放),非 bug、非锁死错误行为。
		expect(url.hostname).toBe("example.com.");
		expect(isHostAllowed(url, cfg)).toBe(false);

		// 通配下尾点 host 是否绕过:".example.com" endsWith 检查
		// "example.com." 不以 ".example.com" 结尾 → 拒绝(安全方向)。
		const wildcardCfg = load("*.example.com");
		expect(
			isHostAllowed(new URL("https://sub.example.com./x"), wildcardCfg),
		).toBe(false);
	});

	it("hostname 大小写归一:EXAMPLE.COM 命中 example.com", () => {
		const cfg = load("example.com");
		expect(isHostAllowed(new URL("https://EXAMPLE.COM/x"), cfg)).toBe(true);
	});
});
