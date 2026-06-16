import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPassword } from "../services/password.js";

function makeHash(pw: string): string {
	const salt = randomBytes(16);
	return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

describe("verifyPassword", () => {
	it("returns true for the correct password", () => {
		const hash = makeHash("correct horse battery staple");
		expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
	});

	it("returns false for a wrong password", () => {
		const hash = makeHash("right-one");
		expect(verifyPassword("wrong-one", hash)).toBe(false);
	});

	it("returns false for a malformed hash (no colon)", () => {
		expect(verifyPassword("x", "not-a-valid-hash")).toBe(false);
	});

	it("returns false when the key length is wrong (no timingSafeEqual throw)", () => {
		const salt = randomBytes(16).toString("hex");
		// 8-byte key instead of 64 — must be rejected without throwing.
		expect(verifyPassword("x", `${salt}:${"ab".repeat(8)}`)).toBe(false);
	});

	it("does not throw on empty or very long input", () => {
		const hash = makeHash("pw");
		expect(verifyPassword("", hash)).toBe(false);
		expect(verifyPassword("z".repeat(10000), hash)).toBe(false);
	});
});
