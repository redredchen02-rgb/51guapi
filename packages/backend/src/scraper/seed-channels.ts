// B1-U1 运行时 env 种子:把渠道种子从破坏性迁移(014 `DELETE FROM channels`+INSERT)
// 移到运行时 env,默认空、幂等、不丢已有渠道。
//
// 设计(plan B1-U1):
// - **默认空**:`SEED_CHANNELS` 未设 → no-op,保留 channels 表的 fail-closed allowlist。
// - **幂等**:按 hostname 去重(`insertChannel` 的 dedup),重启不重复种。
// - **复刻路由层校验序**:`normalizeChannelHost`(同步)→ `assertHostResolvesPublic`(DNS)→
//   `insertChannel`。**不静默绕过 DNS 校验**(否则把 SSRF 信任边界从「DNS 校验过的域名」
//   降为「env 里随便写」)。
// - **不吞错**:非法项 / DNS 失败 / `MAX_CHANNELS` 上限均 `warn` 并跳过该项继续,**绝不 crash 启动**。
// - 已被 014 删的渠道不可恢复(接受,单人自用)。

import type { LookupAddress } from "node:dns";
import {
	assertHostResolvesPublic,
	insertChannel,
	normalizeChannelHost,
} from "./channel-store.js";

// 与 channel-store.assertHostResolvesPublic 第二参一致,便于测试注入 fake DNS。
type LookupAllFn = (
	hostname: string,
	options: { all: true; verbatim: boolean },
) => Promise<LookupAddress[]>;

// 最小日志接口(fastify logger 的子集),便于测试注入。
export interface SeedLogger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
}

/** 解析 `SEED_CHANNELS`:逗号/空白/换行分隔,去空白,去重复(保留首次顺序)。 */
export function parseSeedChannels(raw: string | undefined): string[] {
	if (!raw) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const piece of raw.split(/[\s,]+/)) {
		const t = piece.trim();
		if (t && !seen.has(t)) {
			seen.add(t);
			out.push(t);
		}
	}
	return out;
}

/**
 * 从 `SEED_CHANNELS` env 种入渠道。默认空、幂等、复刻 normalize+DNS 校验、不吞错、绝不 crash。
 *
 * 在 `buildApp()` 内 `initPendingDb()` 之后 **fire-and-forget** 调用(DNS 异步,不阻塞
 * 同步 `buildApp`)。`opts.lookupFn`/`opts.raw` 为测试注入缝;生产走真 DNS + `process.env`。
 */
export async function seedChannelsFromEnv(
	log: SeedLogger,
	opts: { lookupFn?: LookupAllFn; raw?: string } = {},
): Promise<void> {
	const entries = parseSeedChannels(opts.raw ?? process.env.SEED_CHANNELS);
	if (entries.length === 0) return;

	let seeded = 0;
	for (const entry of entries) {
		// 1) 归一(同步):https / 通配 / IDN 同形 / IP-literal / punycode。
		const norm = normalizeChannelHost(entry);
		if (norm.error || !norm.hostname) {
			log.warn(`[seed] 跳过非法渠道 "${entry}": ${norm.error ?? "无法归一"}`);
			continue;
		}
		// 2+3) DNS 校验(复刻路由层,不静默绕过)+ 入库,统一 try/catch:任何抛出
		// (DNS 失败 / better-sqlite3 写错如 SQLITE_BUSY·磁盘满·I-O / getDb 未就绪)
		// 一律降级为 warn+skip,绝不让 fire-and-forget 冒泡成 unhandled rejection / crash 进程。
		try {
			await assertHostResolvesPublic(norm.hostname, opts.lookupFn);
			// 入库(幂等去重;`MAX_CHANNELS` 上限返回 error 不抛)。
			// createdBy=env-seed:与 014 迁移种子的 'seed' 区分,审计可辨来源。
			const res = insertChannel({
				hostname: norm.hostname,
				displayName: norm.hostname,
				createdBy: "env-seed",
				reason: "env SEED_CHANNELS",
			});
			if (res.error) {
				log.warn(`[seed] 跳过渠道 ${norm.hostname}: ${res.error}`);
				continue; // 不吞错:上限后续项虽必然同样失败,仍逐项 log
			}
			if (res.deduped) {
				log.info(`[seed] 渠道 ${norm.hostname} 已存在,跳过(幂等)`);
				continue;
			}
			seeded++;
			log.info(`[seed] 已种入渠道 ${norm.hostname}`);
		} catch (e) {
			log.warn(
				`[seed] 跳过渠道 ${norm.hostname}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
	if (seeded > 0) log.info(`[seed] 共种入 ${seeded} 个渠道`);
}
