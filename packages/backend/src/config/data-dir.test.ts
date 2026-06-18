import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataDirEnv } from "./data-dir.js";

// 模块级 DATA_DIR 常量在导入期冻结、无法对不同 env 复测,故直接单测解析助手。
describe("dataDirEnv", () => {
	const saved = {
		guapi: process.env.GUAPI_DATA_DIR,
		publisher: process.env.PUBLISHER_DATA_DIR,
	};

	beforeEach(() => {
		delete process.env.GUAPI_DATA_DIR;
		delete process.env.PUBLISHER_DATA_DIR;
	});

	afterEach(() => {
		// 还原 test-setup 注入的隔离目录,避免污染其他用例。
		restoreEnv("GUAPI_DATA_DIR", saved.guapi);
		restoreEnv("PUBLISHER_DATA_DIR", saved.publisher);
	});

	it("仅设新名 GUAPI_DATA_DIR → 生效", () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		expect(dataDirEnv()).toBe("/tmp/guapi");
	});

	it("仅设旧名 PUBLISHER_DATA_DIR → fallback 生效(兼容旧部署)", () => {
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		expect(dataDirEnv()).toBe("/tmp/legacy");
	});

	it("两者都设 → 新名优先", () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		process.env.PUBLISHER_DATA_DIR = "/tmp/legacy";
		expect(dataDirEnv()).toBe("/tmp/guapi");
	});

	it("都未设 → undefined(调用方回退各自默认)", () => {
		expect(dataDirEnv()).toBeUndefined();
	});
});

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
