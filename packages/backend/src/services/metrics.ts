export const counters = {
	draftsGenerated: 0,
	draftsFailed: 0,
	batchesCompleted: 0,
	scraperRuns: { success: 0, failed: 0 },
	publishAttempts: { success: 0, failed: 0 },
};

// 指标递增收口在这里:各业务路径调用以下函数,/api/v1/metrics 才反映真实活动
// (否则 counters 永远为 0)。

export function recordDraft(ok: boolean): void {
	if (ok) counters.draftsGenerated++;
	else counters.draftsFailed++;
}

export function recordScraperRun(ok: boolean): void {
	if (ok) counters.scraperRuns.success++;
	else counters.scraperRuns.failed++;
}

export function recordPublishAttempt(ok: boolean): void {
	if (ok) counters.publishAttempts.success++;
	else counters.publishAttempts.failed++;
}

export function recordBatchCompleted(): void {
	counters.batchesCompleted++;
}

export function getMetrics(): string {
	const lines = [
		"# HELP publisher_drafts_total Total drafts generated",
		"# TYPE publisher_drafts_total counter",
		`publisher_drafts_total{status="success"} ${counters.draftsGenerated}`,
		`publisher_drafts_total{status="failed"} ${counters.draftsFailed}`,
		"",
		"# HELP publisher_batches_total Total batches completed",
		"# TYPE publisher_batches_total counter",
		`publisher_batches_total ${counters.batchesCompleted}`,
		"",
		"# HELP publisher_scraper_runs_total Total scraper runs",
		"# TYPE publisher_scraper_runs_total counter",
		`publisher_scraper_runs_total{status="success"} ${counters.scraperRuns.success}`,
		`publisher_scraper_runs_total{status="failed"} ${counters.scraperRuns.failed}`,
		"",
		"# HELP publisher_publish_attempts_total Total publish attempts",
		"# TYPE publisher_publish_attempts_total counter",
		`publisher_publish_attempts_total{status="success"} ${counters.publishAttempts.success}`,
		`publisher_publish_attempts_total{status="failed"} ${counters.publishAttempts.failed}`,
	];
	return `${lines.join("\n")}\n`;
}
