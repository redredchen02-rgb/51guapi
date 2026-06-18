---
title: "feat: v0.2 Release Readiness — 发布前整备"
type: feat
status: completed
date: 2026-06-17
---

# feat: v0.2 Release Readiness — 发布前整备

## Overview

当前代码库功能完整、测试全绿（880 tests pass），但从未完成过一次真实发布。本计划聚焦五件事：修复关键正确性 bug、消除最高优先级的工程 footgun、补全两处可观测性空白、做发布机械操作，使 v0.2.0 可被 operator 安心执行第一次真实 publish。

**不在本计划内：** slotDiff 质量数据集（想法 #5）、backend-drift canary（想法 #3）、全量 React 组件 reducer 拆分（想法 #7）。这三项在首次真实发布后做。

## Problem Frame

- `package.json` 版本全是 `0.1.0`，CHANGELOG 已到 `0.2.1.0`，tag 从未打过
- host-surface 定义散布 4 处，无构建时一致性断言——生产切换一行改错就会静默不注入
- 轨迹状态 `fill-completed` 被滥用：gateway-blocked 和 off-mode-kill 共用同一状态，metrics/funnel 因此说谎
- `window.prompt()` 在 `PromptSection.tsx` 命名模板处仍存在，但主路径【待补】global-replace bug 已在 0.2.1.0 拆分中消除（BatchReviewPanel 已不存在），需要核实
- 没有机械预检脚本——runbook 的可验证步骤靠人眼，首次发布容易出错
- extension-side LLM 调用无退避，backend 有但 extension 无

## Requirements Trace

- R1. `package.json` 版本与 CHANGELOG 同步，`v0.2.1` tag 可被 `release.yml` 触发
- R2. 4 处 host-surface 统一到单一真相源，构建/测试时有等价性断言
- R3. 轨迹状态 `fill-completed` / `gateway-blocked` / `off-mode-kill` 三态分离，metrics 计数器对应更新
- R4. 有 `pnpm preflight` 脚本可机械验证所有可逆 runbook 项目
- R5. 有发布 checklist 文档（`docs/ops/release-checklist.md`），记录不可逆步骤

## Scope Boundaries

- 不实现 slotDiff 质量聚合（想法 #5）
- 不实现 backend-drift canary（想法 #3）
- 不实现 TodayBatchView reducer 拆分（想法 #7）
- 不新增 publish funnel histogram（想法 #2 的 p50/p95 部分），只修 trajectory 三态（前置条件）
- 不修改 SSRF allowlist 或 scraper 管线（已有专属计划）

## Context & Research

### 关键文件

- `packages/extension/wxt.config.ts` — manifest matches，host_permissions
- `packages/extension/entrypoints/content.ts` — content script matches
- `packages/extension/entrypoints/background.ts` — authorizedHosts（runtime check）
- `packages/shared/src/` — 共享类型，待新增 `authorized-hosts.ts`
- `packages/backend/src/services/metrics.ts` — 6 个平面计数器
- `packages/backend/src/services/trajectory.ts` — 轨迹状态枚举
- `packages/extension/entrypoints/sidepanel/components/PromptSection.tsx:34` — window.prompt（命名模板，非主路径）
- `CHANGELOG.md` — 版本历史（当前 `0.2.1.0`）
- `package.json`（root）— 当前 `0.1.0`，需同步
- `scripts/check-all.sh` — CI 入口

### 已有模式

- 轨迹状态在 `trajectory.ts`，类型在 `@51guapi/shared`
- metrics counter 在 `services/metrics.ts`，被 routes 调用
- wxt.config 的 `DEFAULT_HOSTS` 已定义，需要检查哪 4 处引用
- `scripts/` 目录已有 `check-all.sh`，风格参照即可写 `preflight.sh`

## Key Technical Decisions

- **单一真相源放 `@51guapi/shared`**：`authorized-hosts.ts` 导出 `AUTHORIZED_HOSTS` 数组；wxt.config 和 content.ts 在 build-time import，background.ts 在 runtime import。理由：shared 包已被 extension 和 backend 共同使用，无环依赖风险。
- **轨迹三态用 union literal type**：`fill-completed | gateway-blocked | off-mode-kill` 替代当前的 `fill-completed` 全包；避免引入新数据结构，只扩充 union。
- **preflight 脚本用 bash + curl**：不引入新 Node 依赖；复用 backend 已有的 `/health` 和 `/metrics` 端点。

## Implementation Units

```
Unit 1 ──► Unit 2 ──► Unit 3
Unit 4 (独立，并行可做)
Unit 5 (独立，并行可做)
```

---

- [ ] **Unit 1: 轨迹三态分离**

**Goal:** 把 `fill-completed` 拆成三个独立状态，消除 trajectory 谎报

**Requirements:** R3

**Dependencies:** 无

**Files:**
- Modify: `packages/shared/src/types.ts`（或 trajectory types 所在文件）
- Modify: `packages/backend/src/services/trajectory.ts`
- Modify: `packages/backend/src/services/metrics.ts`（新增 `gateway_blocked` / `off_mode_kill` 计数器）
- Modify: 所有 emit `fill-completed` 的调用点（grep 确认）
- Test: `packages/backend/src/services/trajectory.test.ts`（若不存在则新建）

**Approach:**
- 在类型层新增 `'gateway-blocked'` 和 `'off-mode-kill'` 到 trajectory status union
- 把 background.ts 里 gate-blocked 时 emit 改为 `gateway-blocked`
- 把 off-mode / dry-run-only 时 emit 改为 `off-mode-kill`（当前这些状态从未被 record，要补上）
- metrics.ts 新增两个计数器并在对应路径 increment

**Patterns to follow:** 现有 `fill-completed` emit 调用作为搬运模板

**Test scenarios:**
- Happy path: `fill-completed` 在完整 fill 流程后 emit，计数器 +1
- 分支: gateway-blocked 时 emit `gateway-blocked`，`fill-completed` 不变
- 分支: off-mode 时 emit `off-mode-kill`，`fill-completed` 不变
- Error path: 三态均不干扰彼此的计数器

**Verification:** `grep -r "fill-completed"` 只剩完整 fill 路径；`pnpm test` 全绿

---

- [ ] **Unit 2: host-surface 单一真相源**

**Goal:** 消除 4 处 host-surface 定义，build-time 有等价性断言

**Requirements:** R2

**Dependencies:** Unit 1（无硬依赖，但建议顺序做避免 PR 污染）

**Files:**
- Create: `packages/shared/src/authorized-hosts.ts`
- Modify: `packages/extension/wxt.config.ts`（import `AUTHORIZED_HOSTS`）
- Modify: `packages/extension/entrypoints/content.ts`（import 替换硬编码）
- Modify: `packages/extension/entrypoints/background.ts`（runtime check import）
- Create: `packages/extension/lib/authorized-hosts.test.ts`（等价性断言）

**Approach:**
- 先 grep 找出全部 4 处：`grep -rn "51acgs\|authorized.*host\|DEFAULT_HOSTS" packages/` 确认范围
- 新建 `authorized-hosts.ts`，导出 `export const AUTHORIZED_HOSTS = ['https://51acgs.com'] as const`
- 逐一替换；wxt.config 的 import 需在 build-time 可解析（shared 已有 dist 或被 tsconfig path 覆盖，需验证）
- 等价性测试：`expect(new Set(AUTHORIZED_HOSTS)).toEqual(new Set(wxtConfigHosts))` 在单测中用 import 实际模块做比对

**Test scenarios:**
- Happy path: 4 处引用 import 同一常量，单测断言通过
- Build regression: 修改 `authorized-hosts.ts` 后只需改一处，单测捕获任何遗漏

**Verification:** `grep -rn "51acgs.com" packages/extension/` 只找到 `authorized-hosts.ts`；`pnpm test` 全绿

---

- [ ] **Unit 3: 版本同步 + release tag**

**Goal:** `package.json` 版本对齐 CHANGELOG，打 `v0.2.1` tag 触发 `release.yml`

**Requirements:** R1

**Dependencies:** Unit 1、Unit 2 全绿（确保打 tag 时代码干净）

**Files:**
- Modify: `package.json`（root，version → `0.2.1`）
- Modify: `packages/extension/package.json`（version → `0.2.1`）
- Modify: `packages/backend/package.json`（version → `0.2.1`）
- Modify: `packages/shared/package.json`（version → `0.2.1`）

**Approach:**
- 运行 `pnpm -r exec npm version 0.2.1 --no-git-tag-version` 或手动四处更新
- commit: `chore: bump version to 0.2.1`
- 等 CI 绿后，`git tag v0.2.1 && git push origin v0.2.1` 触发 `release.yml`

**Test scenarios:**
- 打 tag 后 `release.yml` 自动触发，artifact 产出 chrome-mv3 zip

**Verification:** GitHub Release 页有 v0.2.1，附件存在

---

- [ ] **Unit 4: preflight 自检脚本**

**Goal:** `pnpm preflight` 机械验证所有可逆 runbook 项，输出 red/green 一行结论

**Requirements:** R4

**Dependencies:** 无（独立，可并行）

**Files:**
- Create: `scripts/preflight.sh`
- Modify: `package.json` scripts（添加 `"preflight": "bash scripts/preflight.sh"`）

**Approach:**
检验项（按 runbook 顺序）：
1. `CORS_ORIGIN` / `JWT_SECRET` 不是占位值（grep `.env`）
2. backend `pnpm dev:backend` 能启动（或 `/health` 返回 200）
3. dry-run 模式下跑 generate 返回 DryRunReport（curl `/api/v1/gossip/generate`）
4. metrics 端点返回 200 且 counter key 存在
5. bundle 内无 `ANTHROPIC_API_KEY` 明文（grep `.output/`）

脚本输出：每项 `✓` 或 `✗ <reason>`，末尾 `PREFLIGHT PASSED` 或 `PREFLIGHT FAILED (N items)`

**Test scenarios:**
- 不设 `.env` 时脚本报 `✗ CORS_ORIGIN missing`
- 正常配置时全部 `✓` 且 exit 0

**Verification:** `bash scripts/preflight.sh` exit code 0 时全绿

---

- [ ] **Unit 5: 发布 checklist 文档**

**Goal:** 记录不可逆操作步骤，防止首次发布遗漏或顺序错误

**Requirements:** R5

**Dependencies:** 无（独立，可并行）

**Files:**
- Create: `docs/ops/release-checklist.md`

**Approach:**
分两节：
- **可逆预检**（由 `pnpm preflight` 覆盖，列出同步确认）
- **不可逆步骤**（按顺序）：
  1. 生成 `JWT_SECRET`（`openssl rand -base64 32`）
  2. 生成 `JWT_ADMIN_PASSWORD_HASH`（bcrypt 命令）
  3. 确认 LLM API key 未出现在 git history
  4. 设置 `CORS_ORIGIN` 为生产 extension ID
  5. 在 extension 侧授权目标域（authorize 按钮）
  6. 执行 first-flight wizard 干跑（dry-run 确认 DryRunReport 绿）
  7. 切换到 authorized 模式，执行单篇

**Test scenarios:**
- N/A（文档单元）

**Verification:** `docs/ops/release-checklist.md` 存在，PR reviewer 确认无遗漏步骤

---

## System-Wide Impact

- **Interaction graph:** trajectory 三态改动影响所有 `emitTrajectory()` 调用点 + metrics dashboard 展示（MetricsView.tsx）
- **Error propagation:** gateway-blocked 若错误 emit 为 fill-completed 会误增 fill 计数器——三态分离后计数器需同步更新
- **API surface parity:** host-surface 改动不影响对外 API，但影响 content script 的 matches 字段，需验证注入在目标域仍触发
- **Unchanged invariants:** SSRF allowlist、JWT 鉴权逻辑、grounding gate 均不变

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| wxt.config.ts 的 `import` 在 build-time 不支持 shared dist | 先在 wxt.config 里用 `require()` 或确认 tsconfig path alias；失败则退回 `const` 直接定义，等价性测试仍有效 |
| 三态分离遗漏某个 emit 点 | Unit 1 测试通过 grep 覆盖所有调用点，不依赖记忆 |
| 打 tag 后 release.yml artifact 打包失败 | CI 已覆盖 build，问题会在 PR 阶段暴露；release 前跑 `bash scripts/check-all.sh` |
| preflight.sh 检测 backend 需要真实启动 | 脚本检测 port 3001 是否已在监听，若未启动则输出提示要求先 `pnpm dev:backend` |

## Documentation / Operational Notes

- `docs/ops/release-checklist.md` 是本次发布的主操作文档
- CHANGELOG 需在 Unit 3 前确认已包含当前所有条目
- `onlyBuiltDependencies` warning（extension `package.json`）是 pnpm workspace 警告，非阻断，可在下个迭代修

## Sources & References

- 想法文档: `docs/ideation/2026-06-15-open-ideation-r3.md`（想法 #2 前置、#4、#6）
- CHANGELOG: `CHANGELOG.md`
- CI: `.github/workflows/release.yml`
- 内存: `.ai-memory/project_51guapi.md`
