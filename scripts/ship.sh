#!/usr/bin/env bash
# ship.sh — 一条命令把当前功能分支落到 main:
#   本地门禁 → 提交 → 推送(pre-push 自动跑 gitleaks)→ 开/复用 PR
#   → 等 CI 绿 → 停下等你确认 → 合并 → 删分支 + 回 main。
#
# 合并 main 不可逆:默认在 CI 绿后暂停等确认;只有 -y 才自动合。
# 非交互环境(无 TTY,如被 agent 调用)CI 绿后绝不自动合,只打印复核指令。
#
# 用法:
#   scripts/ship.sh "feat(x): 描述"      # 有未提交改动时,用此消息提交后再走流程
#   scripts/ship.sh                        # 工作树已干净,直接推现有提交
#   scripts/ship.sh --skip-tests "msg"     # 跳过本地 pnpm test/compile 门禁
#   scripts/ship.sh -y "msg"               # CI 绿后自动合并,不暂停
#   scripts/ship.sh --merge-only           # 只补「合并 + 清理」(CI 已绿、PR 已开)
#   scripts/ship.sh --merge-method squash  # 改合并方式(默认 merge)
#
# 依赖:git、gh(需已登录)、pnpm。须在仓库内、且不在 main 上运行。
set -euo pipefail

# ---- 参数解析 ----------------------------------------------------------------
MSG=""
SKIP_TESTS=0
AUTO_YES=0
MERGE_ONLY=0
MERGE_METHOD="merge"   # merge | squash | rebase

while [ $# -gt 0 ]; do
	case "$1" in
		-m|--message)   MSG="$2"; shift 2 ;;
		--skip-tests)   SKIP_TESTS=1; shift ;;
		-y|--yes)       AUTO_YES=1; shift ;;
		--merge-only)   MERGE_ONLY=1; shift ;;
		--merge-method) MERGE_METHOD="$2"; shift 2 ;;
		-h|--help)
			sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		-*) echo "未知参数:$1(用 -h 看用法)" >&2; exit 2 ;;
		*)  MSG="$1"; shift ;;   # 位置参数当作 commit message
	esac
done

# ---- 通用工具 ----------------------------------------------------------------
step() { echo "=> $*"; }
die()  { echo "✗ $*" >&2; exit 1; }

# ---- 0. 前置检查 -------------------------------------------------------------
command -v gh   >/dev/null 2>&1 || die "未找到 gh CLI(brew install gh && gh auth login)"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm"
gh auth status >/dev/null 2>&1  || die "gh 未登录(gh auth login)"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "不在 git 仓库内"

# 切到仓库根,保证相对路径(pnpm、scripts/)稳定。
cd "$(git rev-parse --show-toplevel)"

BRANCH="$(git branch --show-current)"
[ -n "$BRANCH" ] || die "处于分离 HEAD,无法 ship"

DEFAULT_BRANCH="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH="main"
[ "$BRANCH" != "$DEFAULT_BRANCH" ] || die "当前在 $DEFAULT_BRANCH 上,请切到功能分支再 ship"

# ---- 合并 + 清理(供正常流程末尾与 --merge-only 复用)-------------------------
do_merge_and_cleanup() {
	local pr_num="$1"
	step "合并 PR #$pr_num(方式:$MERGE_METHOD)…"
	gh pr merge "$pr_num" "--$MERGE_METHOD" --delete-branch \
		|| die "合并失败(可能分支保护未满足或有冲突),PR 仍开着"

	step "切回 $DEFAULT_BRANCH 并同步…"
	git checkout "$DEFAULT_BRANCH"
	git pull --ff-only origin "$DEFAULT_BRANCH"
	# gh --delete-branch 已删远程与本地分支;本地若残留则补删。
	git branch -d "$BRANCH" 2>/dev/null || true
	echo "✓ 已合并并清理。$DEFAULT_BRANCH 现在是最新。"
}

# 解析当前分支已开的 PR 号(无则空)。
pr_number_for_branch() {
	gh pr view "$BRANCH" --json number --jq .number 2>/dev/null || true
}

# 阻塞等 CI 跑完;失败则非 0 退出。无任何 check 时给出警告并放行。
wait_for_ci() {
	local pr_num="$1"
	step "等待 CI(PR #$pr_num)…"
	if gh pr checks "$pr_num" --watch --fail-fast; then
		echo "✓ CI 全绿。"
	else
		# 区分「真失败」与「该 PR 没有任何 check」。
		if gh pr checks "$pr_num" 2>&1 | grep -qi "no checks"; then
			echo "⚠ 该 PR 未报告任何 CI check,跳过门禁(请确认 ci.yml 是否触发)。"
		else
			die "CI 未通过,已停止。修复后重跑 scripts/ship.sh(或 --merge-only)"
		fi
	fi
}

# ---- 快捷模式:只补合并 + 清理 ----------------------------------------------
if [ "$MERGE_ONLY" = "1" ]; then
	PR_NUM="$(pr_number_for_branch)"
	[ -n "$PR_NUM" ] || die "当前分支没有已开的 PR,无法 --merge-only"
	wait_for_ci "$PR_NUM"
	do_merge_and_cleanup "$PR_NUM"
	exit 0
fi

# ---- 1. 提交(如有未提交改动)-----------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
	[ -n "$MSG" ] || die "工作树有未提交改动,请给提交信息:scripts/ship.sh \"feat: …\""
	step "提交改动…"
	git add -A
	# pre-commit 钩子会自动跑 pnpm compile(若已启用 core.hooksPath)。
	git commit -m "$MSG"
else
	step "工作树干净,跳过提交,推送现有提交。"
fi

# 提交后再校验:分支必须领先 origin/DEFAULT,否则没东西可 ship。
if git merge-base --is-ancestor "$BRANCH" "origin/$DEFAULT_BRANCH" 2>/dev/null; then
	die "本分支无领先 origin/$DEFAULT_BRANCH 的提交,无可 ship 的改动"
fi

# ---- 2. 本地门禁 -------------------------------------------------------------
if [ "$SKIP_TESTS" = "0" ]; then
	step "本地门禁:pnpm -r test…"
	pnpm -r test
	step "本地门禁:pnpm -r compile…"
	pnpm -r compile
	echo "✓ 本地测试 + 类型检查通过。"
else
	step "已跳过本地门禁(--skip-tests)。"
fi

# ---- 3. 推送(pre-push 钩子自动跑 gitleaks)----------------------------------
step "推送 $BRANCH 到 origin…"
git push -u origin "$BRANCH"

# ---- 4. 开 PR 或复用已有 PR --------------------------------------------------
PR_NUM="$(pr_number_for_branch)"
if [ -n "$PR_NUM" ]; then
	step "复用已有 PR #$PR_NUM。"
else
	step "创建 PR(→ $DEFAULT_BRANCH)…"
	# --fill:用提交信息自动填 title/body。多提交时取分支聚合。
	gh pr create --base "$DEFAULT_BRANCH" --head "$BRANCH" --fill
	PR_NUM="$(pr_number_for_branch)"
	[ -n "$PR_NUM" ] || die "PR 创建后无法解析编号"
fi
PR_URL="$(gh pr view "$PR_NUM" --json url --jq .url)"
echo "   PR:$PR_URL"

# ---- 5. 等 CI ----------------------------------------------------------------
wait_for_ci "$PR_NUM"

# ---- 6. 确认闸门(合并 main 不可逆)------------------------------------------
if [ "$AUTO_YES" = "1" ]; then
	step "已带 -y,CI 绿后自动合并。"
elif [ -t 0 ]; then
	# 交互终端:当面确认。
	read -r -p "CI 绿。合并 PR #$PR_NUM 到 $DEFAULT_BRANCH?[y/N] " ans
	case "$ans" in
		[yY]|[yY][eE][sS]) ;;
		*) echo "已取消。PR 仍开着:$PR_URL"; exit 0 ;;
	esac
else
	# 非交互(被 agent/CI 调用):安全默认——不自动合。
	echo "✓ CI 绿,但非交互环境,未自动合并(安全默认)。"
	echo "  复核 $PR_URL 后,运行其一完成合并:"
	echo "    scripts/ship.sh --merge-only          # 本脚本补合并 + 清理"
	echo "    gh pr merge $PR_NUM --$MERGE_METHOD --delete-branch"
	exit 0
fi

# ---- 7. 合并 + 清理 ----------------------------------------------------------
do_merge_and_cleanup "$PR_NUM"
