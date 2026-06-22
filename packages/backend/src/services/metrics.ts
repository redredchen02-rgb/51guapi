export const counters = {
	draftsGenerated: 0,
	draftsFailed: 0,
	scraperRuns: { success: 0, failed: 0 },
	// 入池前验证关产出(plan 004):供观察硬拒率/疑似重复率/时间窗跳过率,
	// 据此判断有效性阈值是否过紧、指纹基是否太窄、发布时间覆盖是否过低。
	gossipVerify: {
		skippedOld: 0,
		rejected: 0,
		flagged: 0,
		suspectedDuplicate: 0,
	},
};

// 指标递增收口在这里:各业务路径调用以下函数,/api/v1/metrics 才反映真实活动
// (否则 counters 永远为 0)。

export function recordDraft(ok: boolean): void {
	if (ok) counters.draftsGenerated++;
	else counters.draftsFailed++;
}

/**
 * 记录一次 gossip 内容爬取事件。仅由 gossip-routes POST /gossip/topics/from-url 调用。
 * ok=true 表示 fetchContent + gossipExtractFacts + pending 存储全部成功（201）；
 * ok=false 表示 fetch 或提取失败（502）。409 重复 URL 早退，不计数。
 */
export function recordScraperRun(ok: boolean): void {
	if (ok) counters.scraperRuns.success++;
	else counters.scraperRuns.failed++;
}

/** 入池前验证关的产出类别(from-url 各分支调用,供 /metrics 观察)。 */
export type GossipVerifyOutcome =
	| "skipped_old"
	| "rejected"
	| "flagged"
	| "suspected_duplicate";

/** 记录一次验证关产出。skipped_old=窗外跳过;rejected=明确无效硬拒;
 * flagged=带软标入池;suspected_duplicate=内容指纹命中(可与 flagged 同时发生)。 */
export function recordGossipVerify(outcome: GossipVerifyOutcome): void {
	switch (outcome) {
		case "skipped_old":
			counters.gossipVerify.skippedOld++;
			break;
		case "rejected":
			counters.gossipVerify.rejected++;
			break;
		case "flagged":
			counters.gossipVerify.flagged++;
			break;
		case "suspected_duplicate":
			counters.gossipVerify.suspectedDuplicate++;
			break;
	}
}

export function getMetrics(): string {
	const lines = [
		"# HELP guapi_drafts_total Total drafts generated",
		"# TYPE guapi_drafts_total counter",
		`guapi_drafts_total{status="success"} ${counters.draftsGenerated}`,
		`guapi_drafts_total{status="failed"} ${counters.draftsFailed}`,
		"",
		"# HELP guapi_scraper_runs_total Total gossip content fetch+extraction events by gossip-routes",
		"# TYPE guapi_scraper_runs_total counter",
		`guapi_scraper_runs_total{status="success"} ${counters.scraperRuns.success}`,
		`guapi_scraper_runs_total{status="failed"} ${counters.scraperRuns.failed}`,
		"",
		"# HELP guapi_gossip_verify_total Gossip pre-pending verification outcomes",
		"# TYPE guapi_gossip_verify_total counter",
		`guapi_gossip_verify_total{outcome="skipped_old"} ${counters.gossipVerify.skippedOld}`,
		`guapi_gossip_verify_total{outcome="rejected"} ${counters.gossipVerify.rejected}`,
		`guapi_gossip_verify_total{outcome="flagged"} ${counters.gossipVerify.flagged}`,
		`guapi_gossip_verify_total{outcome="suspected_duplicate"} ${counters.gossipVerify.suspectedDuplicate}`,
	];
	return `${lines.join("\n")}\n`;
}
