import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scraperConfig } from "../scraper/scraper-config.js";
import { registerScraperRoutes } from "./scraper-routes.js";

// ---- Setup ----

let app: FastifyInstance;
let testId = 0;

beforeEach(async () => {
	testId++;
	app = Fastify({ logger: false });
	await registerScraperRoutes(app);
	await app.ready();

	// Mock listAdapters and listSiteConfigs
	vi.spyOn(scraperConfig, "listAdapters").mockReturnValue([
		{
			name: `adapter-${testId}`,
			fetchContent: async () => ({ title: "A", body: "B", url: "http://a" }),
		} as any,
	]);
	vi.spyOn(scraperConfig, "listSiteConfigs").mockReturnValue([
		{
			siteName: `site-${testId}`,
			adapterName: `adapter-${testId}`,
			url: "https://site.example.com",
			cron: "0 * * * *",
			enabled: true,
		},
	]);
});

describe("Scraper Routes (Legacy disabled, Active routes tested)", () => {
	it("POST /api/v1/scraper/trigger -> 410 (legacy-acg-disabled)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: `site-${testId}` },
		});
		expect(res.statusCode).toBe(410);
		expect(res.json()).toMatchObject({
			kind: "legacy-acg-disabled",
		});
	});

	it("POST /api/v1/scraper/auto-generate -> 410 (legacy-acg-disabled)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/auto-generate",
			payload: {},
		});
		expect(res.statusCode).toBe(410);
		expect(res.json()).toMatchObject({
			kind: "legacy-acg-disabled",
		});
	});

	it("GET /api/v1/scraper/adapters -> 200 containing registered adapter name", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/scraper/adapters",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		const names = (res.json().adapters as { name: string }[]).map(
			(a) => a.name,
		);
		expect(names).toContain(`adapter-${testId}`);
	});

	it("GET /api/v1/scraper/sites -> 200 containing configured site configs", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/scraper/sites",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		expect(Array.isArray(res.json().sites)).toBe(true);
		expect(res.json().sites[0].siteName).toBe(`site-${testId}`);
	});
});
