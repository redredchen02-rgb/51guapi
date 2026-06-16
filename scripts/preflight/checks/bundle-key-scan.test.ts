import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateBundleScan, scanForKeys } from "./bundle-key-scan.ts";

const dirs: string[] = [];
function tmp(): string {
	const d = mkdtempSync(join(tmpdir(), "preflight-bundle-"));
	dirs.push(d);
	return d;
}
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PLANTED_KEY =
	"-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBg\n-----END PRIVATE KEY-----";

describe("evaluateBundleScan（特征化:植入 key 判红）", () => {
	it(".output/ 缺失 → RED 并提示先构建", () => {
		const r = evaluateBundleScan(join(tmpdir(), "definitely-not-here-xyz"));
		expect(r.status).toBe("fail");
		expect(r.reason).toContain("构建");
	});

	it("产物含植入私钥 → RED,且 reason 不含明文", () => {
		const d = tmp();
		writeFileSync(
			join(d, "bundle.js"),
			`const k=${JSON.stringify(PLANTED_KEY)};`,
		);
		const r = evaluateBundleScan(d);
		expect(r.status).toBe("fail");
		expect(r.reason).not.toContain("BEGIN PRIVATE KEY");
		expect(r.reason).not.toContain("MIIBVgIBAD");
	});

	it("干净产物 → PASS", () => {
		const d = tmp();
		writeFileSync(join(d, "bundle.js"), `console.log("hello world");`);
		const r = evaluateBundleScan(d);
		expect(r.status).toBe("pass");
	});

	it("scanForKeys 只返回计数,不返回明文", () => {
		const res = scanForKeys([
			{ name: "a.js", content: PLANTED_KEY },
			{ name: "b.js", content: "clean" },
		]);
		expect(res.hitCount).toBe(1);
		expect(res.scanned).toBe(2);
		expect(JSON.stringify(res)).not.toContain("PRIVATE KEY");
	});
});
