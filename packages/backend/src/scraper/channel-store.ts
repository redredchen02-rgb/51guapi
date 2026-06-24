// U6 多渠道渠道存储 + 入库校验。
//
// 渠道 = 操作者持续新增的爬取目标域名。每条渠道的 hostname 运行时并入 SSRF allowlist
// (见 ssrf-allowlist.ts loadSSRFAllowlist 的 env ∪ 渠道存储)。
//
// 信任边界从「部署期 env 快照」降为「运行期可写攻击面」,故入库前做硬校验:
// - 钉死 https(渠道只允许 https 爬取)
// - 拒通配 `*.`(避免一次开放整棵子域树)
// - IDN 转 punycode 存储 + 拒混合脚本同形域名(防西里尔 аpple.com 之类)
// - 当场 DNS 解析候选 hostname,任一解析地址落私网/元数据 → 拒绝入库
//   (光拒 IP-literal 挡不住「A 记录指向 169.254.169.254 的合法域名」)
// - 记审计栏位(谁/何时/为何)
// - 条目数量上限(攻击面不可只增不减)

import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { domainToASCII } from "node:url";

// lookup 是重载函数,{all:true} 形态返回 LookupAddress[];显式声明便于类型与注入 mock。
type LookupAllFn = (
	hostname: string,
	options: { all: true; verbatim: boolean },
) => Promise<LookupAddress[]>;

import { DEFAULT_MAX_BYTES } from "./adapters/guarded-fetch.js";
import { getDb } from "./pending-db.js";
import { isPublicUnicastIp } from "./ssrf-guard.js";

export interface Channel {
	id: string;
	hostname: string; // punycode/ASCII 形态
	displayName: string;
	pathPrefix: string;
	// 翻页页数上限:list-discovery 跟随「下一页」最多 maxDepth 页(fetchListPaged 驱动)。
	// 预设 1 = 单页(不翻页);scheduler 与 discover 路由均读它。
	maxDepth: number;
	maxBytes: number;
	createdBy: string;
	reason: string;
	createdAt: string;
}

export const MAX_CHANNELS = 100;
// maxDepth 写入硬上限（belt-and-suspenders）:与 generic-adapter 的 MAX_PAGES 一致。
// 操作者写入的 maxDepth 即使超界,入库时也收敛到 [1, MAX_DEPTH];非法/缺省回落 1。
export const MAX_DEPTH = 50;

interface ChannelRow {
	id: string;
	hostname: string;
	display_name: string;
	path_prefix: string;
	max_depth: number;
	max_bytes: number;
	created_by: string;
	reason: string;
	created_at: string;
}

function rowToChannel(r: ChannelRow): Channel {
	return {
		id: r.id,
		hostname: r.hostname,
		displayName: r.display_name,
		pathPrefix: r.path_prefix,
		maxDepth: r.max_depth,
		maxBytes: r.max_bytes,
		createdBy: r.created_by,
		reason: r.reason,
		createdAt: r.created_at,
	};
}

/**
 * 脚本白名单:允许 ASCII(U+0000-U+007F) 与 CJK(Han/Hiragana/Katakana/Hangul),
 * 拒绝其余非 ASCII 脚本(Cyrillic/Greek/Armenian/Cherokee/Coptic 等)。
 * 纯单一非拉丁脚本同形(如纯西里尔 субер.com)也被拒，修复 isMixedScript 的漏洞。
 * 返回 true = 含不允许脚本字符(应拒绝)。
 */
function hasDisallowedScript(label: string): boolean {
	for (const ch of label) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp < 0x80) continue; // ASCII
		if (cp >= 0x4e00 && cp <= 0x9fff) continue; // CJK 统一表意
		if (cp >= 0x3400 && cp <= 0x4dbf) continue; // CJK 扩展 A
		if (cp >= 0x20000 && cp <= 0x2ceaf) continue; // CJK 扩展 B-E
		if (cp >= 0xf900 && cp <= 0xfaff) continue; // CJK 兼容
		if (cp >= 0x3040 && cp <= 0x309f) continue; // Hiragana
		if (cp >= 0x30a0 && cp <= 0x30ff) continue; // Katakana
		if (cp >= 0xac00 && cp <= 0xd7af) continue; // Hangul 音节
		if (cp >= 0x1100 && cp <= 0x11ff) continue; // Hangul 字母
		return true; // 其余非 ASCII 脚本 → 不允许
	}
	return false;
}

export interface NormalizeResult {
	hostname?: string;
	error?: string;
}

/**
 * 把操作者输入的渠道(URL 或裸域名)归一为可入库的 ASCII hostname。
 * 纯函数,不碰 DNS;供入库前同步校验(https/通配/IDN)。
 */
export function normalizeChannelHost(raw: string): NormalizeResult {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return { error: "渠道不可为空" };

	// 拒通配:操作者一次只能授权一个具体 host。
	if (trimmed.includes("*")) {
		return { error: "禁止通配 *.（每条渠道须为具体域名）" };
	}

	let hostname: string;
	if (trimmed.includes("://")) {
		let u: URL;
		try {
			u = new URL(trimmed);
		} catch {
			return { error: "非法 URL" };
		}
		// 钉死 https:渠道只允许 https 爬取。
		if (u.protocol !== "https:") {
			return { error: "渠道必须使用 https" };
		}
		if (u.username || u.password) {
			return { error: "URL 不可含凭证" };
		}
		hostname = u.hostname;
	} else {
		// 裸域名:不允许带路径/scheme 残留。
		if (trimmed.includes("/")) return { error: "请输入域名或完整 https URL" };
		hostname = trimmed;
	}

	hostname = hostname.toLowerCase().replace(/\.$/, "");
	if (!hostname) return { error: "域名为空" };

	// IP literal 一律拒(渠道只接受域名;IP 直连绕过 DNS 解析校验)。
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
		return { error: "禁止 IP 字面量,请用域名" };
	}
	if (hostname.includes(":") || /^\[.*\]$/.test(hostname)) {
		return { error: "禁止 IP 字面量,请用域名" };
	}

	// IDN 脚本白名单:允许 ASCII + CJK，拒绝 Cyrillic/Greek 等可混淆脚本(含纯单一非拉丁)。
	for (const label of hostname.split(".")) {
		if (hasDisallowedScript(label)) {
			return {
				error: "拒绝不支持脚本/同形域名(疑似 IDN homograph)",
			};
		}
	}

	// 转 punycode 存储(ASCII 形态);domainToASCII 失败返回空串。
	const ascii = domainToASCII(hostname);
	if (!ascii) return { error: "无法解析为有效域名" };

	// 基本结构:至少一个点 + 合法 ASCII host 字符。
	if (!ascii.includes(".") || !/^[a-z0-9.-]+$/.test(ascii)) {
		return { error: "非法域名格式" };
	}

	return { hostname: ascii };
}

/**
 * 入库即 DNS 解析校验:解析 hostname 的所有地址,任一落私网/元数据 → 拒。
 * 抛 Error(消息可直接回给操作者)。lookupFn 可注入以便测试 mock。
 */
export async function assertHostResolvesPublic(
	hostname: string,
	lookupFn: LookupAllFn = lookup as unknown as LookupAllFn,
): Promise<void> {
	let addrs: LookupAddress[];
	try {
		addrs = await lookupFn(hostname, { all: true, verbatim: true });
	} catch (e) {
		throw new Error(
			`DNS 解析失败(拒绝入库): ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (!Array.isArray(addrs) || addrs.length === 0) {
		throw new Error(`无 DNS 记录(拒绝入库): ${hostname}`);
	}
	for (const { address } of addrs) {
		if (!isPublicUnicastIp(address)) {
			throw new Error(`域名解析到非公网地址 ${address}(拒绝入库): ${hostname}`);
		}
	}
}

export function listChannels(): Channel[] {
	const db = getDb();
	const rows = db
		.prepare("SELECT * FROM channels ORDER BY created_at DESC")
		.all() as ChannelRow[];
	return rows.map(rowToChannel);
}

export function getChannelByHostname(hostname: string): Channel | null {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM channels WHERE hostname = ?")
		.get(hostname) as ChannelRow | undefined;
	return row ? rowToChannel(row) : null;
}

export interface CreateChannelInput {
	hostname: string; // 已归一为 ASCII
	displayName: string;
	pathPrefix?: string;
	maxDepth?: number;
	maxBytes?: number;
	createdBy: string;
	reason?: string;
}

export interface CreateChannelResult {
	channel?: Channel;
	error?: string;
	deduped?: boolean;
}

/** 写入渠道(已通过归一 + DNS 校验后调用)。处理去重与数量上限。 */
export function insertChannel(input: CreateChannelInput): CreateChannelResult {
	const db = getDb();

	const existing = getChannelByHostname(input.hostname);
	if (existing) return { channel: existing, deduped: true };

	const count = (
		db.prepare("SELECT COUNT(*) AS n FROM channels").get() as { n: number }
	).n;
	if (count >= MAX_CHANNELS) {
		return { error: `渠道数量已达上限 ${MAX_CHANNELS},请先删除旧渠道` };
	}

	const channel: Channel = {
		id: `chan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		hostname: input.hostname,
		displayName: input.displayName || input.hostname,
		pathPrefix: input.pathPrefix?.startsWith("/") ? input.pathPrefix : "/",
		// clamp 到 [1, MAX_DEPTH];非整数/≤0/缺省回落 1,超界收敛到 MAX_DEPTH。
		maxDepth:
			Number.isInteger(input.maxDepth) && (input.maxDepth as number) > 0
				? Math.min(input.maxDepth as number, MAX_DEPTH)
				: 1,
		maxBytes:
			Number.isInteger(input.maxBytes) && (input.maxBytes as number) > 0
				? (input.maxBytes as number)
				: DEFAULT_MAX_BYTES,
		createdBy: input.createdBy,
		reason: input.reason ?? "",
		createdAt: new Date().toISOString(),
	};

	db.prepare(
		`INSERT INTO channels
       (id, hostname, display_name, path_prefix, max_depth, max_bytes, created_by, reason, created_at)
     VALUES (@id, @hostname, @displayName, @pathPrefix, @maxDepth, @maxBytes, @createdBy, @reason, @createdAt)`,
	).run(channel);

	return { channel };
}

export function deleteChannel(id: string): boolean {
	const db = getDb();
	const res = db.prepare("DELETE FROM channels WHERE id = ?").run(id);
	return res.changes > 0;
}
