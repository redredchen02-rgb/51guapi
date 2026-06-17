import { scryptSync, timingSafeEqual } from "node:crypto";

// scrypt-based admin password verification.
// Stored format: <saltHex>:<derivedKeyHex>  (16-byte salt, 64-byte key).
// Generate with: node packages/backend/scripts/hash-password.mjs
const KEYLEN = 64;

export function verifyPassword(password: string, storedHash: string): boolean {
	const [saltHex, keyHex] = storedHash.split(":");
	if (!saltHex || !keyHex) return false;

	let key: Buffer;
	try {
		key = Buffer.from(keyHex, "hex");
	} catch {
		return false;
	}
	// Guard length BEFORE timingSafeEqual (it throws on unequal lengths).
	if (key.length !== KEYLEN) return false;

	const derived = scryptSync(password, Buffer.from(saltHex, "hex"), KEYLEN);
	return timingSafeEqual(derived, key);
}

// Verify a password against the configured admin hash (JWT_ADMIN_PASSWORD_HASH).
// Shared by auth login and channel-write step-up so the comparison lives in one
// place. Returns false (never throws) when the hash is unconfigured or wrong.
export function verifyAdminPassword(password: unknown): boolean {
	const adminHash = process.env.JWT_ADMIN_PASSWORD_HASH;
	if (!adminHash || typeof password !== "string" || password.length === 0) {
		return false;
	}
	return verifyPassword(password, adminHash);
}
