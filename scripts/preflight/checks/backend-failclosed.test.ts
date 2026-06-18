import { describe, expect, it } from "vitest";
import { checkEnv } from "../../../packages/backend/src/config/env-check.ts";
import { evaluateFailClosed } from "./backend-failclosed.ts";

describe("evaluateFailClosed", () => {
	it("弱 JWT 等坏样本均被拒绝 → PASS", () => {
		const r = evaluateFailClosed();
		expect(r.status).toBe("pass");
	});

	it("特征化:弱 JWT_SECRET 确实被 checkEnv 报错", () => {
		const errs = checkEnv({
			JWT_SECRET: "secret",
			CORS_ORIGIN: "chrome-extension://abc",
		});
		expect(errs.some((e) => e.startsWith("JWT_SECRET"))).toBe(true);
	});

	it("特征化:CORS=* 确实被 checkEnv 报错", () => {
		const errs = checkEnv({
			JWT_SECRET: "a".repeat(48),
			CORS_ORIGIN: "*",
		});
		expect(errs.some((e) => e.startsWith("CORS_ORIGIN"))).toBe(true);
	});
});
