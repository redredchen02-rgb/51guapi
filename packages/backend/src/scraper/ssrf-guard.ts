import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Deny-unless-global-unicast SSRF guard for scraper fetches.
//
// Strategy: before each fetch (and on every redirect hop) resolve the host and
// reject if any resolved address is non-public (private / loopback / link-local
// / CGNAT / IPv6 special). This is dependency-free; it does NOT pin the resolved
// IP to the socket, so a small TOCTOU window remains between this lookup and
// fetch's own resolution. That residual is bounded by the hostname allowlist
// applied upstream (scraper-routes). Full pinning would require an undici
// custom-lookup dispatcher (deliberately avoided to not add a native-fetch
// version-skew dependency).

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

export async function assertUrlSafe(rawUrl: string): Promise<URL> {
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
	for (const { address } of addrs) {
		if (!isPublicUnicastIp(address)) {
			throw new SsrfError(
				`Host ${u.hostname} resolves to non-public address ${address}`,
			);
		}
	}
	return u;
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
		const safeUrl = await assertUrlSafe(current);
		if (allowlistCheck && !allowlistCheck(safeUrl)) {
			throw new SsrfError(
				`Host not in allowlist (hop ${hop}): ${safeUrl.hostname}`,
			);
		}
		const res = await fetch(current, { ...init, signal, redirect: "manual" });
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
