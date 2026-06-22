// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsView } from "./MetricsView";

vi.mock("../../lib/api-fetch", () => ({
	apiFetch: vi.fn(),
}));

import { apiFetch } from "../../lib/api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

const PROMETHEUS_TEXT = `
# HELP guapi_scraper_runs_total Total gossip content fetch+extraction events
# TYPE guapi_scraper_runs_total counter
guapi_scraper_runs_total{status="success"} 8
guapi_scraper_runs_total{status="failed"} 2
# HELP guapi_drafts_total Total drafts generated
# TYPE guapi_drafts_total counter
guapi_drafts_total{status="success"} 5
guapi_drafts_total{status="failed"} 5
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
	it("有数据时显示正确成功率", async () => {
		mockPrometheus(PROMETHEUS_TEXT);

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => screen.getByText("80%")); // 8/(8+2)
		screen.getByText("50%"); // 5/(5+5)
		screen.getByText("自上次后端启动（guapi_scraper_runs_total）");
		screen.getByText("自上次后端启动（guapi_drafts_total）");
	});

	it("后端离线时 Prometheus 卡片显示[后端离线]", async () => {
		mockApiFetch.mockRejectedValue(new Error("network error"));

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getAllByText("后端离线")).toHaveLength(2);
		});
	});

	it("零态时显示暂无数据提示", async () => {
		mockPrometheus(`
guapi_scraper_runs_total{status="success"} 0
guapi_scraper_runs_total{status="failed"} 0
guapi_drafts_total{status="success"} 0
guapi_drafts_total{status="failed"} 0
`);

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() =>
			screen.getByText(/暂无数据，抓取并生成草稿后将显示统计/),
		);
		// 两个成功率卡片为 —（总量 0）
		expect(screen.getAllByText("—")).toHaveLength(2);
	});

	it("仅有失败计数(零成功)时不显示暂无数据,草稿卡片显示 0%", async () => {
		mockPrometheus(`
guapi_scraper_runs_total{status="success"} 0
guapi_scraper_runs_total{status="failed"} 0
guapi_drafts_total{status="success"} 0
guapi_drafts_total{status="failed"} 3
`);

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() => screen.getByText("0%")); // 草稿 0/(0+3)
		expect(screen.queryByText(/暂无数据/)).toBeNull();
	});

	it("不会把旧 publisher 指标名当成当前后端数据", async () => {
		mockPrometheus(`
publisher_scraper_runs_total{status="success"} 8
publisher_scraper_runs_total{status="failed"} 2
publisher_drafts_total{status="success"} 5
publisher_drafts_total{status="failed"} 5
`);

		render(<MetricsView onBack={vi.fn()} />);

		await waitFor(() =>
			screen.getByText(/暂无数据，抓取并生成草稿后将显示统计/),
		);
		expect(screen.queryByText("80%")).toBeNull();
		expect(screen.queryByText("50%")).toBeNull();
	});
});
