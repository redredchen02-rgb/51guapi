import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApiError,
	apiFetch,
	getBaseUrl,
	NetworkError,
	setBaseUrl,
} from "@/lib/api-client";

describe("getBaseUrl", () => {
	beforeEach(() => {
		localStorage.clear();
		// Simulate dev mode (port 5173) for these tests
		Object.defineProperty(window, "location", {
			value: { hostname: "localhost", port: "5173" },
			writable: true,
		});
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("falls back to http://localhost:3002 when localStorage has no value", () => {
		expect(getBaseUrl()).toBe("http://localhost:3002");
	});

	it("returns stored URL when valid localhost URL is set", () => {
		setBaseUrl("http://localhost:3003");
		expect(getBaseUrl()).toBe("http://localhost:3003");
	});

	it("rejects non-localhost URLs and uses default", () => {
		localStorage.setItem("guapi_backend_url", "http://evil.example.com");
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(getBaseUrl()).toBe("http://localhost:3002");
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid backendUrl"),
		);
		consoleSpy.mockRestore();
	});

	it("strips trailing slash from stored URL", () => {
		setBaseUrl("http://localhost:3002/");
		expect(getBaseUrl()).toBe("http://localhost:3002");
	});
});

describe("apiFetch", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetch);
		localStorage.clear();
		Object.defineProperty(window, "location", {
			value: { hostname: "localhost", port: "5173" },
			writable: true,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it("makes GET request to correct URL with JSON headers", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true, topics: [] }),
		});

		const result = await apiFetch<{ ok: boolean }>("/api/v1/pending-topics");
		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:3002/api/v1/pending-topics",
			expect.objectContaining({
				headers: expect.objectContaining({
					"Content-Type": "application/json",
				}),
			}),
		);
		expect(result).toEqual({ ok: true, topics: [] });
	});

	it("throws ApiError with code on non-ok response", async () => {
		mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

		let caught: unknown;
		try {
			await apiFetch("/api/v1/pending-topics/nonexistent");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		const err = caught as ApiError;
		expect(err.status).toBe(404);
		expect(err.code).toBe("NOT_FOUND");
	});

	it("throws NetworkError (not leaking URL) on fetch failure", async () => {
		mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		let caught: unknown;
		try {
			await apiFetch("/api/v1/healthz");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		const err = caught as NetworkError;
		// Must not leak URL in message
		expect(err.message).not.toContain("localhost");
		expect(err.message).not.toContain("3002");
	});

	it("sends POST request with body", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ ok: true }),
		});

		await apiFetch("/api/v1/channels", {
			method: "POST",
			body: JSON.stringify({ channel: "example.com" }),
		});

		expect(mockFetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ channel: "example.com" }),
			}),
		);
	});
});
