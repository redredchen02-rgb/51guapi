import { describe, expect, it } from "vitest";
import { containsSecret, scrubHtml, scrubSnapshot } from "./secret-scrub";

describe("secret-scrub", () => {
	it("剥 hidden input(含值整删)", () => {
		const out = scrubHtml(
			'<input type="hidden" name="_token" value="abc123"><input name="title" value="t">',
		);
		expect(out).not.toMatch(/_token/);
		expect(out).not.toMatch(/abc123/);
		// 可见域保留结构但值剥空
		expect(out).toMatch(/name="title"/);
		expect(out).toMatch(/value=""/);
	});

	it("剥所有表单值(可见域含值也清空)", () => {
		const out = scrubHtml(
			'<input name="title" value="敏感标题"><textarea>正文机密</textarea>',
		);
		expect(out).not.toMatch(/敏感标题/);
		expect(out).not.toMatch(/正文机密/);
	});

	it("删 meta csrf/nonce + 剥 data-*", () => {
		const out = scrubHtml(
			'<meta name="csrf-token" content="xyz"><div data-uid="u-9999">x</div>',
		);
		expect(out).not.toMatch(/csrf-token/);
		expect(out).not.toMatch(/u-9999/);
	});

	it("Bearer / JWT / 长 hex 子串被替换", () => {
		const out = scrubHtml(
			"Authorization: Bearer abc.def-123  eyJhbGciOiJIUzI1NiIsfake  deadbeefdeadbeefdeadbeefdeadbeef",
		);
		expect(out).not.toMatch(/Bearer abc/);
		expect(out).not.toMatch(/eyJhbGci/);
		expect(out).not.toMatch(/deadbeefdeadbeef/);
	});

	describe("scrubSnapshot fail-closed", () => {
		it("干净快照 → ok + 返回清洗结果", () => {
			const r = scrubSnapshot('<form><input name="title" value="t"></form>');
			expect(r.ok).toBe(true);
			expect(r.snapshot).toBeDefined();
			expect(containsSecret(r.snapshot!)).toBe(false);
		});

		it("投毒自检:清洗后仍残留机密 → ok:false,绝不返回快照", () => {
			// 用一个清洗规则覆盖不到的形态(PHPSESSID 在纯文本里)验证 fail-closed。
			const poisoned = "<span>PHPSESSID=deadbeefdeadbeef</span>";
			const r = scrubSnapshot(poisoned);
			expect(r.ok).toBe(false);
			expect(r.snapshot).toBeUndefined();
			expect(r.reason).toMatch(/secret/);
		});

		it("containsSecret 抓常见形态", () => {
			expect(containsSecret("Set-Cookie: x")).toBe(true);
			expect(containsSecret("csrf_token=1")).toBe(true);
			expect(containsSecret("普通文本")).toBe(false);
		});
	});
});
