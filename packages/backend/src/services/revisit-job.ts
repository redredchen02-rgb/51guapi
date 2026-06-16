import { URL } from "node:url";
import type { FastifyBaseLogger } from "fastify";
import cron from "node-cron";
import { getDb, pendingWriteQueue } from "../scraper/pending-db.js";
import { jobs } from "../scraper/scheduler.js";
import { isHostAllowed, loadSSRFAllowlist } from "../scraper/ssrf-allowlist.js";
import { safeFetch } from "../scraper/ssrf-guard.js";
import { sendAlert } from "./telegram.js";

interface RevisitDeps {
	logger?: FastifyBaseLogger;
}

interface PublishedRow {
	id: string;
	source_title: string | null;
	publish_url: string | null;
	outcome: string | null;
	created_at: string;
}

async function checkRow(row: PublishedRow, deps: RevisitDeps): Promise<void> {
	const { id, source_title, publish_url } = row;
	if (!publish_url) return;

	// Scheme gate: skip non-http(s) URLs (e.g. legacy file:// entries)
	let parsed: URL;
	try {
		parsed = new URL(publish_url);
	} catch {
		deps.logger?.warn(`[revisit] Invalid URL for post ${id}: ${publish_url}`);
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		deps.logger?.warn(
			`[revisit] Skipping non-http(s) URL for post ${id}: ${publish_url}`,
		);
		return;
	}

	// SSRF allowlist check — revisit-specific allowlist separate from scraper's
	const config = loadSSRFAllowlist({
		ALLOWED_HOSTS: process.env.REVISIT_ALLOWED_HOSTS,
	});
	if (!isHostAllowed(parsed, config)) {
		deps.logger?.warn(
			`[revisit] Host not in REVISIT_ALLOWED_HOSTS, skipping post ${id}`,
		);
		return;
	}

	const now = new Date().toISOString();
	let outcome: "online" | "failed";

	try {
		const res = await safeFetch(publish_url, { method: "HEAD" });
		if (res.status === 200) {
			outcome = "online";
		} else if (res.status === 401 || res.status === 403) {
			outcome = "failed";
			await sendAlert("后台 session 可能已过期，请重新登录");
		} else {
			// 404 / 5xx
			outcome = "failed";
			await sendAlert(`帖子不可访问: ${source_title ?? id} ${publish_url}`);
		}
	} catch {
		outcome = "failed";
		await sendAlert(`帖子不可访问: ${source_title ?? id} ${publish_url}`);
	}

	await pendingWriteQueue.enqueue(() => {
		const db = getDb();
		db.prepare(
			"UPDATE published_posts SET outcome = ?, last_checked_at = ? WHERE id = ?",
		).run(outcome, now, id);
	});
}

async function runImmediateSweep(deps: RevisitDeps): Promise<void> {
	try {
		const db = getDb();
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		const rows = db
			.prepare(
				"SELECT * FROM published_posts WHERE outcome IS NULL AND created_at > ?",
			)
			.all(twoHoursAgo) as PublishedRow[];
		for (const row of rows) {
			await checkRow(row, deps);
		}
	} catch (err) {
		deps.logger?.error(err, "[revisit] Immediate sweep error");
	}
}

const SWEEP_BATCH_SIZE = 50;

async function runHealthSweep(deps: RevisitDeps): Promise<void> {
	try {
		const db = getDb();
		let offset = 0;
		let hasMore = true;

		while (hasMore) {
			const rows = db
				.prepare(
					"SELECT * FROM published_posts WHERE outcome = 'online' LIMIT ? OFFSET ?",
				)
				.all(SWEEP_BATCH_SIZE, offset) as PublishedRow[];

			if (rows.length === 0) {
				hasMore = false;
				break;
			}

			for (const row of rows) {
				await checkRow(row, deps);
			}

			offset += rows.length;

			// 如果返回的行数小于批次大小，说明已无更多数据
			if (rows.length < SWEEP_BATCH_SIZE) {
				hasMore = false;
			}
		}
	} catch (err) {
		deps.logger?.error(err, "[revisit] Health sweep error");
	}
}

export function startRevisitJob(deps: RevisitDeps = {}): void {
	if (jobs.has("__revisit_immediate")) return;

	const immediateCron = process.env.REVISIT_IMMEDIATE_CRON ?? "*/5 * * * *";
	const healthCron = process.env.REVISIT_HEALTH_CRON ?? "0 4 * * *";

	const immediateTask = cron.schedule(immediateCron, () =>
		runImmediateSweep(deps),
	);
	jobs.set("__revisit_immediate", immediateTask);

	const healthTask = cron.schedule(healthCron, () => runHealthSweep(deps));
	jobs.set("__revisit_health", healthTask);

	deps.logger?.info("[revisit] Revisit job started");
}
