import { describe, expect, it } from "vitest";
import { checkEnv } from "./env-check.js";

describe("env-check", () => {
	const ENV_OK = {
		JWT_SECRET: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", // gitleaks:allow
		CORS_ORIGIN: "chrome-extension://abc123",
	};

	it("reports error when JWT_SECRET is placeholder", () => {
		const errors = checkEnv({
			...ENV_OK,
			JWT_SECRET: "change-this-to-a-random-secret",
		});
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	// 自用模式:JWT_ADMIN_PASSWORD_HASH 不再被校验,缺失不应报错。
	it("does not require JWT_ADMIN_PASSWORD_HASH (passwordless mode)", () => {
		const errors = checkEnv(ENV_OK); // ENV_OK 不含 hash
		expect(errors).toEqual([]);
	});

	it("reports error when CORS_ORIGIN is wildcard", () => {
		const errors = checkEnv({
			...ENV_OK,
			CORS_ORIGIN: "*",
		});
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("returns no errors for valid config", () => {
		const errors = checkEnv(ENV_OK);
		expect(errors).toEqual([]);
	});

	it("checks TG_BOT_TOKEN format when TG_ENABLED", () => {
		const errors = checkEnv({
			...ENV_OK,
			TG_ENABLED: "true",
			TG_BOT_TOKEN: "",
			TG_CHAT_ID: "",
		});
		expect(errors.some((e) => e.includes("TG_BOT_TOKEN"))).toBe(true);
		expect(errors.some((e) => e.includes("TG_CHAT_ID"))).toBe(true);
	});

	// R4:非环回 HOST + 免密登入须 opt-in(双份 env-check 测试都覆盖,见 .ai-memory)。
	it("reports error when HOST is non-loopback without opt-in", () => {
		const errors = checkEnv({ ...ENV_OK, HOST: "0.0.0.0" });
		expect(errors.some((e) => e.includes("non-loopback"))).toBe(true);
	});

	it("allows non-loopback HOST with explicit ALLOW_NONLOOPBACK_AUTH opt-in", () => {
		const errors = checkEnv({
			...ENV_OK,
			HOST: "0.0.0.0",
			ALLOW_NONLOOPBACK_AUTH: "true",
		});
		expect(errors).toEqual([]);
	});

	it("loopback HOST (127.0.0.1) passes without opt-in", () => {
		expect(checkEnv({ ...ENV_OK, HOST: "127.0.0.1" })).toEqual([]);
	});
});
