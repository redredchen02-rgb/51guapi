// Fail-closed startup validation of security-critical env vars.
// Refuses to start on weak/placeholder secrets so the running instance can
// never authenticate with known defaults.

// 默认拒绝:仅 127.0.0.0/8、::1、localhost 视为环回;其余(0.0.0.0、::、::0、
// 局域网/公网 IP、主机名)一律非环回。括号/zone-id 归一后比对,避免 "[::1]" 漏判。
function isLoopbackHost(host: string): boolean {
	const h =
		host
			.trim()
			.toLowerCase()
			.replace(/^\[/, "")
			.replace(/\]$/, "")
			.split("%")[0] ?? ""; // 去 IPv6 zone id (fe80::1%en0)
	if (h === "localhost" || h === "::1") return true;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function checkEnv(env: NodeJS.ProcessEnv = process.env): string[] {
	const errors: string[] = [];

	// 自用模式(plan 2026-06-18-003 + JWT 移除):无鉴权,JWT_SECRET 不再需要。
	// CORS_ORIGIN(跨源边界)仍为 fail-closed 启动前提。

	const corsOrigin = (env.CORS_ORIGIN ?? "").trim();
	if (!corsOrigin || corsOrigin === "*") {
		errors.push(
			"CORS_ORIGIN is not set or is '*'. Set it to your extension's origin, e.g. " +
				"chrome-extension://<extension-id>. Comma-separate for dev+prod IDs. " +
				"Wildcard '*' is rejected to prevent open cross-origin access.",
		);
	}

	// 自用模式为免密登入(plan 2026-06-18-003):凡能触达后端者即可换取 token。默认绑定
	// 环回(index.ts HOST 缺省 127.0.0.1)是安全前提。若显式把 HOST 设成非环回地址
	// (0.0.0.0 / :: / 局域网 IP / 主机名),等于把免密登入暴露给同网段,故 fail-closed
	// 拒启动,除非操作者显式 opt-in。opt-in 严格布尔(=== "true",仿 TG_ENABLED):
	// "1"/"yes"/"TRUE"/"false" 均不启用。判定采"非环回即需 opt-in"的默认拒绝姿态。
	const host = (env.HOST ?? "").trim();
	if (host && !isLoopbackHost(host) && env.ALLOW_NONLOOPBACK_AUTH !== "true") {
		errors.push(
			`HOST is set to a non-loopback address (${host}) while login is passwordless. ` +
				"Anyone who can reach this host can obtain a token. Bind to 127.0.0.1 / ::1 / " +
				"localhost, or set ALLOW_NONLOOPBACK_AUTH=true to explicitly opt in.",
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
