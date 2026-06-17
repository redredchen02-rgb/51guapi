// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsView } from "./MetricsView";

vi.mock("../../lib/api-fetch", () => ({
	apiFetch: vi.fn(),
}));

vi.mock("../../lib/storage", () => ({
	getExtensionCounters: vi.fn(),
}));

import { apiFetch } from "../../lib/api-fetch";
import { getExtensionCounters } from "../../lib/storage";

const mockApiFetch = vi.mocked(apiFetch);
const mockGetCounters = vi.mocked(getExtensionCounters);

const PROMETHEUS_TEXT = `
# HELP publisher_scraper_runs_total Total gossip content fetch+extraction events
# TYPE publisher_scraper_runs_total counter
publisher_scraper_runs_total{status="success"} 8
publisher_scraper_runs_total{status="failed"} 2
# HELP publisher_drafts_total Total drafts generated
# TYPE publisher_drafts_total counter
publisher_drafts_total{status="success"} 5
publisher_drafts_total{status="failed"} 5
`;

function mockPrometheus(text: string) {
	mockApiFetch.mockResolvedValue({
		text: () => Promise.resolve(text),
	} as unknown as Response);
}

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("MetricsView", () => {
	it("有数据时显示正确成功率和批次数", async () => {
		mockPrometheus(PROMETHEUS_TEXT);
		mockGetCounters.mockResolvedValue({
			publishAttempts: { success: 0, failed: 0 },
			batchesCompleted: 7,
		});

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => screen.getByText("80%")); // 8/(8+2)
		screen.getByText("50%"); // 5/(5+5)
		screen.getByText("7");
	});

	it("后端离线时 Prometheus 卡片显示[后端离线]，批次数正常", async () => {
		mockApiFetch.mockRejectedValue(new Error("network error"));
		mockGetCounters.mockResolvedValue({
			publishAttempts: { success: 0, failed: 0 },
			batchesCompleted: 3,
		});

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getAllByText("后端离线")).toHaveLength(2);
		});
		screen.getByText("3");
	});

	it("零态时显示暂无数据提示", async () => {
		mockPrometheus(`
publisher_scraper_runs_total{status="success"} 0
publisher_scraper_runs_total{status="failed"} 0
publisher_drafts_total{status="success"} 0
publisher_drafts_total{status="failed"} 0
`);
		mockGetCounters.mockResolvedValue({
			publishAttempts: { success: 0, failed: 0 },
			batchesCompleted: 0,
		});

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() =>
			screen.getByText(/暂无数据，完成一次批次任务后将显示统计/),
		);
		// 两个成功率卡片为 —（总量 0）；批次完成数显示 0
		expect(screen.getAllByText("—")).toHaveLength(2);
		screen.getByText("0");
	});

	it("仅有失败计数(零成功)时不显示暂无数据,草稿卡片显示 0%", async () => {
		mockPrometheus(`
publisher_scraper_runs_total{status="success"} 0
publisher_scraper_runs_total{status="failed"} 0
publisher_drafts_total{status="success"} 0
publisher_drafts_total{status="failed"} 3
`);
		mockGetCounters.mockResolvedValue({
			publishAttempts: { success: 0, failed: 0 },
			batchesCompleted: 0,
		});

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => screen.getByText("0%")); // 草稿 0/(0+3)
		expect(screen.queryByText(/暂无数据/)).toBeNull();
	});
});
