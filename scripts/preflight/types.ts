// Preflight 自检契约(Plan 005 Phase 1 / PR-A)。
//
// 两类条目:
//   - green(机械可验证):有 run(),preflight 真正执行并判 pass/fail。
//   - red(不可逆、仅操作者可做的残留):**永不执行、永不计入 pass/fail**,
//     只被列出并提醒「这部分代码无法替你验证,必须人工把关」。
//
// 设计动机:防「假绿」。若某关键项被悄悄降级为「无可验证目标」,
// runner 必须把整体判红(见 runner.ts),而不是因为「没有失败项」就报绿。

/** green 检查的单次结果。reason 在 pass/fail 两种情况下都应可读(便于审计)。 */
export interface CheckResult {
	status: "pass" | "fail";
	reason: string;
}

/** 一个机械可验证的检查项。 */
export interface GreenCheck {
	id: string;
	label: string;
	tier: "green";
	/** 真正执行的验证逻辑。抛出异常 → runner 记为 fail 并把整体判红。 */
	run: () => Promise<CheckResult>;
}

/** 一个不可逆、仅操作者可做的残留项。**只列出,从不执行**。 */
export interface RedResidual {
	id: string;
	label: string;
	tier: "red";
	/** 为什么代码无法验证、操作者必须手动做什么。 */
	note: string;
}

export type PreflightItem = GreenCheck | RedResidual;

/** 单条 green 检查跑完后的归档结果(供 runner 汇总/打印)。 */
export interface GreenOutcome {
	id: string;
	label: string;
	status: "pass" | "fail";
	reason: string;
}

/** runner 聚合结果。 */
export interface PreflightSummary {
	greens: GreenOutcome[];
	reds: RedResidual[];
	/** 整体是否通过(可安全继续)。false = 判红。 */
	ok: boolean;
	/** 进程退出码:0 = ok,非 0 = 判红。 */
	exitCode: number;
	/** 判红时的简短理由(假绿守卫 / 有失败项 / 抛异常)。 */
	failReason?: string;
}
