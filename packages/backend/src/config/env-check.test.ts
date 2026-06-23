import { describe, expect, it } from "vitest";
import { checkEnv } from "./env-check.js";

describe("env-check", () => {
	const ENV_OK = {
		CORS_ORIGIN: "chrome-extension://abc123",
	};

	it("returns no errors for valid config", () => {
		const errors = checkEnv(ENV_OK);
		expect(errors).toEqual([]);
	});

	it("reports error when CORS_ORIGIN is wildcard", () => {
		const errors = checkEnv({
			...ENV_OK,
			CORS_ORIGIN: "*",
		});
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
	});

	it("reports error when CORS_ORIGIN is missing", () => {
		const errors = checkEnv({});
		expect(errors.some((e) => e.includes("CORS_ORIGIN"))).toBe(true);
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

	// R4:非环回 HOST 须 opt-in(双份 env-check 测试都覆盖,见 .ai-memory)。
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
