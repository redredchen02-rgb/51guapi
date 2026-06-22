import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, validateEnv } from "./config/env-check.js";

const strongSecret = randomBytes(48).toString("hex");
const validCors = "chrome-extension://abcdefghijklmnop";

function goodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
	return {
		JWT_SECRET: strongSecret,
		CORS_ORIGIN: validCors,
		...overrides,
	};
}

describe("checkEnv", () => {
	it("passes with all required fields valid", () => {
		expect(checkEnv(goodEnv())).toEqual([]);
	});

	it("rejects known placeholder secrets", () => {
		const errors = checkEnv(
			goodEnv({ JWT_SECRET: "change-this-to-a-random-secret" }),
		);
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("rejects the legacy dev secret", () => {
		const errors = checkEnv(
			goodEnv({ JWT_SECRET: "dev-secret-change-in-production" }),
		);
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("rejects a too-short secret", () => {
		const errors = checkEnv(goodEnv({ JWT_SECRET: "short" }));
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	// 自用模式(plan 2026-06-18-003):免密登入,JWT_ADMIN_PASSWORD_HASH 不再被校验。
	it("does not require admin hash (passwordless mode)", () => {
		expect(checkEnv(goodEnv({ JWT_ADMIN_PASSWORD_HASH: "" }))).toEqual([]);
		expect(
			checkEnv(goodEnv({ JWT_ADMIN_PASSWORD_HASH: "change-this" })),
		).toEqual([]);
	});

	it("rejects missing CORS_ORIGIN", () => {
		const errors = checkEnv(goodEnv({ CORS_ORIGIN: "" }));
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("rejects wildcard '*' CORS_ORIGIN", () => {
		const errors = checkEnv(goodEnv({ CORS_ORIGIN: "*" }));
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("accepts a chrome-extension:// CORS_ORIGIN", () => {
		expect(
			checkEnv(goodEnv({ CORS_ORIGIN: "chrome-extension://abc123" })),
		).toEqual([]);
	});

	it("accepts comma-separated extension origins", () => {
		expect(
			checkEnv(
				goodEnv({
					CORS_ORIGIN: "chrome-extension://abc,chrome-extension://def",
				}),
			),
		).toEqual([]);
	});

	it("validateEnv throws on bad env", () => {
		expect(() =>
			validateEnv({
				JWT_SECRET: "",
				JWT_ADMIN_PASSWORD_HASH: "",
				CORS_ORIGIN: "",
			}),
		).toThrow(/Fail-closed/);
	});

	it("validateEnv does not throw on good env", () => {
		expect(() => validateEnv(goodEnv())).not.toThrow();
	});
});

// R4:免密登入下,非环回 HOST 绑定须显式 opt-in,否则 fail-closed 拒启动。
describe("non-loopback passwordless guard (R4)", () => {
	it("HOST 未设 → 不触发(index.ts 缺省回环)", () => {
		expect(checkEnv(goodEnv())).toEqual([]);
	});

	it("环回 HOST 默认放行(无需 opt-in)", () => {
		for (const h of ["127.0.0.1", "127.0.0.53", "::1", "[::1]", "localhost"]) {
			expect(checkEnv(goodEnv({ HOST: h })), h).toEqual([]);
		}
	});

	it("非环回 HOST 无 opt-in → fail-closed 报错(种坏输入确认红)", () => {
		for (const h of [
			"0.0.0.0",
			"::",
			"::0",
			"[::]",
			"192.168.1.10",
			"10.0.0.5",
			"my-server.local",
		]) {
			const errors = checkEnv(goodEnv({ HOST: h }));
			expect(
				errors.some((e) => e.includes("non-loopback")),
				h,
			).toBe(true);
		}
	});

	it('opt-in 严格布尔:仅 ALLOW_NONLOOPBACK_AUTH="true" 放行', () => {
		// 严格 true → 放行
		expect(
			checkEnv(goodEnv({ HOST: "0.0.0.0", ALLOW_NONLOOPBACK_AUTH: "true" })),
		).toEqual([]);
		// 宽松真值/其他值 → 仍拒(不启用)
		for (const v of ["1", "yes", "TRUE", "True", "false", "0", ""]) {
			const errors = checkEnv(
				goodEnv({ HOST: "0.0.0.0", ALLOW_NONLOOPBACK_AUTH: v }),
			);
			expect(
				errors.some((e) => e.includes("non-loopback")),
				`ALLOW_NONLOOPBACK_AUTH=${v}`,
			).toBe(true);
		}
	});

	it("validateEnv 在非环回 HOST 缺 opt-in 时 throw,opt-in 后不 throw", () => {
		expect(() => validateEnv(goodEnv({ HOST: "0.0.0.0" }))).toThrow(
			/Fail-closed/,
		);
		expect(() =>
			validateEnv(goodEnv({ HOST: "0.0.0.0", ALLOW_NONLOOPBACK_AUTH: "true" })),
		).not.toThrow();
	});
});
