import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// node:fs named exports can't be spied on in ESM (the namespace is frozen), so
// mock the module up front. By default every fn delegates to the real impl;
// individual swallow-all tests override appendFileSync/mkdirSync per-call.
vi.mock("node:fs", async (importActual) => {
	const actual = await importActual<typeof import("node:fs")>();
	return {
		...actual,
		mkdirSync: vi.fn(actual.mkdirSync),
		appendFileSync: vi.fn(actual.appendFileSync),
	};
});

import { appendFileSync, mkdirSync } from "node:fs";
import { AUDIT_LOG_PATH, type AuthResult, auditLogin } from "./audit-log.js";

// Read the audit log back as parsed JSON lines (newline-delimited, no trailing).
function readLines(): Array<Record<string, unknown>> {
	if (!existsSync(AUDIT_LOG_PATH)) return [];
	return readFileSync(AUDIT_LOG_PATH, "utf8")
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l));
}

describe("auditLogin", () => {
	beforeEach(() => {
		// Start from an empty log so line counts are deterministic.
		rmSync(AUDIT_LOG_PATH, { force: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(AUDIT_LOG_PATH, { force: true });
	});

	it("writes ONLY {t,ip,result} — no password/token key, no secret value", () => {
		auditLogin("success", "203.0.113.7");

		const lines = readLines();
		expect(lines).toHaveLength(1);
		const entry = lines[0];
		// Exact key set: time, ip, result. Nothing else may ride along.
		expect(Object.keys(entry).sort()).toEqual(["ip", "result", "t"]);
		expect(entry.ip).toBe("203.0.113.7");
		expect(entry.result).toBe("success");
		expect(typeof entry.t).toBe("string");
		// Negative leak assertions on the raw serialized line.
		const raw = readFileSync(AUDIT_LOG_PATH, "utf8");
		expect(raw).not.toContain("password");
		expect(raw).not.toContain("token");
		expect(raw).not.toContain("secret");
	});

	it("is append-only — two calls add exactly two JSON lines", () => {
		auditLogin("success", "203.0.113.7");
		auditLogin("invalid_password", "198.51.100.2");

		const lines = readLines();
		expect(lines).toHaveLength(2);
		expect(lines[0].ip).toBe("203.0.113.7");
		expect(lines[0].result).toBe("success");
		expect(lines[1].ip).toBe("198.51.100.2");
		expect(lines[1].result).toBe("invalid_password");

		// Newline-delimited with a trailing newline, no concatenation.
		const raw = readFileSync(AUDIT_LOG_PATH, "utf8");
		expect(raw.endsWith("\n")).toBe(true);
		expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
	});

	it("round-trips every AuthResult value verbatim", () => {
		const results: AuthResult[] = [
			"success",
			"invalid_password",
			"rate_limited",
			"not_configured",
		];
		for (const result of results) {
			auditLogin(result, "192.0.2.1");
		}

		const lines = readLines();
		expect(lines.map((l) => l.result)).toEqual(results);
	});

	it("does not throw when appendFileSync throws", () => {
		vi.mocked(appendFileSync).mockImplementationOnce(() => {
			throw new Error("disk full");
		});
		expect(() => auditLogin("rate_limited", "192.0.2.9")).not.toThrow();
	});

	it("does not throw when mkdirSync throws", () => {
		vi.mocked(mkdirSync).mockImplementationOnce(() => {
			throw new Error("EACCES");
		});
		expect(() => auditLogin("not_configured", "192.0.2.10")).not.toThrow();
	});
});

describe("AUDIT_LOG_PATH derivation (frozen at import)", () => {
	const ORIGINAL_GUAPI = process.env.GUAPI_DATA_DIR;

	afterEach(() => {
		if (ORIGINAL_GUAPI === undefined) delete process.env.GUAPI_DATA_DIR;
		else process.env.GUAPI_DATA_DIR = ORIGINAL_GUAPI;
		vi.resetModules();
	});

	it("derives the path under GUAPI_DATA_DIR/logs/auth-audit.log", async () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi-audit-derive";
		vi.resetModules();
		const mod = await import("./audit-log.js");
		expect(mod.AUDIT_LOG_PATH).toBe(
			"/tmp/guapi-audit-derive/logs/auth-audit.log",
		);
	});
});
