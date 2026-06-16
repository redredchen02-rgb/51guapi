import type { URL } from "node:url";
import { listChannels } from "./channel-store.js";

interface Pattern {
	hostname: string;
	wildcard: boolean;
	protocol?: string;
}

function compilePattern(raw: string): Pattern | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const rest = trimmed.replace(/^https?:\/\//, "").split("/")[0];
	if (!rest) return null;
	const wildcard = rest.startsWith("*.");
	const hostname = wildcard ? rest.slice(2) : rest;
	const protocol = trimmed.startsWith("http://")
		? "http:"
		: trimmed.startsWith("https://")
			? "https:"
			: undefined;
	return { hostname, wildcard, protocol };
}

function matches(pattern: Pattern, candidate: URL): boolean {
	if (pattern.protocol && candidate.protocol !== pattern.protocol) return false;
	const ch = candidate.hostname.toLowerCase();
	if (pattern.wildcard) {
		return (
			ch === pattern.hostname.toLowerCase() ||
			ch.endsWith(`.${pattern.hostname.toLowerCase()}`)
		);
	}
	return ch === pattern.hostname.toLowerCase();
}

export interface SSRFConfig {
	allowedHosts: Pattern[];
	mode: "fail-closed";
}

// env 参数化以便 env-check 等调用方传入受测环境;默认行为不变。
//
// U6:allowlist = env 基线 ∪ 操作者渠道存储(SQLite),运行时读取(非启动快照)。
// 渠道 hostname 钉死 https(渠道入库时已强制),故并入时带 protocol https,且非通配。
// fail-closed 不退化:两源皆空 → patterns 为空 → isHostAllowed 全拒(见下),
// 绝无任何分支退回硬编码默认。
export function loadSSRFAllowlist(
	env: NodeJS.ProcessEnv = process.env,
): SSRFConfig {
	const raw = env.ALLOWED_HOSTS ?? "";
	const patterns: Pattern[] = [];
	for (const part of raw.split(",")) {
		const p = compilePattern(part);
		if (p) patterns.push(p);
	}
	// 操作者动态渠道:每条钉死 https + 精确 host(非通配)。
	// DB 未初始化或读失败时静默跳过(fail-closed:渠道源缺失只会更严,不会放行)。
	try {
		for (const ch of listChannels()) {
			patterns.push({
				hostname: ch.hostname,
				wildcard: false,
				protocol: "https:",
			});
		}
	} catch {
		// 忽略:DB 未就绪时仅退化为 env 基线,不退化为放行。
	}
	return { allowedHosts: patterns, mode: "fail-closed" };
}

export function isHostAllowed(url: URL, config: SSRFConfig): boolean {
	if (config.allowedHosts.length === 0) return false;
	return config.allowedHosts.some((p) => matches(p, url));
}
