import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 使用临时数据库
const _TEST_DB_PATH = join(process.cwd(), "data", "test-quality.db");

// Mock 环境变量
process.env.PUBLISHER_DATA_DIR = join(process.cwd(), "data");

import { getDb, initPendingDb } from "../scraper/pending-db.js";
import {
	getQualityStats,
	initQualityMetricsTable,
	recordQuality,
} from "./quality-metrics.js";

describe("quality-metrics", () => {
	beforeEach(() => {
		// 初始化测试数据库
		initPendingDb();
		const db = getDb();
		initQualityMetricsTable(db);
	});

	afterEach(() => {
		// 清理测试数据
		try {
			const db = getDb();
			db.exec("DELETE FROM quality_metrics");
		} catch {
			// ignore
		}
	});

	it("recordQuality 写入数据库", async () => {
		const metric = {
			id: "test-metric-1",
			topicId: "topic-1",
			overall: 0.75,
			checks: [{ name: "body_length", pass: true, score: 1, message: "达标" }],
			createdAt: new Date().toISOString(),
		};

		await recordQuality(metric);

		const db = getDb();
		const row = db
			.prepare("SELECT * FROM quality_metrics WHERE id = ?")
			.get("test-metric-1") as any;

		expect(row).toBeDefined();
		expect(row.overall).toBe(0.75);
		expect(JSON.parse(row.checks)).toHaveLength(1);
	});

	it("getQualityStats 返回正确统计", async () => {
		// 插入测试数据
		await recordQuality({
			id: "m1",
			topicId: "t1",
			overall: 0.8,
			checks: [],
			createdAt: "2026-01-01",
		});
		await recordQuality({
			id: "m2",
			topicId: "t2",
			overall: 0.5,
			checks: [],
			createdAt: "2026-01-02",
		});

		const stats = await getQualityStats();
		expect(stats.totalGenerations).toBe(2);
		expect(stats.avgScore).toBeCloseTo(0.65, 1);
		expect(stats.passRate).toBeCloseTo(0.5, 1);
	});

	it("空数据库时返回默认值", async () => {
		const stats = await getQualityStats();
		expect(stats.totalGenerations).toBe(0);
		expect(stats.avgScore).toBe(0);
		expect(stats.passRate).toBe(0);
		expect(stats.recentScores).toHaveLength(0);
	});

	it("recentScores 返回最近 10 条", async () => {
		for (let i = 0; i < 15; i++) {
			await recordQuality({
				id: `m${i}`,
				topicId: `t${i}`,
				overall: 0.5 + i * 0.03,
				checks: [],
				createdAt: `2026-01-${String(i + 1).padStart(2, "0")}`,
			});
		}

		const stats = await getQualityStats();
		expect(stats.recentScores).toHaveLength(10);
	});
});
