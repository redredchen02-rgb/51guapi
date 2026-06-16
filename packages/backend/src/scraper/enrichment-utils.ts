/**
 * Enrichment 工具函数
 * 统一管理 web enricher 的调用逻辑
 */

import type { FactsBlock } from "@51guapi/shared";
import type { FastifyBaseLogger } from "fastify";
import { type EnrichedContext, enrichContext } from "./web-enricher.js";

interface EnrichOptions {
	facts: FactsBlock;
	logger?: FastifyBaseLogger;
}

/**
 * 尝试执行 enrichment（静默失败）
 * 返回 enrichment 结果，失败时返回 undefined
 */
export async function tryEnrich(
	options: EnrichOptions,
): Promise<EnrichedContext | undefined> {
	const { facts, logger } = options;

	if (process.env.ENRICHMENT_ENABLED === "false") {
		return undefined;
	}

	try {
		const maxQ = Math.min(
			Math.max(Number(process.env.ENRICHMENT_MAX_QUERIES ?? "3") || 3, 1),
			10,
		);
		const enrichment = await enrichContext({ facts, maxQueries: maxQ });
		const totalResults = enrichment.queryResults.reduce(
			(sum, qr) => sum + qr.results.length,
			0,
		);
		logger?.info(`Enrichment complete: ${totalResults} results`);
		return enrichment;
	} catch (enrichErr) {
		logger?.warn(`Enrichment failed (non-fatal): ${enrichErr}`);
		return undefined;
	}
}
