#!/usr/bin/env node
// Generate a scrypt password hash for JWT_ADMIN_PASSWORD_HASH.
// Output format: <saltHex>:<derivedKeyHex>  (verified with timingSafeEqual).
// Usage:
//   node packages/backend/scripts/hash-password.mjs            # prompts (hidden)
//   node packages/backend/scripts/hash-password.mjs 'password'  # arg (less safe)
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const SCRYPT_KEYLEN = 64;

function hash(password) {
	const salt = randomBytes(16);
	const dk = scryptSync(password, salt, SCRYPT_KEYLEN);
	return `${salt.toString("hex")}:${dk.toString("hex")}`;
}

function readHidden(prompt) {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
	// Mute echo of typed characters; keep the prompt and final newline visible.
	rl._writeToOutput = (s) => {
		if (s === prompt || s.endsWith("\n") || s.endsWith("\r\n"))
			rl.output.write(s);
	};
	return new Promise((resolve) => {
		rl.question(prompt, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

const argPassword = process.argv[2];
const password = argPassword || (await readHidden("Admin password: "));
if (!password || password.length < 8) {
	console.error("Password must be at least 8 characters.");
	process.exit(1);
}
console.log(`JWT_ADMIN_PASSWORD_HASH=${hash(password)}`);
