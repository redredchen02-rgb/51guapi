// 抓取的可复用 SSRF/流控三件套：所有 adapter 的出站请求都应经此，绝不裸调 fetch/safeFetch。
//   1. allowlistCheck —— 每跳重过 env ∪ 渠道 allowlist（堵「加渠道→302 导向任意公网站」缺口）
//   2. enforcePathPrefix —— 操作者渠道的 path_prefix 越权即拒（抓取前，不发请求）
//   3. readBodyCapped —— 流式逐块累计、超 max_bytes 即中止（不信 content-length）
//
// generic-adapter 与脚手架 demo/template 共用同一份实现：新站点 adapter 复制 template
// 即自动继承三件套，不会漏接任何一道闸（A6-R3）。

import { getChannelByHostname } from "../channel-store.js";
import { isHostAllowed, loadSSRFAllowlist } from "../ssrf-allowlist.js";
import { SsrfError, safeFetch } from "../ssrf-guard.js";

/** 单条响应体的默认上限（无渠道记录时取此值）。 */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 每跳重过 allowlist：运行时载入 env ∪ 渠道存储，redirect 目标不在表内即拒。
 * 传给 safeFetch 的第三参；fail-closed（两源皆空 → 全拒）。
 */
export function allowlistCheck(url: URL): boolean {
	return isHostAllowed(url, loadSSRFAllowlist());
}

/**
 * U6 P0：抓取前强制单渠道 path_prefix。
 *
 * 信任边界：env 基线 allowlist（ALLOWED_HOSTS）来的 host 可能无渠道记录 —— 这种
 * 情况维持现状放行（host 命中即可爬全域），不破坏既有 env 渠道。只对「操作者经
 * channel-store 新增的渠道」强制其 pathPrefix：有渠道记录则 URL.pathname 必须以
 * pathPrefix 开头，否则抛 SsrfError 明确拒绝（不静默放行）。
 *
 * 返回该 host 的渠道记录（若有），供后续 max_bytes 取单渠道上限。
 */
export function enforcePathPrefix(
	target: URL,
): ReturnType<typeof getChannelByHostname> {
	const channel = getChannelByHostname(target.hostname);
	if (!channel) return null; // env-only host，无渠道约束 → 维持现状放行
	// 归一去尾斜杠后要求分隔符边界：prefix "/news" 只放行 "/news" 与 "/news/..."，
	// 不放行兄弟路径 "/newsletter"、"/news-admin"（startsWith 无边界会越权）。
	const prefix = (channel.pathPrefix || "/").replace(/\/+$/, "") || "/";
	const path = target.pathname;
	const ok = prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
	if (!ok) {
		throw new SsrfError(
			`URL path ${path} 不在渠道 ${target.hostname} 允许的前缀 ${prefix} 内`,
		);
	}
	return channel;
}

/**
 * U6 P0：流式读取响应体并强制 max_bytes 截断。
 *
 * 不信任 content-length（服务器可不返回或谎报）。逐块累计字节，超过 limit 即中止
 * 并抛错。redirect 跟随由 safeFetch 逐跳收敛完成，最终响应体到这层才被消费，故此
 * 处的截断也覆盖 redirect 链的最终响应体（safeFetch 内部无需改）。
 */
export async function readBodyCapped(
	res: Response,
	limit: number,
): Promise<string> {
	const body = res.body;
	if (!body) return res.text(); // 无可读流（测试桩等）→ 回退，信任 mock
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let out = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				throw new Error(`Response too large (streamed > ${limit} bytes)`);
			}
			out += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	out += decoder.decode();
	return out;
}

/**
 * 简单 adapter 的便捷封装：三件套一次到位，返回截断后的 HTML 文本。
 * 用法（脚手架范式）：`const html = await guardedFetchHtml(url, { "User-Agent": ... })`。
 * 非 2xx 抛含状态码的 Error；越权/超限抛 SsrfError/too-large。供 demo/template 与
 * 任何「抓单页→提取」的 adapter 复用，避免各自漏接闸。
 */
export async function guardedFetchHtml(
	url: string,
	headers: Record<string, string>,
): Promise<string> {
	// 抓取前按目标 hostname 强制单渠道 path_prefix（越权抛 SsrfError，不发起抓取）。
	const channel = enforcePathPrefix(new URL(url));
	const maxBytes = channel?.maxBytes ?? DEFAULT_MAX_BYTES;

	const res = await safeFetch(url, { headers }, { allowlistCheck });

	if (!res.ok) {
		res.body?.cancel();
		throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
	}

	// 流式截断：不只信 content-length，逐块累计超 maxBytes 即中止报错。
	return readBodyCapped(res, maxBytes);
}
