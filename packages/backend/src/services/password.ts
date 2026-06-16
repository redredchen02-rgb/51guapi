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
