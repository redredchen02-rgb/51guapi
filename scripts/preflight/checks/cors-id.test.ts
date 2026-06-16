import { describe, expect, it } from "vitest";
import { evaluateCorsId } from "./cors-id.ts";
import {
	deriveExtensionOrigin,
	EXTENSION_KEY,
	KNOWN_EXTENSION_ID,
} from "./extension-id.ts";

const GOOD = deriveExtensionOrigin(EXTENSION_KEY);

// 其余 env 需让 env-check 的 CORS 分支不误报(JWT/hash 是另一项,不影响 CORS error 抓取)。
function envWith(cors: string | undefined): NodeJS.ProcessEnv {
	return cors === undefined ? {} : { CORS_ORIGIN: cors };
}

describe("evaluateCorsId（特征化:坏样本先判红）", () => {
	it("派生 ID 等于文档记录的已知 ID", () => {
		expect(GOOD).toBe(`chrome-extension://${KNOWN_EXTENSION_ID}`);
	});

	it("CORS_ORIGIN=* → RED", () => {
		const r = evaluateCorsId(envWith("*"));
		expect(r.status).toBe("fail");
		expect(r.reason).toContain("*");
	});

	it("CORS_ORIGIN=chrome-extension://wrongid → RED", () => {
		const r = evaluateCorsId(
			envWith("chrome-extension://wrongidwrongidwrongidwrongidwr"),
		);
		expect(r.status).toBe("fail");
		expect(r.reason).toContain("期望");
	});

	it("CORS_ORIGIN 缺失 → RED", () => {
		const r = evaluateCorsId(envWith(undefined));
		expect(r.status).toBe("fail");
	});

	it("CORS_ORIGIN = 派生来源 → PASS", () => {
		const r = evaluateCorsId(envWith(GOOD));
		expect(r.status).toBe("pass");
	});

	it("逗号分隔含派生来源 → PASS", () => {
		const r = evaluateCorsId(
			envWith(`chrome-extension://devdevdevdevdevdevdevdevdevdevde, ${GOOD}`),
		);
		expect(r.status).toBe("pass");
	});
});
