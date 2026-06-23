import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// channel-store 的 DNS 解析校验须 mock,避免测试依赖真实 DNS。
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { getDb, initPendingDb, resetPendingDb } from "../scraper/pending-db.js";
import { isHostAllowed, loadSSRFAllowlist } from "../scraper/ssrf-allowlist.js";
import { registerChannelRoutes } from "./channel-routes.js";

const mockLookup = vi.mocked(
	lookup as unknown as (
		h: string,
		o: { all: true; verbatim: boolean },
	) => Promise<{ address: string; family: number }[]>,
);

function resolved(...ips: string[]) {
	return ips.map((address) => ({
		address,
		family: address.includes(":") ? 6 : 4,
	}));
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	registerChannelRoutes(app);
	await app.ready();
	return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("channel-routes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		resetPendingDb();
		initPendingDb();
		getDb().exec("DELETE FROM channels");
		mockLookup.mockReset();
		app = await buildApp();
	});
	afterEach(async () => {
		await app.close();
		resetPendingDb();
	});

	it("Happy(自用模式):无手势无口令 + 公网解析 → 201,列表可见", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "51cg1.com", displayName: "51cg1" },
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.channel.hostname).toBe("51cg1.com");

		const list = await app.inject({ method: "GET", url: "/api/v1/channels" });
		expect(list.json().channels).toHaveLength(1);
	});

	it("兼容:旧客户端仍带 confirm/adminPassword 字段 → 被忽略,仍 201", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: { ...JSON_HEADERS, "x-operator-confirm": "1" },
			payload: { channel: "legacy.com", confirm: true, adminPassword: "x" },
		});
		expect(res.statusCode).toBe(201);
	});

	it("审计:created_by 固定为 'operator'", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "audit.com" },
		});
		expect(res.statusCode).toBe(201);
		expect(res.json().channel.createdBy).toBe("operator");
	});

	it("Security(入库解析):解析到 169.254.169.254 → 400 拒绝入库", async () => {
		mockLookup.mockResolvedValue(resolved("169.254.169.254"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "metadata.evil" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/非公网/);
		const list = await app.inject({ method: "GET", url: "/api/v1/channels" });
		expect(list.json().channels).toHaveLength(0);
	});

	it("Security(入库解析):解析到 10.x → 400", async () => {
		mockLookup.mockResolvedValue(resolved("10.0.0.9"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "priv.evil" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("Security(IDN):西里尔同形 аpple.com → 400,不静默放行", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "аpple.com" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/同形|homograph/i);
	});

	it("Edge(通配):*.evil.com → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "*.evil.com" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/通配/);
	});

	it("Edge(IP literal):https://127.0.0.1 → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "https://127.0.0.1/" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("Edge(去重):重复新增同域名 → 200 deduped,不增列表", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const p = { channel: "dup.com" };
		await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: p,
		});
		const res2 = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: p,
		});
		expect(res2.statusCode).toBe(200);
		expect(res2.json().deduped).toBe(true);
		const list = await app.inject({ method: "GET", url: "/api/v1/channels" });
		expect(list.json().channels).toHaveLength(1);
	});

	it("Edge(删除):删除后 allowlist 即移除,再爬被拒", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		const created = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "del.com" },
		});
		const id = created.json().channel.id;
		// 删除前在 allowlist
		expect(
			isHostAllowed(new URL("https://del.com/"), loadSSRFAllowlist({})),
		).toBe(true);
		await app.inject({ method: "DELETE", url: `/api/v1/channels/${id}` });
		// 删除后即不在 allowlist
		expect(
			isHostAllowed(new URL("https://del.com/"), loadSSRFAllowlist({})),
		).toBe(false);
	});

	it("Integration:POST 新增(env 为空)→ 同进程 loadSSRFAllowlist 立即放行(运行时读配置非启动快照)", async () => {
		mockLookup.mockResolvedValue(resolved("1.1.1.1"));
		// 新增前:env 空 → 全拒
		expect(
			isHostAllowed(new URL("https://live.com/"), loadSSRFAllowlist({})),
		).toBe(false);
		await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "live.com" },
		});
		// 新增后立即:同进程读 SQLite → 放行(env 仍空,证明并入渠道源)
		expect(
			isHostAllowed(new URL("https://live.com/"), loadSSRFAllowlist({})),
		).toBe(true);
		// 但 http 不放行(钉死 https)
		expect(
			isHostAllowed(new URL("http://live.com/"), loadSSRFAllowlist({})),
		).toBe(false);
	});

	it("Security(fail-closed):env 与渠道皆空时全拒,不退回硬编码默认", async () => {
		expect(
			isHostAllowed(new URL("https://anything.com/"), loadSSRFAllowlist({})),
		).toBe(false);
	});

	it("空/非法 URL 回错不写入", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/channels",
			headers: JSON_HEADERS,
			payload: { channel: "not a url" },
		});
		expect(res.statusCode).toBe(400);
	});
});
