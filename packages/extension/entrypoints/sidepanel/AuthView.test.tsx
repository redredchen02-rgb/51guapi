// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/auth-client", () => ({ login: vi.fn() }));

import { login } from "../../lib/auth-client";
import { AuthView } from "./AuthView.js";

const mockLogin = vi.mocked(login);

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("AuthView (自用模式·免密)", () => {
	it("挂载即自动免密登入成功 → 调 onLogin,login 不带密码", async () => {
		mockLogin.mockResolvedValueOnce({ ok: true } as never);
		const onLogin = vi.fn();
		render(<AuthView onLogin={onLogin} />);
		await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
		expect(mockLogin).toHaveBeenCalledWith();
	});

	it("不渲染任何密码输入框", async () => {
		mockLogin.mockResolvedValueOnce({ ok: false, error: "凭证无效" } as never);
		const { container } = render(<AuthView onLogin={vi.fn()} />);
		await screen.findByText("凭证无效");
		expect(container.querySelector('input[type="password"]')).toBeNull();
	});

	it("后端不可达 → 显示启动提示与命令,不调 onLogin", async () => {
		mockLogin.mockResolvedValueOnce({
			ok: false,
			error: "无法连接后端服务",
		} as never);
		const onLogin = vi.fn();
		render(<AuthView onLogin={onLogin} />);
		expect(await screen.findByText(/启动后端/)).toBeTruthy();
		expect(screen.getByText("node scripts/setup.mjs")).toBeTruthy();
		expect(onLogin).not.toHaveBeenCalled();
	});

	it("点「重试」→ 再次 login;成功则 onLogin", async () => {
		mockLogin
			.mockResolvedValueOnce({ ok: false, error: "无法连接后端服务" } as never)
			.mockResolvedValueOnce({ ok: true } as never);
		const onLogin = vi.fn();
		render(<AuthView onLogin={onLogin} />);
		const retry = await screen.findByRole("button", { name: "重试" });
		fireEvent.click(retry);
		await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
		expect(mockLogin).toHaveBeenCalledTimes(2);
	});

	it("error 不含「无法连接」→ 不显示启动提示", async () => {
		mockLogin.mockResolvedValueOnce({ ok: false, error: "凭证无效" } as never);
		render(<AuthView onLogin={vi.fn()} />);
		await screen.findByText("凭证无效");
		expect(screen.queryByText("node scripts/setup.mjs")).toBeNull();
	});
});
