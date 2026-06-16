// 质量指标跟踪：记录每次生成的质量分，计算统计指标。
// 存入 SQLite，供监控和分析使用。

import type { QualityCheck } from "@51guapi/shared";
import { type BetterSqlite3DB, getDb } from "../scraper/pending-db.js";

export interface QualityMetric {
	id: string;
	topicId: string;
	overall: number;
	checks: QualityCheck[];
	createdAt: string;
}

interface QualityMetricRow {
	id: string;
	topic_id: string;
	overall: number;
	checks: string; // JSON
	created_at: string;
}

function _rowToMetric(row: QualityMetricRow): QualityMetric {
	let checks: QualityCheck[] = [];
	try {
		checks = JSON.parse(row.checks) as QualityCheck[];
	} catch {
		// DB 数据损坏时降级为空数组，不崩溃
	}
	return {
		id: row.id,
		topicId: row.topic_id,
		overall: row.overall,
		checks,
		createdAt: row.created_at,
	};
}

/** 初始化质量指标表。 */
export function initQualityMetricsTable(db: BetterSqlite3DB): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS quality_metrics (
			id TEXT PRIMARY KEY,
			topic_id TEXT NOT NULL,
			overall REAL NOT NULL,
			checks TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_quality_created ON quality_metrics(created_at DESC);
	`);
}

/** 记录一条质量指标。 */
export async function recordQuality(metric: QualityMetric): Promise<void> {
	const db = getDb();
	initQualityMetricsTable(db);

	db.prepare(`
		INSERT INTO quality_metrics (id, topic_id, overall, checks, created_at)
		VALUES (@id, @topicId, @overall, @checks, @createdAt)
		ON CONFLICT(id) DO UPDATE SET
			overall = excluded.overall,
			checks = excluded.checks
	`).run({
		id: metric.id,
		topicId: metric.topicId,
		overall: metric.overall,
		checks: JSON.stringify(metric.checks),
		createdAt: metric.createdAt,
	});
}

/** 获取质量统计。 */
export async function getQualityStats(): Promise<{
	avgScore: number;
	passRate: number;
	totalGenerations: number;
	recentScores: number[];
	trend: Array<{ date: string; avgScore: number; count: number }>;
}> {
	const db = getDb();

	try {
		initQualityMetricsTable(db);
	} catch {
		// 表可能已存在
	}

	const stats = db
		.prepare(`
			SELECT
				COUNT(*) as total,
				COALESCE(AVG(overall), 0) as avg_score,
				COALESCE(SUM(CASE WHEN overall >= 0.6 THEN 1 ELSE 0 END), 0) as pass_count
			FROM quality_metrics
		`)
		.get() as { total: number; avg_score: number; pass_count: number };

	// 最近 10 条分数
	const recentRows = db
		.prepare(`
			SELECT overall FROM quality_metrics
			ORDER BY created_at DESC
			LIMIT 10
		`)
		.all() as { overall: number }[];

	// 最近 7 天趋势
	const trendRows = db
		.prepare(`
			SELECT
				DATE(created_at) as date,
				AVG(overall) as avg_score,
				COUNT(*) as count
			FROM quality_metrics
			WHERE created_at >= DATE('now', '-7 days')
			GROUP BY DATE(created_at)
			ORDER BY date DESC
		`)
		.all() as { date: string; avg_score: number; count: number }[];

	return {
		avgScore: stats.avg_score,
		passRate: stats.total > 0 ? stats.pass_count / stats.total : 0,
		totalGenerations: stats.total,
		recentScores: recentRows.map((r) => r.overall),
		trend: trendRows.map((r) => ({
			date: r.date,
			avgScore: r.avg_score,
			count: r.count,
		})),
	};
}
