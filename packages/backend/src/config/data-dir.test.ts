import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// warn-once 标志与 DATA_DIR 解析都是模块级状态:用 vi.resetModules() + 动态 import
// 取得每个用例独立、标志归零的新模块实例,从而能对「弃用警告恰一次」复测。
async function loadDataDirEnv(): Promise<() => string | undefined> {
	vi.resetModules();
	const mod = await import("./data-dir.js");
	return mod.dataDirEnv;
}

describe("dataDirEnv", () => {
	const saved = {
		guapi: process.env.GUAPI_DATA_DIR,
		publisher: process.env.PUBLISHER_DATA_DIR,
	};

	beforeEach(() => {
		delete process.env.GUAPI_DATA_DIR;
		delete process.env.PUBLISHER_DATA_DIR;
		vi.restoreAllMocks();
	});

	afterEach(() => {
		// 还原 test-setup 注入的隔离目录,避免污染其他用例。
		restoreEnv("GUAPI_DATA_DIR", saved.guapi);
		restoreEnv("PUBLISHER_DATA_DIR", saved.publisher);
		vi.restoreAllMocks();
	});

	// —— 优先级矩阵(行为保持,回归守护)——

	it("仅设新名 GUAPI_DATA_DIR → 生效", async () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/guapi");
	});

	it("仅设旧名 PUBLISHER_DATA_DIR → fallback 生效(兼容旧部署)", async () => {
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/legacy");
	});

	it("两者都设 → 新名优先", async () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/guapi");
	});

	it("都未设 → undefined(调用方回退各自默认)", async () => {
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBeUndefined();
	});

	// —— 空串视未设(沿用旧 `||` 语义)——

	it("GUAPI_DATA_DIR='' + legacy 命中 → 落到 legacy(空串视未设)", async () => {
		process.env.GUAPI_DATA_DIR = "";
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/legacy");
	});

	// 双空串:沿用 `||` 原语义,返回末位空串(falsy,调用方一律视未设)。
	// 钉死此值以防未来误改成会丢失空串/抛错的写法。
	it("两者皆 '' → '' (双空串,保持原 `||` falsy 语义)", async () => {
		process.env.GUAPI_DATA_DIR = "";
		process.env.PUBLISHER_DATA_DIR = "";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBeFalsy();
		expect(dataDirEnv()).toBe("");
	});

	// —— legacy 弃用警告(warn-once)——

	it("仅 legacy 命中、连调两次 → 路径都正确 + 警告恰一次", async () => {
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/legacy");
		expect(dataDirEnv()).toBe("/tmp/legacy");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0]?.[0]).toContain("PUBLISHER_DATA_DIR");
		expect(warnSpy.mock.calls[0]?.[0]).toContain("GUAPI_DATA_DIR");
	});

	it("GUAPI_DATA_DIR 设值(legacy 也在)→ 返回新值且不警告", async () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/guapi");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("都未设 → 不警告(无 legacy 命中)", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
