import { join } from "node:path";
import type { GossipFactsBlock, Settings } from "@51guapi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 使用临时数据库
const _TEST_DB_PATH = join(process.cwd(), "data", "test-quality.db");

// Mock 环境变量
process.env.GUAPI_DATA_DIR = join(process.cwd(), "data");

import { getDb, initPendingDb } from "../scraper/pending-db.js";
import { generateDraft } from "./draft-gen.js";
import {
	__resetForTest,
	getQualityStats,
	initQualityMetricsTable,
	recordQuality,
} from "./quality-metrics.js";

describe("quality-metrics", () => {
	beforeEach(() => {
		// 每个用例从干净的 DDL 记忆开始，避免跨用例的记忆化串味。
		__resetForTest();
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

	it("DDL 记忆化：跨多次调用只执行一次 CREATE", async () => {
		// beforeEach 已先建表一次；此处复位记忆以从干净状态计数 db.exec。
		__resetForTest();
		const db = getDb();
		const execSpy = vi.spyOn(db, "exec");

		await recordQuality({
			id: "ddl-1",
			topicId: "t",
			overall: 0.5,
			checks: [],
			createdAt: "2026-01-01",
		});
		await getQualityStats();
		await recordQuality({
			id: "ddl-2",
			topicId: "t",
			overall: 0.6,
			checks: [],
			createdAt: "2026-01-02",
		});
		await getQualityStats();

		// N>=3 次会触达 initQualityMetricsTable，但 DDL exec 仅首次真正执行。
		expect(execSpy).toHaveBeenCalledTimes(1);
		execSpy.mockRestore();
	});

	it("__resetForTest 对相同 db 实例重置 DDL 记忆，下次调用重新执行 DDL", () => {
		const db = getDb();
		// 第一次：记忆已在 beforeEach 置位，再调用不触发 exec。
		const firstSpy = vi.spyOn(db, "exec");
		initQualityMetricsTable(db);
		expect(firstSpy).not.toHaveBeenCalled();
		firstSpy.mockRestore();

		// 复位后：db 实例从 WeakSet 移除，同一实例再次调用应重新执行一次 DDL。
		__resetForTest();
		const secondSpy = vi.spyOn(db, "exec");
		initQualityMetricsTable(db);
		expect(secondSpy).toHaveBeenCalledTimes(1);
		secondSpy.mockRestore();
	});

	it("getQualityStats 在真实 DB 故障时向上抛（不再静默吞）", async () => {
		const db = getDb();
		const boom = new Error("simulated DB failure");
		const prepareSpy = vi.spyOn(db, "prepare").mockImplementation(() => {
			throw boom;
		});

		await expect(getQualityStats()).rejects.toThrow("simulated DB failure");
		prepareSpy.mockRestore();
	});

	// A12(R12)端到端:证 recordQuality 真接进了 generateDraft 成功路径(此前零生产调用)。
	// 非测试直改单例——走真实 generateDraft → getQualityStats 反映。
	it("A12 集成:generateDraft 成功后 /healthz 质量随真实生成变化", async () => {
		const settings: Settings = {
			endpoint: "https://api.example.com/v1/chat/completions",
			model: "m",
			fallbackModel: "",
			promptTemplate: "",
			fewShotPairs: [],
		};
		const facts: GossipFactsBlock = {
			當事人: "甲",
			事件摘要: "摘要",
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: "緋聞",
		};
		const fetchFn = vi.fn(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					json: async () => ({
						choices: [
							{
								message: {
									content: JSON.stringify({
										intro: "引子内容更丰富更有爆料感一些",
										highlights: "看点也写得很充实很多",
									}),
								},
							},
						],
					}),
				}) as Response,
		);
		const before = await getQualityStats();
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts,
			fetchFn,
			now: () => "2026-06-22T00:00:00.000Z",
			genId: () => "draft_qm_int_1",
		});
		expect(res.ok).toBe(true);
		// recordQuality 已被 generateDraft await,解析时记录已落库。
		const after = await getQualityStats();
		expect(after.totalGenerations).toBe(before.totalGenerations + 1);
		expect(after.avgScore).toBeGreaterThan(0);
	});
});
