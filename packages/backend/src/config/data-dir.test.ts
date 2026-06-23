import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadDataDirEnv(): Promise<() => string | undefined> {
	vi.resetModules();
	const mod = await import("./data-dir.js");
	return mod.dataDirEnv;
}

describe("dataDirEnv", () => {
	const savedGuapi = process.env.GUAPI_DATA_DIR;

	beforeEach(() => {
		delete process.env.GUAPI_DATA_DIR;
	});

	afterEach(() => {
		restoreEnv("GUAPI_DATA_DIR", savedGuapi);
		vi.restoreAllMocks();
	});

	it("GUAPI_DATA_DIR 有值 → 返回该值", async () => {
		process.env.GUAPI_DATA_DIR = "/tmp/guapi";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBe("/tmp/guapi");
	});

	it("未设 GUAPI_DATA_DIR → undefined", async () => {
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBeUndefined();
	});

	it("GUAPI_DATA_DIR='' → undefined(空串视未设)", async () => {
		process.env.GUAPI_DATA_DIR = "";
		const dataDirEnv = await loadDataDirEnv();
		expect(dataDirEnv()).toBeUndefined();
	});
});

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}
