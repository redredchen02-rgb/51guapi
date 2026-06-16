import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Append-only authentication audit log. Records ONLY time / ip / result —
// never the submitted password or any token, so there is nothing to redact.
// Lives outside data/ (which tests wipe); tests redirect via PUBLISHER_DATA_DIR.
// Retention: single-operator localhost keeps all records; operator archives
// manually if the file grows large (no rotation in this deployment form).
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.PUBLISHER_DATA_DIR
	? join(process.env.PUBLISHER_DATA_DIR, "logs")
	: join(__dirname, "..", "logs");

export const AUDIT_LOG_PATH = join(LOG_DIR, "auth-audit.log");

export type AuthResult =
	| "success"
	| "invalid_password"
	| "rate_limited"
	| "not_configured";

export function auditLogin(result: AuthResult, ip: string): void {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(
			AUDIT_LOG_PATH,
			`${JSON.stringify({ t: new Date().toISOString(), ip, result })}\n`,
		);
	} catch {
		// Auditing must never break the auth path.
	}
}
