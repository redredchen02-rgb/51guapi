import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type assertHostResolvesPublic,
	insertChannel,
	listChannels,
	MAX_CHANNELS,
} from "./channel-store.js";
import { getDb, initPendingDb, resetPendingDb } from "./pending-db.js";
import { parseSeedChannels, seedChannelsFromEnv } from "./seed-channels.js";

// 注入 fake DNS:返回给定 IP 列表(family 由是否含冒号推断)。
function fakeLookup(...ips: string[]) {
	return vi.fn(async () =>
		ips.map((address) => ({
			address,
			family: address.includes(":") ? 6 : 4,
		})),
	) as unknown as Parameters<typeof assertHostResolvesPublic>[1];
}

function makeLog() {
	return { info: vi.fn(), warn: vi.fn() };
}

describe("parseSeedChannels", () => {
	it("空/未设 → 空数组", () => {
		expect(parseSeedChannels(undefined)).toEqual([]);
		expect(parseSeedChannels("")).toEqual([]);
		expect(parseSeedChannels("   ")).toEqual([]);
	});

	it("逗号/空白/换行分隔 + 去重 + 保序", () => {
		expect(parseSeedChannels("a.com, b.com\n a.com  c.com")).toEqual([
			"a.com",
			"b.com",
			"c.com",
		]);
	});
});

describe("seedChannelsFromEnv", () => {
	beforeEach(() => {
		resetPendingDb();
		initPendingDb();
		// 014 迁移预种 51cg1.com;清空 channels 表以隔离测试种子函数本身。
		getDb().prepare("DELETE FROM channels").run();
	});
	afterEach(() => {
		resetPendingDb();
	});

	it("默认空(无 SEED_CHANNELS)→ 不种任何渠道、不 warn", async () => {
		const log = makeLog();
		await seedChannelsFromEnv(log, { raw: undefined, lookupFn: fakeLookup() });
		expect(listChannels()).toHaveLength(0);
		expect(log.warn).not.toHaveBeenCalled();
	});

	it("合法域名 → 种入;重跑幂等(不重复)", async () => {
		const log = makeLog();
		await seedChannelsFromEnv(log, {
			raw: "good-a.com, https://good-b.com/path",
			lookupFn: fakeLookup("93.184.216.34"),
		});
		expect(
			listChannels()
				.map((c) => c.hostname)
				.sort(),
		).toEqual(["good-a.com", "good-b.com"]);
		// 重跑同样输入 → 仍 2 个(按 hostname 去重),且 createdBy=seed。
		await seedChannelsFromEnv(log, {
			raw: "good-a.com, good-b.com",
			lookupFn: fakeLookup("93.184.216.34"),
		});
		expect(listChannels()).toHaveLength(2);
		expect(listChannels()[0]?.createdBy).toBe("env-seed");
	});

	it("非法项(通配/IP literal)被跳过并 warn,合法项仍种入", async () => {
		const log = makeLog();
		await seedChannelsFromEnv(log, {
			raw: "*.evil.com, 1.2.3.4, good.com",
			lookupFn: fakeLookup("93.184.216.34"),
		});
		expect(listChannels().map((c) => c.hostname)).toEqual(["good.com"]);
		// 通配 + IP literal 两项各一次 warn。
		expect(log.warn).toHaveBeenCalledTimes(2);
	});

	it("DNS 解析落私网 → 拒绝入库(不 crash),warn 提示", async () => {
		const log = makeLog();
		await seedChannelsFromEnv(log, {
			raw: "internal-looks-ok.com",
			lookupFn: fakeLookup("10.0.0.5"),
		});
		expect(listChannels()).toHaveLength(0);
		expect(log.warn).toHaveBeenCalledTimes(1);
		expect(log.warn.mock.calls[0]?.[0]).toMatch(/非公网/);
	});

	it("DNS 解析失败 → 跳过、不 crash", async () => {
		const log = makeLog();
		const throwingLookup = vi.fn(async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as Parameters<typeof assertHostResolvesPublic>[1];
		await seedChannelsFromEnv(log, {
			raw: "no-such-domain.invalid",
			lookupFn: throwingLookup,
		});
		expect(listChannels()).toHaveLength(0);
		expect(log.warn).toHaveBeenCalledTimes(1);
	});

	it("对已存在渠道(如 014 预种)去重,不产生重复", async () => {
		const log = makeLog();
		// 模拟 014 迁移已预种的 51cg1.com。
		insertChannel({
			hostname: "51cg1.com",
			displayName: "51cg1",
			createdBy: "migration",
		});
		await seedChannelsFromEnv(log, {
			raw: "51cg1.com",
			lookupFn: fakeLookup("93.184.216.34"),
		});
		expect(
			listChannels().filter((c) => c.hostname === "51cg1.com"),
		).toHaveLength(1);
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining("已存在"));
	});

	it("达 MAX_CHANNELS 上限 → insertChannel 返回 error、warn、不抛、不越上限", async () => {
		const log = makeLog();
		// 灌满到上限(直接 insertChannel 造库存,绕过 normalize/DNS)。
		for (let i = 0; i < MAX_CHANNELS; i++) {
			insertChannel({
				hostname: `c${i}.example.com`,
				displayName: `c${i}`,
				createdBy: "env-seed",
			});
		}
		expect(listChannels()).toHaveLength(MAX_CHANNELS);
		await seedChannelsFromEnv(log, {
			raw: "overflow.example.com",
			lookupFn: fakeLookup("93.184.216.34"),
		});
		// 未越上限、warn 提示「上限」、函数 resolve 不抛(用例 await 未 reject 即证)。
		expect(listChannels()).toHaveLength(MAX_CHANNELS);
		expect(log.warn).toHaveBeenCalled();
		expect(log.warn.mock.calls.at(-1)?.[0]).toMatch(/上限/);
	});
});
