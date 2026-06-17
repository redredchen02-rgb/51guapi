import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

// Deny-unless-global-unicast SSRF guard for scraper fetches.
//
// Strategy: before each fetch (and on every redirect hop) resolve the host and
// select ONE public address, then PIN that exact IP to the socket via an undici
// custom-lookup dispatcher. The dispatcher's connect.lookup ignores the OS
// resolver and hands back the already-validated IP, re-checking isPublicUnicastIp
// at connect time (defence in depth). This closes the DNS-rebinding TOCTOU
// window: the IP that passed validation is the IP the socket connects to, never
// a fresh resolution. Every redirect hop re-resolves and re-pins its own IP.

export class SsrfError extends Error {}

function isPublicV4(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
	)
		return false;
	const [a, b, c] = parts as [number, number, number, number];
	if (a === 0) return false; // 0.0.0.0/8 "this host"
	if (a === 10) return false; // 10/8 private
	if (a === 127) return false; // loopback
	if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 CGNAT
	if (a === 169 && b === 254) return false; // 169.254/16 link-local
	if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 private
	if (a === 192 && b === 0 && c === 0) return false; // 192.0.0/24 IETF
	if (a === 192 && b === 0 && c === 2) return false; // 192.0.2/24 TEST-NET-1
	if (a === 192 && b === 168) return false; // 192.168/16 private
	if (a === 198 && (b === 18 || b === 19)) return false; // 198.18/15 benchmark
	if (a === 198 && b === 51 && c === 100) return false; // 198.51.100/24 TEST-NET-2
	if (a === 203 && b === 0 && c === 113) return false; // 203.0.113/24 TEST-NET-3
	if (a >= 224) return false; // 224/4 multicast, 240/4 reserved, 255.255.255.255
	return true;
}

// Parse an IPv6 string into 8 16-bit hextets, expanding "::" and any trailing
// dotted-quad. Returns null on anything malformed (caller then denies).
function parseV6Hextets(ip: string): number[] | null {
	const s = ip.split("%")[0] ?? ""; // drop zone id
	const halves = s.split("::");
	if (halves.length > 2) return null;

	const toHextets = (raw: string): number[] | null => {
		if (raw === "") return [];
		const out: number[] = [];
		for (const g of raw.split(":")) {
			if (g.includes(".")) {
				const v4 = g.split(".").map(Number);
				if (
					v4.length !== 4 ||
					v4.some((n) => Number.isNaN(n) || n < 0 || n > 255)
				)
					return null;
				out.push(
					((v4[0] ?? 0) << 8) | (v4[1] ?? 0),
					((v4[2] ?? 0) << 8) | (v4[3] ?? 0),
				);
			} else {
				if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
				out.push(Number.parseInt(g, 16));
			}
		}
		return out;
	};

	const head = toHextets(halves[0] ?? "");
	const tail = halves.length === 2 ? toHextets(halves[1] ?? "") : [];
	if (!head || !tail) return null;

	if (halves.length === 2) {
		const fill = 8 - head.length - tail.length;
		if (fill < 0) return null;
		return [...head, ...new Array(fill).fill(0), ...tail];
	}
	return head.length === 8 ? head : null;
}

function isPublicV6(ip: string): boolean {
	const hx = parseV6Hextets(ip.toLowerCase());
	if (!hx) return false;
	const embeddedV4 = () =>
		`${(hx[6] ?? 0) >> 8}.${(hx[6] ?? 0) & 0xff}.${(hx[7] ?? 0) >> 8}.${(hx[7] ?? 0) & 0xff}`;
	const highZero = hx.slice(0, 6).every((x) => x === 0);

	// :: (unspecified) and ::1 (loopback) and any ::/96 IPv4-compatible address.
	if (highZero) {
		if (hx[6] === 0) return false; // ::, ::1, ::x.x in 0.0.0.0/8 — all non-public
		return isPublicV4(embeddedV4()); // ::a.b.c.d  → validate embedded v4
	}
	// ::ffff:0:0/96 IPv4-mapped.
	if (
		hx[0] === 0 &&
		hx[1] === 0 &&
		hx[2] === 0 &&
		hx[3] === 0 &&
		hx[4] === 0 &&
		hx[5] === 0xffff
	) {
		return isPublicV4(embeddedV4());
	}
	// 64:ff9b::/96 NAT64.
	if (
		hx[0] === 0x64 &&
		hx[1] === 0xff9b &&
		hx[2] === 0 &&
		hx[3] === 0 &&
		hx[4] === 0 &&
		hx[5] === 0
	) {
		return isPublicV4(embeddedV4());
	}

	const fh = hx[0] ?? 0;
	if (fh >= 0xfc00 && fh <= 0xfdff) return false; // fc00::/7 unique-local
	if (fh >= 0xfe80 && fh <= 0xfebf) return false; // fe80::/10 link-local
	if (fh >= 0xff00) return false; // ff00::/8 multicast
	return true;
}

export function isPublicUnicastIp(ip: string): boolean {
	const kind = isIP(ip);
	if (kind === 4) return isPublicV4(ip);
	if (kind === 6) return isPublicV6(ip);
	return false;
}

// 校验结果:既校验通过的 URL,又选定的、要钉到 socket 的公网 IP。
export interface PinnedTarget {
	url: URL;
	pinnedIp: string;
	pinnedFamily: 4 | 6;
}

// 校验 + 选定一个公网 IP 钉住。assertUrlSafe(只关心拋不拋/拿 URL)在其上薄封装,保持向后兼容。
export async function resolveAndPin(rawUrl: string): Promise<PinnedTarget> {
	let u: URL;
	try {
		u = new URL(rawUrl);
	} catch {
		throw new SsrfError(`Invalid URL: ${rawUrl}`);
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw new SsrfError(`Disallowed protocol: ${u.protocol}`);
	}
	if (u.username || u.password) {
		throw new SsrfError("URL credentials not allowed");
	}
	// DNS 解析失败归一为 SsrfError(deny):与 deny-unless-public 的 fail-closed 姿态一致,
	// 让调用方一律以 SsrfError 区分「为安全而拒」,而非外泄裸 DNS 错误。
	let addrs: LookupAddress[];
	try {
		addrs = await lookup(u.hostname, { all: true, verbatim: true });
	} catch (err) {
		throw new SsrfError(
			`DNS resolution failed for ${u.hostname}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (addrs.length === 0) {
		throw new SsrfError(`No DNS records for ${u.hostname}`);
	}
	// 守卫检查全部地址(任一私网即拒,保持既有 fail-closed 语义),
	// 同时选定第一个公网地址作为要钉的 IP。
	let pinned: PinnedTarget | null = null;
	for (const { address, family } of addrs) {
		if (!isPublicUnicastIp(address)) {
			throw new SsrfError(
				`Host ${u.hostname} resolves to non-public address ${address}`,
			);
		}
		if (!pinned) {
			pinned = {
				url: u,
				pinnedIp: address,
				pinnedFamily: family === 6 ? 6 : 4,
			};
		}
	}
	// addrs 非空且全部公网,pinned 必非空;此分支为类型收窄。
	if (!pinned) {
		throw new SsrfError(`No public address for ${u.hostname}`);
	}
	return pinned;
}

export async function assertUrlSafe(rawUrl: string): Promise<URL> {
	return (await resolveAndPin(rawUrl)).url;
}

type LookupCallback = (
	err: NodeJS.ErrnoException | null,
	address: string,
	family: number,
) => void;

// undici connect.lookup 形态的回调:无视 OS 解析器,强制回传已钉 IP(连线端 == 校验端),
// 并在 connect 时再跑一次 isPublicUnicastIp(纵深;万一钉的是私网即拒)。
// 单独导出以便对「连线目标 == 校验时 IP」做确定性断言(rebinding 硬指标)。
export function makePinnedLookup(target: PinnedTarget) {
	return (_hostname: string, _options: unknown, callback: LookupCallback) => {
		if (!isPublicUnicastIp(target.pinnedIp)) {
			callback(
				new SsrfError(
					`Pinned IP ${target.pinnedIp} is non-public`,
				) as NodeJS.ErrnoException,
				"",
				0,
			);
			return;
		}
		callback(null, target.pinnedIp, target.pinnedFamily);
	};
}

// 为某一跳构造一个把已校验公网 IP 钉到 socket 的 undici dispatcher。
export function pinnedDispatcher(target: PinnedTarget): Agent {
	return new Agent({ connect: { lookup: makePinnedLookup(target) } });
}

// 每跳重过 allowlist 的回调:返回 false → 该 URL 不在 allowlist,safeFetch 拒绝。
// U6:动态渠道把信任边界降为运行期,redirect 必须逐跳重过 allowlist(不只过私网),
// 堵住「加 news-a.com,一个 302 导向任意公网站」的缺口。不传则只做私网检查(向后兼容)。
export type AllowlistCheck = (url: URL) => boolean;

export interface SafeFetchOptions {
	maxHops?: number;
	timeoutMs?: number;
	allowlistCheck?: AllowlistCheck;
}

// fetch wrapper: validates the target (and every redirect hop) before connecting.
export async function safeFetch(
	rawUrl: string,
	init: RequestInit = {},
	maxHopsOrOpts: number | SafeFetchOptions = 5,
	timeoutMsArg = 30_000,
): Promise<Response> {
	const opts: SafeFetchOptions =
		typeof maxHopsOrOpts === "number"
			? { maxHops: maxHopsOrOpts, timeoutMs: timeoutMsArg }
			: maxHopsOrOpts;
	const maxHops = opts.maxHops ?? 5;
	const timeoutMs = opts.timeoutMs ?? 30_000;
	const allowlistCheck = opts.allowlistCheck;

	let current = rawUrl;
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal =
		init.signal instanceof AbortSignal
			? AbortSignal.any([init.signal, timeoutSignal])
			: timeoutSignal;
	for (let hop = 0; hop <= maxHops; hop++) {
		// 逐跳:重新解析 + 重新选定要钉的公网 IP。
		const target = await resolveAndPin(current);
		if (allowlistCheck && !allowlistCheck(target.url)) {
			throw new SsrfError(
				`Host not in allowlist (hop ${hop}): ${target.url.hostname}`,
			);
		}
		// 该跳用钉住此 IP 的 dispatcher:连线端 IP == 刚校验通过的 IP,无 rebinding 窗口。
		const dispatcher = pinnedDispatcher(target);
		let res: Response;
		try {
			res = await fetch(current, {
				...init,
				signal,
				redirect: "manual",
				// @ts-expect-error Node fetch 支援 dispatcher 选项(类型未声明)
				dispatcher,
			});
		} finally {
			void dispatcher.close();
		}
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get("location");
			if (!loc) return res;
			current = new URL(loc, current).toString();
			continue;
		}
		return res;
	}
	throw new SsrfError(`Too many redirects (>${maxHops})`);
}
