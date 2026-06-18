import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, validateEnv } from "./config/env-check.js";

function goodHash(): string {
	const salt = randomBytes(16);
	return `${salt.toString("hex")}:${scryptSync("pw", salt, 64).toString("hex")}`;
}

const strongSecret = randomBytes(48).toString("hex");
const validCors = "chrome-extension://abcdefghijklmnop";

function goodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
	return {
		JWT_SECRET: strongSecret,
		JWT_ADMIN_PASSWORD_HASH: goodHash(),
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
