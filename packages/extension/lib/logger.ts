type LogLevel = "info" | "warn" | "error" | "debug";
type LogContext = Record<string, unknown>;

/**
 * Overridable dev-mode gate so tests can toggle debug logging
 * without relying on import.meta.env (which is a build-time constant).
 */
export let isDev = typeof import.meta !== "undefined" && import.meta.env?.DEV;

function formatLog(
	level: LogLevel,
	module: string,
	msg: string,
	ctx?: LogContext,
): string {
	const prefix = `[51guapi] [${level}] [${module}] ${msg}`;
	if (ctx && Object.keys(ctx).length > 0) {
		return `${prefix} ${JSON.stringify(ctx)}`;
	}
	return prefix;
}

export const logger = {
	/** Test-only hook to override the dev-mode gate. */
	__setDevForTest(v: boolean): void {
		isDev = v;
	},
	info(module: string, msg: string, ctx?: LogContext): void {
		// info always logs
		console.info(formatLog("info", module, msg, ctx));
	},

	warn(module: string, msg: string, ctx?: LogContext): void {
		console.warn(formatLog("warn", module, msg, ctx));
	},

	error(module: string, msg: string, ctx?: LogContext): void {
		console.error(formatLog("error", module, msg, ctx));
	},

	debug(module: string, msg: string, ctx?: LogContext): void {
		// Debug level gated by DEV — silent in production build
		if (isDev) {
			console.debug(formatLog("debug", module, msg, ctx));
		}
	},
};
