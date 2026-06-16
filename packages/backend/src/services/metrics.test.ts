import { beforeEach, describe, expect, it } from "vitest";
import {
	counters,
	getMetrics,
	recordBatchCompleted,
	recordDraft,
	recordPublishAttempt,
	recordScraperRun,
} from "./metrics.js";

function resetCounters() {
	counters.draftsGenerated = 0;
	counters.draftsFailed = 0;
	counters.batchesCompleted = 0;
	counters.scraperRuns.success = 0;
	counters.scraperRuns.failed = 0;
	counters.publishAttempts.success = 0;
	counters.publishAttempts.failed = 0;
}

describe("metrics", () => {
	beforeEach(() => {
		resetCounters();
	});

	it("全零时输出 Prometheus 格式，所有计数器为 0", () => {
		const out = getMetrics();
		expect(out).toContain('publisher_drafts_total{status="success"} 0');
		expect(out).toContain('publisher_drafts_total{status="failed"} 0');
		expect(out).toContain("publisher_batches_total 0");
		expect(out).toContain('publisher_scraper_runs_total{status="success"} 0');
		expect(out).toContain(
			'publisher_publish_attempts_total{status="failed"} 0',
		);
	});

	it("每个指标都带 HELP/TYPE 注释行", () => {
		const out = getMetrics();
		expect(out).toContain("# HELP publisher_drafts_total");
		expect(out).toContain("# TYPE publisher_drafts_total counter");
		expect(out).toContain("# HELP publisher_batches_total");
		expect(out).toContain("# TYPE publisher_scraper_runs_total counter");
		expect(out).toContain("# TYPE publisher_publish_attempts_total counter");
	});

	it("计数器递增后反映在输出中", () => {
		counters.draftsGenerated = 5;
		counters.draftsFailed = 2;
		counters.batchesCompleted = 3;
		counters.scraperRuns.success = 7;
		counters.scraperRuns.failed = 1;
		counters.publishAttempts.success = 4;
		counters.publishAttempts.failed = 6;

		const out = getMetrics();
		expect(out).toContain('publisher_drafts_total{status="success"} 5');
		expect(out).toContain('publisher_drafts_total{status="failed"} 2');
		expect(out).toContain("publisher_batches_total 3");
		expect(out).toContain('publisher_scraper_runs_total{status="success"} 7');
		expect(out).toContain('publisher_scraper_runs_total{status="failed"} 1');
		expect(out).toContain(
			'publisher_publish_attempts_total{status="success"} 4',
		);
		expect(out).toContain(
			'publisher_publish_attempts_total{status="failed"} 6',
		);
	});

	it("输出以换行结尾（Prometheus 抓取要求）", () => {
		expect(getMetrics().endsWith("\n")).toBe(true);
	});

	it("recordDraft 递增正确计数器", () => {
		recordDraft(true);
		expect(counters.draftsGenerated).toBe(1);
		recordDraft(false);
		expect(counters.draftsFailed).toBe(1);
	});

	it("recordScraperRun 递增正确计数器", () => {
		recordScraperRun(true);
		expect(counters.scraperRuns.success).toBe(1);
		recordScraperRun(false);
		expect(counters.scraperRuns.failed).toBe(1);
	});

	it("recordPublishAttempt 递增正确计数器", () => {
		recordPublishAttempt(true);
		expect(counters.publishAttempts.success).toBe(1);
		recordPublishAttempt(false);
		expect(counters.publishAttempts.failed).toBe(1);
	});

	it("recordBatchCompleted 递增计数器", () => {
		recordBatchCompleted();
		expect(counters.batchesCompleted).toBe(1);
	});
});
