---
title: '脱敏闸门 check-fixture-secrets.sh 因相对路径假绿——自检通过却实扫 0 文件'
date: 2026-06-15
category: docs/solutions/security-issues
module: scripts/check-fixture-secrets.sh (脱敏闸门 / pre-commit + CI)
problem_type: security_issue
component: ci-and-hooks
severity: high
tags: [secret-scanning, fixture, fail-closed, pre-commit, ci, bash, false-green, relative-path]
---

# 脱敏闸门 check-fixture-secrets.sh 因相对路径假绿——自检通过却实扫 0 文件

## Problem

阻止机密随 fixture 进 git 历史的脱敏闸门 `scripts/check-fixture-secrets.sh`,在从 repo 根调用时(pre-commit hook、CI)**实际没扫描任何真 fixture 却报告通过(exit 0)**——一个潜伏的安全空门。

## Symptoms

- `bash scripts/check-fixture-secrets.sh`(repo 根)输出「✓ fixtures 脱敏闸门通过」、exit 0。
- 但脚本根本没读到真 fixture(它们在 `packages/extension/tests/e2e/fixtures/`)。
- 脚本内置的「投毒自检」仍通过(它在临时文件上测,不依赖真 fixture 路径),所以闸门看起来健康——掩盖了空扫。

## What Didn't Work

- 只看 exit code / 自检结果 → 全绿,看不出问题。问题靠**人工追问「它到底扫了哪个目录」**才暴露。

## Solution

根因:`FIXTURE_DIR="tests/e2e/fixtures"` 是**相对 cwd** 的路径。从 repo 根调用时解析到不存在的 `<root>/tests/e2e/fixtures`;配合 `shopt -s nullglob`,`for f in "$FIXTURE_DIR"/*.html` 匹配 0 文件 → 循环不执行 → `status=0` → exit 0。

两处修复:

```bash
# 1) 把 FIXTURE_DIR 锚定到脚本自身位置(绝对路径,与 cwd 无关)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/../packages/extension/tests/e2e/fixtures"

# 2) 空扫即大声失败(fail-closed),不再静默放行
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "✗ fixture 目录不存在:$FIXTURE_DIR —— 拒绝放行。" >&2; exit 2
fi
shopt -s nullglob
fixture_files=("$FIXTURE_DIR"/*.html)
if [ ${#fixture_files[@]} -eq 0 ]; then
  echo "✗ 无 *.html fixture(疑似路径错)—— 拒绝放行。" >&2; exit 2
fi
```

验证:植入假 token → exit 1(拦截);干净 → exit 0;从 repo 根与 packages/extension 两个 cwd 都真扫到 fixture。

## Why This Works

「自检通过」只证明检测逻辑能识别机密样本,**不证明它扫了正确的目标**。一个安全闸门的两个独立失效面:检测能力 + 扫描范围。原脚本把扫描范围交给了易错的相对路径,且用 nullglob 把「扫不到」静默吞成「没问题」。锚定脚本位置消除 cwd 依赖;空扫即 exit 2 把「范围为空」从假绿变成 fail-closed 的红灯。

## Prevention

- **任何安全/校验脚本:路径锚定到脚本位置(`${BASH_SOURCE[0]}`/`$0`),不要依赖调用方 cwd。**
- **fail-closed 三问**:扫不到目标时会发生什么?空输入是放行还是拦截?自检通过是否等于真扫过?——若「扫 0 个目标」能 exit 0,就是假绿。
- 在 CI 里**显式**调用安全脚本:`run: bash scripts/check-fixture-secrets.sh`(repo 根),不要经 `pnpm --filter <pkg>`(会把 cwd 切到包目录,既找不到 repo 根脚本、相对路径也会再错一次)。
- 闸门评审时,主动植入一个已知机密样本验证它真能红灯,而不是只看绿灯。

## 关联
- 该闸门写入 `.github/workflows/ci.yml` 成为强制门:见 `docs/plans/2026-06-15-001-feat-harden-safety-net-plan.md`。
- 同源工作另见 [[vitest-excludes-dist-phantom-backend-p0-2026-06-15]]、[[extension-http-client-testability-injection-seam-2026-06-15]]。
