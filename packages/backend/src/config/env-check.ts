// Fail-closed startup validation of security-critical env vars.
// Refuses to start on weak/placeholder secrets so the running instance can
// never authenticate with known defaults.

const WEAK_SECRETS = new Set([
	"",
	"change-this-to-a-random-secret",
	"dev-secret-change-in-production",
	"secret",
	"changeme",
	"dev-secret",
]);

// salt(16 bytes = 32 hex) : key(64 bytes = 128 hex)
const HASH_RE = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

export function checkEnv(env: NodeJS.ProcessEnv = process.env): string[] {
	const errors: string[] = [];

	const secret = env.JWT_SECRET ?? "";
	if (WEAK_SECRETS.has(secret) || secret.length < 32) {
		errors.push(
			"JWT_SECRET is missing, a known placeholder, or shorter than 32 chars. " +
				"Generate: node -e \"console.log(require('node:crypto').randomBytes(48).toString('hex'))\"",
		);
	}

	const hash = env.JWT_ADMIN_PASSWORD_HASH ?? "";
	if (!HASH_RE.test(hash)) {
		errors.push(
			"JWT_ADMIN_PASSWORD_HASH is missing or not a valid salt:key hash. " +
				"Generate: node packages/backend/scripts/hash-password.mjs",
		);
	}

	const corsOrigin = (env.CORS_ORIGIN ?? "").trim();
	if (!corsOrigin || corsOrigin === "*") {
		errors.push(
			"CORS_ORIGIN is not set or is '*'. Set it to your extension's origin, e.g. " +
				"chrome-extension://<extension-id>. Comma-separate for dev+prod IDs. " +
				"Wildcard '*' is rejected to prevent open cross-origin access.",
		);
	}

	// Web search enrichment: ENRICHMENT_MAX_QUERIES must be 1-10 if set
	const enrichmentMaxQ = (env.ENRICHMENT_MAX_QUERIES ?? "").trim();
	if (enrichmentMaxQ) {
		const n = Number(enrichmentMaxQ);
		if (!Number.isInteger(n) || n < 1 || n > 10) {
			errors.push(
				`ENRICHMENT_MAX_QUERIES must be an integer between 1 and 10 (got "${enrichmentMaxQ}"). ` +
					"Default is 3 if unset.",
			);
		}
	}

	// Revisit job: REVISIT_ALLOWED_HOSTS must not be wildcard when set
	const revisitHosts = (env.REVISIT_ALLOWED_HOSTS ?? "").trim();
	if (revisitHosts === "*") {
		errors.push(
			"REVISIT_ALLOWED_HOSTS must not be '*'. Set it to the specific hostname(s) of your self-hosted " +
				"admin panel (comma-separated). Empty = fail-closed (revisit job skips all rows).",
		);
	}

	if (env.TG_ENABLED === "true") {
		const token = (env.TG_BOT_TOKEN ?? "").trim();
		if (!token) {
			errors.push("TG_ENABLED=true but TG_BOT_TOKEN is missing or blank.");
		} else if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
			errors.push(
				"TG_BOT_TOKEN does not match the expected Bot Token format (numeric_id:secret). " +
					"Get it from @BotFather on Telegram.",
			);
		}
		if (!(env.TG_CHAT_ID ?? "").trim()) {
			errors.push("TG_ENABLED=true but TG_CHAT_ID is missing or blank.");
		}
	}

	return errors;
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
	const errors = checkEnv(env);
	if (errors.length > 0) {
		throw new Error(
			`Fail-closed env check failed:\n  - ${errors.join("\n  - ")}`,
		);
	}
}
