import cors from "@fastify/cors";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

function buildApp(corsOriginEnv: string) {
	const app = Fastify();
	const origins = corsOriginEnv
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && s !== "*");
	app.register(cors, { origin: origins });
	app.get("/ping", async () => ({ ok: true }));
	return app;
}

describe("CORS origin filtering", () => {
	it("echoes back a configured chrome-extension origin", async () => {
		const app = buildApp("chrome-extension://abc123deadbeef");
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/ping",
			headers: { origin: "chrome-extension://abc123deadbeef" },
		});
		expect(res.headers["access-control-allow-origin"]).toBe(
			"chrome-extension://abc123deadbeef",
		);
		await app.close();
	});

	it("does not echo back an unconfigured origin", async () => {
		const app = buildApp("chrome-extension://abc123deadbeef");
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/ping",
			headers: { origin: "https://attacker.example.com" },
		});
		expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		await app.close();
	});

	it("allows both dev and prod extension IDs when comma-separated", async () => {
		const app = buildApp(
			"chrome-extension://devid111,chrome-extension://prodid222",
		);
		await app.ready();
		for (const origin of [
			"chrome-extension://devid111",
			"chrome-extension://prodid222",
		]) {
			const res = await app.inject({
				method: "GET",
				url: "/ping",
				headers: { origin },
			});
			expect(
				res.headers["access-control-allow-origin"],
				`origin ${origin}`,
			).toBe(origin);
		}
		await app.close();
	});

	it("denies all origins when CORS_ORIGIN is empty (deny-all safe default)", async () => {
		const app = buildApp("");
		await app.ready();
		const res = await app.inject({
			method: "GET",
			url: "/ping",
			headers: { origin: "chrome-extension://anyid" },
		});
		expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		await app.close();
	});

	it("denies all origins when CORS_ORIGIN is only whitespace or wildcard", async () => {
		for (const bad of ["*", "  *  ", " , "]) {
			const app = buildApp(bad);
			await app.ready();
			const res = await app.inject({
				method: "GET",
				url: "/ping",
				headers: { origin: "chrome-extension://anyid" },
			});
			expect(
				res.headers["access-control-allow-origin"],
				`bad value "${bad}"`,
			).toBeUndefined();
			await app.close();
		}
	});
});
