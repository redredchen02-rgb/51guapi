import { beforeEach, describe, expect, it } from "vitest";

import { getDb, initPendingDb } from "./pending-db.js";
import {
	deletePendingTopic,
	listPendingTopics,
	loadPendingTopic,
	type PendingTopic,
	savePendingTopic,
	updatePendingTopicStatus,
} from "./pending-store.js";

/** 初始化一次 DB 单例，每次测试前清空表（比重建文件快且无单例问题）。 */
function resetDb() {
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics");
}

function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
	const now = new Date().toISOString();
	return {
		id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		sourceUrl: "https://example-site.com/article/123",
		siteName: "example-site",
		title: "测试作品 #1",
		facts: { 作品名: "测试作品", 简介: "一段简介" },
		confidence: 0.85,
		status: "pending",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("pending-store (SQLite)", () => {
	beforeEach(() => {
		resetDb();
	});

	// ---- savePendingTopic / loadPendingTopic ----

	it("save → load: 字段完整往返", async () => {
		const topic = makeTopic({
			coverImageUrl: "https://cdn.example.com/cover.jpg",
		});
		await savePendingTopic(topic);
		const loaded = await loadPendingTopic(topic.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.title).toBe(topic.title);
		expect(loaded?.siteName).toBe("example-site");
		expect(loaded?.confidence).toBe(0.85);
		expect(loaded?.status).toBe("pending");
		expect(loaded?.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
		expect((loaded?.facts as Record<string, unknown>).作品名).toBe("测试作品");
	});

	it("load 不存在的 id → null", async () => {
		const result = await loadPendingTopic("nonexistent-id");
		expect(result).toBeNull();
	});

	it("save 同 id 两次 → upsert，以最新值为准", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		const updated = { ...topic, title: "更新后标题" };
		await savePendingTopic(updated);
		const loaded = await loadPendingTopic(topic.id);
		expect(loaded?.title).toBe("更新后标题");
	});

	it("savePendingTopic 自动刷新 updatedAt", async () => {
		const topic = makeTopic();
		const before = topic.updatedAt;
		await new Promise((r) => setTimeout(r, 10));
		await savePendingTopic(topic);
		const loaded = await loadPendingTopic(topic.id);
		expect(loaded?.updatedAt !== undefined && loaded.updatedAt >= before).toBe(
			true,
		);
	});

	// ---- listPendingTopics ----

	it("空 DB → 返回空数组", async () => {
		const list = await listPendingTopics();
		expect(list).toEqual([]);
	});

	it("listPendingTopics 无筛选 → 返回所有记录，按 created_at DESC", async () => {
		const t1 = makeTopic({
			id: "id-1",
			sourceUrl: "https://example-site.com/list/1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const t2 = makeTopic({
			id: "id-2",
			sourceUrl: "https://example-site.com/list/2",
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		await savePendingTopic(t1);
		await savePendingTopic(t2);
		const list = await listPendingTopics();
		expect(list.length).toBe(2);
		expect(list[0].id).toBe("id-2"); // newest first
	});

	it("listPendingTopics(status) → 只返回对应状态", async () => {
		const pending = makeTopic({
			id: "p1",
			sourceUrl: "https://example-site.com/status/p1",
			status: "pending",
		});
		const approved = makeTopic({
			id: "a1",
			sourceUrl: "https://example-site.com/status/a1",
			status: "approved",
		});
		await savePendingTopic(pending);
		await savePendingTopic(approved);
		const pendingList = await listPendingTopics(50, "pending");
		expect(pendingList.every((t) => t.status === "pending")).toBe(true);
		expect(pendingList.find((t) => t.id === "a1")).toBeUndefined();
	});

	it("listPendingTopics(limit) → 最多返回 limit 条", async () => {
		for (let i = 0; i < 5; i++)
			await savePendingTopic(
				makeTopic({ sourceUrl: `https://example-site.com/limit/${i}` }),
			);
		const list = await listPendingTopics(3);
		expect(list.length).toBe(3);
	});

	// ---- deletePendingTopic ----

	it("delete → 记录消失", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		await deletePendingTopic(topic.id);
		const loaded = await loadPendingTopic(topic.id);
		expect(loaded).toBeNull();
	});

	it("delete 不存在的 id → 不抛出", async () => {
		await expect(deletePendingTopic("ghost-id")).resolves.toBeUndefined();
	});

	// ---- updatePendingTopicStatus ----

	it("approve → status 变更，updatedAt 刷新", async () => {
		const topic = makeTopic({ status: "pending" });
		await savePendingTopic(topic);
		await new Promise((r) => setTimeout(r, 10));
		const updated = await updatePendingTopicStatus(topic.id, "approved");
		expect(updated).not.toBeNull();
		expect(updated?.status).toBe("approved");
		expect((updated?.updatedAt as string) > topic.updatedAt).toBe(true);
	});

	it("reject with reason → rejectedReason 被保存", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		const updated = await updatePendingTopicStatus(
			topic.id,
			"rejected",
			"内容质量不足",
		);
		expect(updated?.status).toBe("rejected");
		expect(updated?.rejectedReason).toBe("内容质量不足");
	});

	it("updatePendingTopicStatus 不存在的 id → null", async () => {
		const result = await updatePendingTopicStatus("ghost-id", "approved");
		expect(result).toBeNull();
	});

	// ---- source_url 去重 (migration 004) ----

	it("新 sourceUrl → inserted: true", async () => {
		const topic = makeTopic({
			id: "dedup-1",
			sourceUrl: "https://example-site.com/unique/A",
		});
		const result = await savePendingTopic(topic);
		expect(result).toEqual({ inserted: true });
	});

	it("相同 sourceUrl 不同 id → inserted: false，DB 只有一条记录", async () => {
		const urlA = "https://example-site.com/unique/B";
		const first = makeTopic({ id: "dedup-first", sourceUrl: urlA });
		const duplicate = makeTopic({ id: "dedup-second", sourceUrl: urlA });
		await savePendingTopic(first);
		const result = await savePendingTopic(duplicate);
		expect(result).toEqual({ inserted: false });
		// DB 中只应保留第一条
		const rows = await listPendingTopics(10);
		const matches = rows.filter((t) => t.sourceUrl === urlA);
		expect(matches.length).toBe(1);
		expect(matches[0].id).toBe("dedup-first");
	});

	it("相同 sourceUrl 相同 id → upsert 成功，inserted: false，标题已更新", async () => {
		const urlA = "https://example-site.com/unique/C";
		const topic = makeTopic({
			id: "dedup-same",
			sourceUrl: urlA,
			title: "旧标题",
		});
		await savePendingTopic(topic);
		const updated = { ...topic, title: "新标题" };
		const result = await savePendingTopic(updated);
		expect(result).toEqual({ inserted: false });
		const loaded = await loadPendingTopic("dedup-same");
		expect(loaded?.title).toBe("新标题");
	});

	it("两个不同 sourceUrl → 各自 inserted: true，DB 保留两条", async () => {
		const t1 = makeTopic({
			id: "dedup-a",
			sourceUrl: "https://example-site.com/unique/D1",
		});
		const t2 = makeTopic({
			id: "dedup-b",
			sourceUrl: "https://example-site.com/unique/D2",
		});
		const r1 = await savePendingTopic(t1);
		const r2 = await savePendingTopic(t2);
		expect(r1).toEqual({ inserted: true });
		expect(r2).toEqual({ inserted: true });
		const rows = await listPendingTopics(10);
		expect(rows.length).toBe(2);
	});

	it("忽略返回值的调用方仍能正常工作（向后兼容）", async () => {
		const topic = makeTopic({
			id: "compat-1",
			sourceUrl: "https://example-site.com/unique/E",
		});
		// 模拟旧调用方：不使用返回值
		await savePendingTopic(topic);
		const loaded = await loadPendingTopic("compat-1");
		expect(loaded).not.toBeNull();
		expect(loaded?.title).toBe(topic.title);
	});

	// ---- rawContent JSON 往返 ----

	it("rawContent 序列化 → 反序列化字段完整", async () => {
		const topic = makeTopic({
			rawContent: {
				title: "原始标题",
				body: "<p>正文</p>",
				url: "https://example-site.com/detail",
				metadata: { 制作: "Studio X" },
				coverImageUrl: "https://cdn.example.com/img.jpg",
			},
		});
		await savePendingTopic(topic);
		const loaded = await loadPendingTopic(topic.id);
		expect(loaded?.rawContent?.title).toBe("原始标题");
		expect(loaded?.rawContent?.metadata?.制作).toBe("Studio X");
		expect(loaded?.rawContent?.coverImageUrl).toBe(
			"https://cdn.example.com/img.jpg",
		);
	});

	it("listPendingTopics(domain='gossip') 只返回 gossip 記錄，不包含 acg", async () => {
		await savePendingTopic(
			makeTopic({ sourceUrl: "https://acgs.com/1", domain: "acg" }),
		);
		const gossipFacts = {
			當事人: "A",
			事件摘要: null,
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		};
		await savePendingTopic(
			makeTopic({
				sourceUrl: "https://gossip.com/1",
				domain: "gossip",
				facts: gossipFacts,
			}),
		);
		await savePendingTopic(
			makeTopic({
				sourceUrl: "https://gossip.com/2",
				domain: "gossip",
				facts: { ...gossipFacts, 當事人: "B" },
			}),
		);

		const gossipList = await listPendingTopics(
			50,
			undefined,
			undefined,
			"gossip",
		);
		expect(gossipList).toHaveLength(2);
		expect(gossipList.every((t) => t.domain === "gossip")).toBe(true);

		const acgList = await listPendingTopics(50, undefined, undefined, "acg");
		expect(acgList.every((t) => t.domain === "acg")).toBe(true);
	});
});
