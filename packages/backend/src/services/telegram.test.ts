import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ssrf-guard before importing telegram so the module uses the mock
vi.mock("../scraper/ssrf-guard.js", () => ({
	assertUrlSafe: vi.fn().mockResolvedValue(new URL("https://api.telegram.org")),
}));

import { assertUrlSafe } from "../scraper/ssrf-guard.js";
import { sendAlert } from "./telegram.js";

const VALID_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";
const VALID_CHAT_ID = "99999999";

function setEnv(overrides: Record<string, string | undefined>) {
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) {
			delete process.env[k];
		} else {
			process.env[k] = v;
		}
	}
}

function cleanTgEnv() {
	delete process.env.TG_ENABLED;
	delete process.env.TG_BOT_TOKEN;
	delete process.env.TG_CHAT_ID;
	delete process.env.CORS_ORIGIN;
}

describe("sendAlert", () => {
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		cleanTgEnv();
		vi.mocked(assertUrlSafe).mockResolvedValue(
			new URL("https://api.telegram.org"),
		);
		fetchSpy = vi
			.spyOn(global, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		cleanTgEnv();
	});

	it("calls fetch with correct URL and body when TG_ENABLED=true", async () => {
		setEnv({
			TG_ENABLED: "true",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
		});
		await sendAlert("test message");

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`https://api.telegram.org/bot${VALID_TOKEN}/sendMessage`);
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({
			chat_id: VALID_CHAT_ID,
			text: "🟡 [WARNING] test message",
		});
	});

	it("does not call fetch when TG_ENABLED is absent", async () => {
		// TG_ENABLED not set
		await sendAlert("hello");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not call fetch when TG_ENABLED=false", async () => {
		setEnv({
			TG_ENABLED: "false",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
		});
		await sendAlert("hello");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("resolves without throwing when fetch rejects", async () => {
		setEnv({
			TG_ENABLED: "true",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
		});
		fetchSpy.mockRejectedValue(new Error("network failure"));
		await expect(sendAlert("boom")).resolves.toBeUndefined();
	});

	it("resolves without throwing when TG API returns 4xx", async () => {
		setEnv({
			TG_ENABLED: "true",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
		});
		fetchSpy.mockResolvedValue(new Response('{"error":true}', { status: 400 }));
		await expect(sendAlert("bad request")).resolves.toBeUndefined();
	});

	it("redacts admin domain from message and calls console.warn", async () => {
		const adminHost = "admin.secret.example.com";
		setEnv({
			TG_ENABLED: "true",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
			CORS_ORIGIN: `https://${adminHost}`,
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await sendAlert(`Error on ${adminHost}/path`);

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.text).toBe("🟡 [WARNING] Error on [REDACTED]/path");
		expect(body.text).not.toContain(adminHost);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("[telegram] admin domain redacted"),
		);
	});

	it("does not redact when message contains no admin domain", async () => {
		const adminHost = "admin.secret.example.com";
		setEnv({
			TG_ENABLED: "true",
			TG_BOT_TOKEN: VALID_TOKEN,
			TG_CHAT_ID: VALID_CHAT_ID,
			CORS_ORIGIN: `https://${adminHost}`,
		});
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		await sendAlert("plain alert with no domain");

		const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.text).toBe("🟡 [WARNING] plain alert with no domain");
		expect(warnSpy).not.toHaveBeenCalledWith(
			expect.stringContaining("redacted"),
		);
	});
});

describe("checkEnv: TG guard", () => {
	// Import checkEnv after the module is already set up
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	let checkEnv: typeof import("../config/env-check.js").checkEnv;

	beforeEach(async () => {
		const mod = await import("../config/env-check.js");
		checkEnv = mod.checkEnv;
	});

	function goodEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
		const { randomBytes, scryptSync } = require("node:crypto");
		const salt = randomBytes(16);
		const hash = `${salt.toString("hex")}:${scryptSync("pw", salt, 64).toString("hex")}`;
		return {
			JWT_SECRET: randomBytes(48).toString("hex"),
			JWT_ADMIN_PASSWORD_HASH: hash,
			CORS_ORIGIN: "chrome-extension://abcdefghijklmnop",
			...overrides,
		};
	}

	it("TG_ENABLED=true with empty TG_BOT_TOKEN → error", () => {
		const errors = checkEnv(
			goodEnv({
				TG_ENABLED: "true",
				TG_BOT_TOKEN: "",
				TG_CHAT_ID: VALID_CHAT_ID,
			}),
		);
		expect(
			errors.some((e) => e.includes("TG_BOT_TOKEN") && e.includes("missing")),
		).toBe(true);
	});

	it("TG_ENABLED=true with wrong format TG_BOT_TOKEN → error", () => {
		const errors = checkEnv(
			goodEnv({
				TG_ENABLED: "true",
				TG_BOT_TOKEN: "bad-token",
				TG_CHAT_ID: VALID_CHAT_ID,
			}),
		);
		expect(
			errors.some((e) => e.includes("TG_BOT_TOKEN") && e.includes("format")),
		).toBe(true);
	});

	it("TG_ENABLED=true with valid token but empty TG_CHAT_ID → error", () => {
		const errors = checkEnv(
			goodEnv({
				TG_ENABLED: "true",
				TG_BOT_TOKEN: VALID_TOKEN,
				TG_CHAT_ID: "",
			}),
		);
		expect(
			errors.some((e) => e.includes("TG_CHAT_ID") && e.includes("missing")),
		).toBe(true);
	});

	it("TG_ENABLED=true with valid token and chat ID → no TG errors", () => {
		const errors = checkEnv(
			goodEnv({
				TG_ENABLED: "true",
				TG_BOT_TOKEN: VALID_TOKEN,
				TG_CHAT_ID: VALID_CHAT_ID,
			}),
		);
		expect(errors.filter((e) => e.includes("TG_"))).toHaveLength(0);
	});

	it("TG_ENABLED=false → TG_BOT_TOKEN absence does NOT cause error", () => {
		const errors = checkEnv(goodEnv({ TG_ENABLED: "false" }));
		expect(errors.filter((e) => e.includes("TG_"))).toHaveLength(0);
	});

	it("TG_ENABLED absent → TG_BOT_TOKEN absence does NOT cause error", () => {
		const errors = checkEnv(goodEnv());
		expect(errors.filter((e) => e.includes("TG_"))).toHaveLength(0);
	});
});
