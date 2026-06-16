import { describe, expect, it } from "vitest";
import { checkEnv } from "./env-check.js";

describe("env-check", () => {
	const ENV_OK = {
		JWT_SECRET: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", // gitleaks:allow
		JWT_ADMIN_PASSWORD_HASH:
			"2587dfc53fd18c0195f15d615fd84f8f:d7f7f7dd3adea64d92cc5aceff2988cd2324835fc8ea2c34f3a0b873672c9013a2692bfbbde70c68449ca8e9ead0051a2303a52ecddc4aed70b2c1c468451242",
		CORS_ORIGIN: "chrome-extension://abc123",
	};

	it("reports error when JWT_SECRET is placeholder", () => {
		const errors = checkEnv({
			...ENV_OK,
			JWT_SECRET: "change-this-to-a-random-secret",
		});
		expect(errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
	});

	it("reports error when JWT_ADMIN_PASSWORD_HASH is missing", () => {
		const errors = checkEnv({
			...ENV_OK,
			JWT_ADMIN_PASSWORD_HASH: "",
		});
		expect(errors.some((e) => e.includes("JWT_ADMIN_PASSWORD_HASH"))).toBe(
			true,
		);
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

	it("reports error when REVISIT_ALLOWED_HOSTS is wildcard", () => {
		const errors = checkEnv({
			...ENV_OK,
			REVISIT_ALLOWED_HOSTS: "*",
		});
		expect(errors.some((e) => e.includes("REVISIT_ALLOWED_HOSTS"))).toBe(true);
	});
});
