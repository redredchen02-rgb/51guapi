import cron from "node-cron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingWriteQueue } from "../scraper/pending-db.js";
import { jobs, stopScheduler } from "../scraper/scheduler.js";
import { isHostAllowed } from "../scraper/ssrf-allowlist.js";
import { safeFetch } from "../scraper/ssrf-guard.js";
import { startRevisitJob } from "./revisit-job.js";
import { sendAlert } from "./telegram.js";

// ---- mocks ----

vi.mock("node-cron", () => ({
	default: {
		validate: vi.fn(() => true),
		schedule: vi.fn(() => ({ stop: vi.fn() })),
	},
}));

vi.mock("./telegram.js", () => ({
	sendAlert: vi.fn(async () => undefined),
}));

vi.mock("../scraper/ssrf-guard.js", () => ({
	safeFetch: vi.fn(),
	SsrfError: class SsrfError extends Error {},
}));

vi.mock("../scraper/ssrf-allowlist.js", () => ({
	loadSSRFAllowlist: vi.fn(() => ({ allowedHosts: [], mode: "fail-closed" })),
	isHostAllowed: vi.fn(() => true),
}));

const mockRun = vi.fn();
const mockAll = vi.fn(() => [] as unknown[]);
const mockDb = { prepare: vi.fn(() => ({ all: mockAll, run: mockRun })) };

vi.mock("../scraper/pending-db.js", () => ({
	getDb: vi.fn(() => mockDb),
	pendingWriteQueue: {
		enqueue: vi.fn((fn: () => unknown) => Promise.resolve(fn())),
	},
}));

// ---- helpers ----

function makeRow(
	overrides: Partial<{
		id: string;
		source_title: string | null;
		publish_url: string | null;
		outcome: string | null;
		created_at: string;
	}> = {},
) {
	return {
		id: "post-1",
		source_title: "测试帖子",
		publish_url: "https://test-site.example.com/post/1",
		outcome: null,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

/** Call startRevisitJob(), return [immediateCallback, healthCallback]. */
function startAndGetCallbacks(): [() => Promise<void>, () => Promise<void>] {
	startRevisitJob();
	const calls = vi.mocked(cron.schedule).mock.calls;
	expect(calls).toHaveLength(2);
	return [
		calls[0]?.[1] as () => Promise<void>,
		calls[1]?.[1] as () => Promise<void>,
	];
}

// ---- setup ----

beforeEach(() => {
	vi.clearAllMocks();
	// Reset mock implementations that clearAllMocks does not restore
	vi.mocked(isHostAllowed).mockReturnValue(true);
	vi.mocked(pendingWriteQueue).enqueue.mockImplementation((fn: () => unknown) =>
		Promise.resolve(fn()),
	);
	mockAll.mockReturnValue([]);
	mockRun.mockReset();
	// Clean up revisit keys so each test starts fresh
	jobs.delete("__revisit_immediate");
	jobs.delete("__revisit_health");
});

// ================================================================
// startRevisitJob — cron registration
// ================================================================

describe("startRevisitJob — cron registration", () => {
	it("registers two cron tasks and stores them in jobs Map", () => {
		startRevisitJob();

		expect(vi.mocked(cron.schedule).mock.calls).toHaveLength(2);
		expect(jobs.has("__revisit_immediate")).toBe(true);
		expect(jobs.has("__revisit_health")).toBe(true);
	});

	it("idempotent: calling twice only registers once", () => {
		startRevisitJob();
		startRevisitJob();

		expect(vi.mocked(cron.schedule).mock.calls).toHaveLength(2);
	});

	it("stopScheduler() stops both revisit tasks and removes them from jobs", () => {
		startRevisitJob();
		const immediateTask = jobs.get("__revisit_immediate");
		const healthTask = jobs.get("__revisit_health");
		expect(immediateTask).toBeDefined();
		expect(healthTask).toBeDefined();
		if (!immediateTask || !healthTask)
			throw new Error("revisit tasks not registered");

		stopScheduler();

		expect(immediateTask.stop).toHaveBeenCalled();
		expect(healthTask.stop).toHaveBeenCalled();
		expect(jobs.has("__revisit_immediate")).toBe(false);
		expect(jobs.has("__revisit_health")).toBe(false);
	});
});

// ================================================================
// Immediate sweep — HTTP outcome mapping
// ================================================================

describe('immediate sweep — HTTP 200 → outcome "online"', () => {
	it('updates outcome to "online" and does not call sendAlert', async () => {
		mockAll.mockReturnValueOnce([makeRow()]);
		vi.mocked(safeFetch).mockResolvedValue({ status: 200 } as Response);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(sendAlert)).not.toHaveBeenCalled();
		expect(mockRun).toHaveBeenCalledWith(
			"online",
			expect.any(String),
			"post-1",
		);
	});
});

describe('immediate sweep — HTTP 404 → outcome "failed" + alert', () => {
	it('sets outcome to "failed" and sends alert with title + URL', async () => {
		mockAll.mockReturnValueOnce([makeRow({ source_title: "测试帖子" })]);
		vi.mocked(safeFetch).mockResolvedValue({ status: 404 } as Response);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(sendAlert)).toHaveBeenCalledOnce();
		const alertMsg = vi.mocked(sendAlert).mock.calls[0]?.[0];
		expect(alertMsg).toContain("测试帖子");
		expect(alertMsg).toContain("https://test-site.example.com/post/1");
		expect(mockRun).toHaveBeenCalledWith(
			"failed",
			expect.any(String),
			"post-1",
		);
	});
});

describe("immediate sweep — HTTP 401 → session expiry alert", () => {
	it('sets outcome to "failed" and sends session-expiry alert', async () => {
		mockAll.mockReturnValueOnce([makeRow()]);
		vi.mocked(safeFetch).mockResolvedValue({ status: 401 } as Response);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(sendAlert)).toHaveBeenCalledOnce();
		const alertMsg = vi.mocked(sendAlert).mock.calls[0]?.[0];
		expect(alertMsg).toContain("session");
		expect(mockRun).toHaveBeenCalledWith(
			"failed",
			expect.any(String),
			"post-1",
		);
	});
});

describe("immediate sweep — network error → failed + alert", () => {
	it('catches fetch errors, sets outcome "failed", sends alert', async () => {
		mockAll.mockReturnValueOnce([makeRow()]);
		vi.mocked(safeFetch).mockRejectedValue(new Error("network error"));

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(sendAlert)).toHaveBeenCalledOnce();
		expect(mockRun).toHaveBeenCalledWith(
			"failed",
			expect.any(String),
			"post-1",
		);
	});
});

// ================================================================
// SSRF allowlist + scheme gate
// ================================================================

describe("SSRF allowlist — host not in REVISIT_ALLOWED_HOSTS → skip", () => {
	it("does not call safeFetch when host is not in allowlist", async () => {
		mockAll.mockReturnValueOnce([makeRow()]);
		vi.mocked(isHostAllowed).mockReturnValue(false);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(safeFetch)).not.toHaveBeenCalled();
		expect(mockRun).not.toHaveBeenCalled();
	});
});

describe("scheme gate — file:// URL → skip without fetch", () => {
	it("skips rows with non-http(s) publish_url", async () => {
		mockAll.mockReturnValueOnce([
			makeRow({ publish_url: "file:///etc/passwd" }),
		]);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(safeFetch)).not.toHaveBeenCalled();
		expect(mockRun).not.toHaveBeenCalled();
	});
});

// ================================================================
// Health sweep — only checks outcome='online' rows
// ================================================================

describe('health sweep — checks outcome="online" rows', () => {
	it("queries outcome=online, updates last_checked_at on 200", async () => {
		mockAll.mockReturnValueOnce([makeRow({ outcome: "online" })]);
		vi.mocked(safeFetch).mockResolvedValue({ status: 200 } as Response);

		const [, health] = startAndGetCallbacks();
		await health();

		// The health sweep calls prepare with the 'online' query
		const prepareCalls = (
			vi.mocked(mockDb.prepare).mock.calls as [string][][]
		).map(([sql]) => sql);
		expect(prepareCalls.some((sql) => sql.includes("outcome = 'online'"))).toBe(
			true,
		);
		expect(mockRun).toHaveBeenCalledWith(
			"online",
			expect.any(String),
			"post-1",
		);
	});
});

describe("immediate sweep — already-checked post (outcome=online) not in query", () => {
	it("immediate sweep only runs against null-outcome rows", async () => {
		// mockAll returns [] (no rows with outcome IS NULL), simulating that
		// the only post already has outcome='online'
		mockAll.mockReturnValueOnce([]);

		const [immediate] = startAndGetCallbacks();
		await immediate();

		expect(vi.mocked(safeFetch)).not.toHaveBeenCalled();
	});
});
