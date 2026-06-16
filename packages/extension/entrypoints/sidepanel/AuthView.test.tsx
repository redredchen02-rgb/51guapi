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

function pwInput(container: HTMLElement): HTMLInputElement {
	const el = container.querySelector('input[type="password"]');
	if (!el) throw new Error("password input not found");
	return el as HTMLInputElement;
}

describe("AuthView", () => {
	it("密码为空提交 → 显示「请输入密码」，不调用 login", () => {
		render(<AuthView onLogin={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "登录" }));
		expect(screen.getByRole("alert").textContent).toContain("请输入密码");
		expect(mockLogin).not.toHaveBeenCalled();
	});

	it("登录成功 → 调用 login 并触发 onLogin", async () => {
		mockLogin.mockResolvedValueOnce({ ok: true } as never);
		const onLogin = vi.fn();
		const { container } = render(<AuthView onLogin={onLogin} />);
		fireEvent.change(pwInput(container), { target: { value: "pw123" } });
		fireEvent.click(screen.getByRole("button", { name: "登录" }));
		await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
		expect(mockLogin).toHaveBeenCalledWith("pw123");
	});

	it("登录失败 → 显示后端返回的错误信息", async () => {
		mockLogin.mockResolvedValueOnce({ ok: false, error: "密码错误" } as never);
		const { container } = render(<AuthView onLogin={vi.fn()} />);
		fireEvent.change(pwInput(container), { target: { value: "wrong" } });
		fireEvent.click(screen.getByRole("button", { name: "登录" }));
		expect(await screen.findByText("密码错误")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("密码错误");
	});

	it("错误含「无法连接」→ 显示后端启动提示与命令", async () => {
		mockLogin.mockResolvedValueOnce({
			ok: false,
			error: "无法连接后端服务",
		} as never);
		const { container } = render(<AuthView onLogin={vi.fn()} />);
		fireEvent.change(pwInput(container), { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "登录" }));
		expect(await screen.findByText(/启动后端/)).toBeTruthy();
		expect(screen.getByText("node scripts/setup.mjs")).toBeTruthy();
	});

	it("error 不含「无法连接」→ 不显示启动提示", async () => {
		mockLogin.mockResolvedValueOnce({ ok: false, error: "凭证无效" } as never);
		const { container } = render(<AuthView onLogin={vi.fn()} />);
		fireEvent.change(pwInput(container), { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "登录" }));
		await screen.findByText("凭证无效");
		expect(screen.queryByText("node scripts/setup.mjs")).toBeNull();
	});
});
