import type { FactsBlock } from "@51guapi/shared";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./web-enricher.js", () => ({
	enrichContext: vi.fn(),
}));

import { tryEnrich } from "./enrichment-utils.js";
import { enrichContext } from "./web-enricher.js";

const mockEnrich = vi.mocked(enrichContext);

const SAVED = {
	enabled: process.env.ENRICHMENT_ENABLED,
	max: process.env.ENRICHMENT_MAX_QUERIES,
};

const FACTS: FactsBlock = { 作品名: "测试作品" };

function fakeLogger() {
	return { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger & {
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.ENRICHMENT_ENABLED;
	delete process.env.ENRICHMENT_MAX_QUERIES;
});

afterEach(() => {
	if (SAVED.enabled === undefined) delete process.env.ENRICHMENT_ENABLED;
	else process.env.ENRICHMENT_ENABLED = SAVED.enabled;
	if (SAVED.max === undefined) delete process.env.ENRICHMENT_MAX_QUERIES;
	else process.env.ENRICHMENT_MAX_QUERIES = SAVED.max;
});

describe("tryEnrich", () => {
	it("ENRICHMENT_ENABLED=false → 直接返回 undefined，不调用 enrichContext", async () => {
		process.env.ENRICHMENT_ENABLED = "false";
		expect(await tryEnrich({ facts: FACTS })).toBeUndefined();
		expect(mockEnrich).not.toHaveBeenCalled();
	});

	it("Happy: 返回 enrichment，并记录结果总数", async () => {
		const logger = fakeLogger();
		mockEnrich.mockResolvedValueOnce({
			queryResults: [{ results: [1, 2] }, { results: [3] }],
		} as never);
		const result = await tryEnrich({ facts: FACTS, logger });
		expect(result).toBeDefined();
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("3 results"),
		);
	});

	it("ENRICHMENT_MAX_QUERIES=20 → clamp 到 10 传给 enrichContext", async () => {
		process.env.ENRICHMENT_MAX_QUERIES = "20";
		mockEnrich.mockResolvedValueOnce({ queryResults: [] } as never);
		await tryEnrich({ facts: FACTS });
		expect(mockEnrich).toHaveBeenCalledWith(
			expect.objectContaining({ maxQueries: 10 }),
		);
	});

	it("ENRICHMENT_MAX_QUERIES 非法 → 回落默认 3", async () => {
		process.env.ENRICHMENT_MAX_QUERIES = "abc";
		mockEnrich.mockResolvedValueOnce({ queryResults: [] } as never);
		await tryEnrich({ facts: FACTS });
		expect(mockEnrich).toHaveBeenCalledWith(
			expect.objectContaining({ maxQueries: 3 }),
		);
	});

	it("enrichContext 抛错 → 静默返回 undefined，并记录 warn", async () => {
		const logger = fakeLogger();
		mockEnrich.mockRejectedValueOnce(new Error("boom"));
		expect(await tryEnrich({ facts: FACTS, logger })).toBeUndefined();
		expect(logger.warn).toHaveBeenCalled();
	});
});
