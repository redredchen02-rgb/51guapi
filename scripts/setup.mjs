#!/usr/bin/env node
/**
 * 51publisher 0-to-1 setup script (cross-platform: macOS / Linux / Windows)
 * Usage: node scripts/setup.mjs
 *
 * Steps:
 *   1. Node.js version check (≥ 20)
 *   2. pnpm check / auto-install
 *   3. pnpm install
 *   4. .env interactive init (skipped if already exists)
 *   5. Backend build (skipped if up-to-date)
 *   6. Backend start in background + healthz smoke test
 */

import { execSync, spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const IS_WIN = platform() === "win32";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DIST_JS = join(ROOT, "packages", "backend", "dist", "index.js");
const ENV_FILE = join(ROOT, "packages", "backend", ".env");
const ENV_EXAMPLE = join(ROOT, "packages", "backend", ".env.example");
const HEALTHZ = "http://localhost:3001/api/v1/healthz";
const LOG_FILE = IS_WIN
	? join(process.env.TEMP ?? "C:\\Temp", "51publisher-backend.log")
	: "/tmp/51publisher-backend.log";
const PID_FILE = IS_WIN
	? join(process.env.TEMP ?? "C:\\Temp", "51publisher-backend.pid")
	: "/tmp/51publisher-backend.pid";

// ── ANSI colours (disabled on Windows unless WT / modern terminal) ──────────
const HAS_COLOUR =
	!IS_WIN || process.env.WT_SESSION || process.env.TERM_PROGRAM;
const C = {
	reset: HAS_COLOUR ? "\x1b[0m" : "",
	red: HAS_COLOUR ? "\x1b[31m" : "",
	green: HAS_COLOUR ? "\x1b[32m" : "",
	yellow: HAS_COLOUR ? "\x1b[33m" : "",
	cyan: HAS_COLOUR ? "\x1b[36m" : "",
	bold: HAS_COLOUR ? "\x1b[1m" : "",
};

const info = (msg) => console.log(`${C.cyan}[setup]${C.reset} ${msg}`);
const ok = (msg) => console.log(`${C.green}[setup]${C.reset} ${msg}`);
const warn = (msg) => console.log(`${C.yellow}[setup]${C.reset} ${msg}`);
const error = (msg) => console.error(`${C.red}[setup] ERROR:${C.reset} ${msg}`);
const die = (msg) => {
	error(msg);
	process.exit(1);
};

// ── helpers ──────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
	execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

function capture(cmd) {
	return execSync(cmd, { encoding: "utf8", cwd: ROOT }).trim();
}

function commandExists(cmd) {
	try {
		execSync(IS_WIN ? `where ${cmd}` : `command -v ${cmd}`, {
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

async function prompt(question, { hidden = false } = {}) {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
	if (hidden) {
		rl._writeToOutput = (s) => {
			if (s === question || /[\r\n]/.test(s)) rl.output.write(s);
		};
	}
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function healthzOk() {
	try {
		// Node 18+ has global fetch; fall back to http module for older builds
		if (typeof fetch === "function") {
			const res = await fetch(HEALTHZ, { signal: AbortSignal.timeout(2000) });
			return res.ok;
		}
		// Minimal http fallback
		const { get } = await import("node:http");
		return await new Promise((resolve) => {
			const req = get(HEALTHZ, (res) => resolve(res.statusCode === 200));
			req.setTimeout(2000, () => {
				req.destroy();
				resolve(false);
			});
			req.on("error", () => resolve(false));
		});
	} catch {
		return false;
	}
}

// ── 1. Node.js version ───────────────────────────────────────────────────────
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
	die(
		`Node.js 版本过低（当前 v${process.versions.node}，需要 ≥ 20）。\n` +
			"  请访问 https://nodejs.org 下载最新版本。",
	);
}
ok(`Node.js v${process.versions.node} ✓`);

// ── 2. pnpm ──────────────────────────────────────────────────────────────────
info("检查 pnpm...");
if (!commandExists("pnpm")) {
	warn("未找到 pnpm，尝试通过 npm 安装...");
	run("npm install -g pnpm");
	ok("pnpm 已安装 ✓");
}
ok(`pnpm ${capture("pnpm -v")} ✓`);

// ── 3. install dependencies ──────────────────────────────────────────────────
info("安装项目依赖（pnpm install）...");
run("pnpm install");
ok("依赖安装完成 ✓");

// ── 4. .env setup ────────────────────────────────────────────────────────────
if (!existsSync(ENV_FILE)) {
	info("未找到 .env，从模板创建...");
	let env = readFileSync(ENV_EXAMPLE, "utf8");

	console.log(
		`\n${C.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`,
	);
	console.log(`${C.yellow}  请填写以下必填项。${C.reset}`);
	console.log(
		`${C.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`,
	);

	// LLM_API_KEY
	const llmKey = await prompt(
		"  LLM API Key（la-sealion 平台的 sk-... key）: ",
	);
	if (llmKey) env = env.replace(/LLM_API_KEY=.*/, `LLM_API_KEY=${llmKey}`);

	// LLM_ENDPOINT
	const llmEpInput = await prompt(
		"  LLM Endpoint [https://la-sealion.inaiai.com/v1]: ",
	);
	const llmEp = llmEpInput || "https://la-sealion.inaiai.com/v1";
	env = env.replace(/LLM_ENDPOINT=.*/, `LLM_ENDPOINT=${llmEp}`);

	// CORS_ORIGIN
	console.log(
		"\n  CORS_ORIGIN：Chrome 扩展 ID（格式 chrome-extension://abcdef...）",
	);
	console.log(
		"  （可暂填 placeholder，加载扩展后在 chrome://extensions 找到 ID 再改 .env）",
	);
	const corsInput = await prompt(
		"  CORS_ORIGIN [chrome-extension://PLACEHOLDER]: ",
	);
	const cors = corsInput || "chrome-extension://PLACEHOLDER";
	env = env.replace(/CORS_ORIGIN=.*/, `CORS_ORIGIN=${cors}`);

	// JWT_SECRET — auto-generate
	const jwtSecret = randomBytes(48).toString("hex");
	env = env.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);
	ok("JWT_SECRET 已自动生成 ✓");

	// JWT_ADMIN_PASSWORD_HASH — interactive
	console.log("\n  设置管理员密码（用于登录后端 API，至少 8 位）。");
	let adminPw = "";
	while (true) {
		adminPw = await prompt("  Admin 密码: ", { hidden: true });
		const adminPw2 = await prompt("  确认密码:   ", { hidden: true });
		if (adminPw !== adminPw2) {
			warn("两次密码不一致，请重新输入。");
		} else if (adminPw.length < 8) {
			warn("密码至少 8 位，请重新输入。");
		} else {
			break;
		}
	}
	const salt = randomBytes(16);
	const dk = scryptSync(adminPw, salt, 64);
	const hash = `${salt.toString("hex")}:${dk.toString("hex")}`;
	env = env.replace(
		/JWT_ADMIN_PASSWORD_HASH=.*/,
		`JWT_ADMIN_PASSWORD_HASH=${hash}`,
	);
	ok("JWT_ADMIN_PASSWORD_HASH 已写入 ✓");

	writeFileSync(ENV_FILE, env, "utf8");
	ok(`.env 初始化完成 → ${ENV_FILE}`);
} else {
	ok(".env 已存在，跳过初始化 ✓");
}

// ── 5. build backend ─────────────────────────────────────────────────────────
function needsBuild() {
	if (!existsSync(DIST_JS)) return true;
	const distMtime = statSync(DIST_JS).mtimeMs;
	const srcDir = join(ROOT, "packages", "backend", "src");
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (walk(full)) return true;
			} else if (entry.name.endsWith(".ts")) {
				if (statSync(full).mtimeMs > distMtime) return true;
			}
		}
		return false;
	};
	return walk(srcDir);
}

if (needsBuild()) {
	info("构建后端...");
	run("pnpm --filter publisher-backend build");
	ok("后端构建完成 ✓");
} else {
	ok("后端构建产物是最新的，跳过构建 ✓");
}

// ── 6. start backend ─────────────────────────────────────────────────────────
if (await healthzOk()) {
	ok(`后端已在运行（${HEALTHZ} → ok）✓`);
} else {
	// Load env vars before spawning
	const envContent = readFileSync(ENV_FILE, "utf8");
	const envVars = { ...process.env };
	for (const line of envContent.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		envVars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}

	info(`启动后端服务（日志: ${LOG_FILE}）...`);
	const { openSync } = await import("node:fs");
	const logFd = openSync(LOG_FILE, "a");
	const child = spawn(process.execPath, [DIST_JS], {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: envVars,
	});
	child.unref();
	writeFileSync(PID_FILE, String(child.pid), "utf8");
	info(`后端进程 pid=${child.pid}`);

	// Poll healthz up to 15 s
	let started = false;
	for (let i = 1; i <= 15; i++) {
		await sleep(1000);
		if (await healthzOk()) {
			started = true;
			break;
		}
		process.stdout.write(`  等待后端启动... (${i}/15)\r`);
	}
	console.log();

	if (!started) {
		error(`后端 15 秒内未响应 ${HEALTHZ}`);
		error(`请查看日志：${IS_WIN ? "type" : "cat"} "${LOG_FILE}"`);
		process.exit(1);
	}
	ok(`后端已就绪（pid=${child.pid}）✓`);
}

// ── summary ──────────────────────────────────────────────────────────────────
const stopCmd = IS_WIN
	? `Stop-Process -Id (Get-Content '${PID_FILE}')`
	: `kill $(cat ${PID_FILE})`;

const envContent = readFileSync(ENV_FILE, "utf8");
const hasCorsPlaceholder = envContent.includes("PLACEHOLDER");

console.log(
	`\n${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`,
);
console.log(`${C.green}  ✅ 设置完成！${C.reset}`);
console.log("");
console.log(`  后端地址: ${C.cyan}http://localhost:3001${C.reset}`);
console.log(`  后端日志: ${C.cyan}${LOG_FILE}${C.reset}`);
console.log(`  停止服务: ${C.cyan}${stopCmd}${C.reset}`);
console.log("");
console.log("  下一步：在 Chrome 加载扩展");
console.log("    chrome://extensions → 开启开发者模式 → 加载已解压");
console.log(
	`    → 选 packages${IS_WIN ? "\\" : "/"}extension${IS_WIN ? "\\" : "/"}.output${IS_WIN ? "\\" : "/"}chrome-mv3${IS_WIN ? "\\" : "/"}`,
);
if (hasCorsPlaceholder) {
	console.log("");
	console.log(
		`${C.yellow}  提醒：CORS_ORIGIN 仍是 PLACEHOLDER，加载扩展后请更新 .env 并重新运行此脚本。${C.reset}`,
	);
}
console.log(
	`${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`,
);
