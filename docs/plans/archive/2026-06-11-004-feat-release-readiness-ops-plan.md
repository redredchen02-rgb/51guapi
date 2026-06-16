---
title: "feat: 发布就绪 — 自用日常运营收尾"
type: feat
status: active
date: 2026-06-11
origin: docs/brainstorms/2026-06-11-release-readiness-requirements.md
---

# feat: 发布就绪 — 自用日常运营收尾

## Overview

把 51publisher 从「五阶段开发完毕」推到「单操作者每天安心跑批量」。工作分四块:合入基线(MR!6/!7 → main)、安全闭环(凭证轮换 + CORS 收紧)、真发批次验收、运营 runbook。功能开发冻结,只做 hardening 与收尾。

## Problem Frame

见 origin 文档。代码与测试基线健康,但成果未合入 main、疑似泄漏的 LLM key 未轮换、日常主力的批量发布路径(路径 B)未真发验证、运营知识散落在记忆与计划文档中。

## Requirements Trace

- R1. MR!6/!7 合入 main,`check-all.sh` 全绿(含前置 commit 核对)
- R2. `dailyBatchSize` 进 shared Settings + 修复隐藏编译破洞(grounding gate 前置检查已完成,仅需核销 TODOS)
- R3. 凭证轮换:LLM key 立即(吊销+泄漏排查),JWT 类随后(轮换+401 验证)
- R4. CORS 收紧到扩展 origin(多值 allowlist,禁 `*` 兜底)
- R5/R6. 路径 B 真实批次验收(≥3 项、人为构造 ≥1 项 gate-failed)+ 异常路径抽查
- R7. `docs/ops-runbook.md`(含备份/恢复演练、脱敏约束)
- R8. 首周观察点(阻断/非阻断两档判定)

## Scope Boundaries

- 不做多用户/交付他人部署体验;不做新功能;不重启 SQLite 全面迁移(见 origin)

## Context & Research

### Relevant Code and Patterns

- `packages/extension/lib/batch-orchestrator.ts` — runBatch 已含 eager grounding gate(行 162-175,fail-open,`markGateFailed` filled→gate-failed);`approveBatch` 另有 authorized 模式硬闸。**TODOS.md 此项已过时**
- `packages/shared/src/types.ts:86` — `Settings` 接口,缺 `dailyBatchSize`;extension 端 `lib/storage.ts`(DEFAULT 5、clamp [1,20])与 `TodayBatchView.tsx` 已在用 → 对新鲜 shared dist 跑 tsc 有 4 个错误(TodayBatchView dailyBatchSize、BatchReviewPanel 缺 gate-failed label、TodayBatchView:88 id undefined、background.test.ts TS2532×3)
- `packages/backend/src/env-check.ts:39-46` + `index.ts:32-39` — CORS fail-closed,`CORS_ORIGIN` 逗号分隔多值原生支持
- `packages/extension/wxt.config.ts` — manifest 无 `key`,扩展 ID 不固定
- 既有文档:`docs/run-sheet-首飞与基线.md`(最接近 runbook)、`scripts/start-backend.sh`、`docs/batch-usage-guide.md`、`.env.example`

### Institutional Learnings

- 多 MR 合并冲突:doc-sync 子代理曾越界改功能文件;冲突时 `git checkout HEAD -- <file>` 保 HEAD 模式有效(repo-ops-gotchas)
- `runBatch` 的 `filterReentrantTopics` 会过滤已发布/隔离题目——重跑同批需 `bypassReentry`,否则静默丢题
- 真发冒烟陷阱:layuiAdmin **iframe 架构**(字段全未找到先想 iframe)、`pickAdminTabId` tab 定位、改 content script 必须「重载扩展+刷新后台页」两步
- LLM key 已两次曝光记录;新 key 仅 `gemma4-*-heretic` 两模型可用,轮换后注意权限范围
- 备份既有位置 `~/51publisher-backups/`;存储双轨 JSON+SQLite

## Key Technical Decisions

- **LLM key 轮换不等任何工程任务**:持续暴露风险,与 R1 无依赖(origin Key Decisions)
- **CORS 用多值 allowlist 而非固定扩展 ID**:后端已支持逗号分隔;给 manifest 加 `key` 改动面更大且影响已安装扩展身份。dev+打包两个 ID 都进 allowlist,runbook 记录「ID 变更→更新 CORS_ORIGIN」恢复路径。CORS 是纵深防御,JWT 仍是主闸
- **R2 范围修正**:grounding gate 前置检查已实现,R2 实际工作 = shared Settings 补字段 + 修 4 个编译错 + Settings UI 露出该设置;并把 TODOS.md 两项核销
- **R5 验收用真实批次**(≥3 项含人为 gate-failed),验证分流/重试/隔离,而非单篇成功(origin 审查决议)

## Open Questions

### Resolved During Planning

- CORS 单值还是多值?→ 多值(后端原生支持),dev/prod ID 并存
- grounding gate 是否要新写?→ 已存在,只需核销与冒烟覆盖
- 后端常驻方案?→ 手动 `start-backend.sh` 足够(单机自用);若日后改 launchd 常驻,须确认仅监听 127.0.0.1

### Deferred to Implementation

- 打包扩展的实际 Origin 头形态(background fetch 是否带 `chrome-extension://<id>`)——R4 实测时确认
- 凭证轮换后扩展端缓存 token 的失效表现——R3 验证时观察并写进 runbook token 条目

## Implementation Units

- [ ] **Unit 0: LLM_API_KEY 立即轮换(操作者协同,不依赖其他单元)**

**Goal:** 关闭持续暴露的泄漏风险。

**Requirements:** R3(立即部分)

**Dependencies:** 无。最先执行。

**Files:**
- Modify: `packages/backend/.env`(本地,不入库)

**Approach:**
- 提供商控制台生成新 key → 显式吊销旧 key → 用旧 key 调一次 API 确认 401/无效
- 泄漏途径排查:`git log -p` 全历史搜 key 片段、scratch 目录、日志;结论记入 `.ai-memory`
- 换入新 key 后起后端跑一次生成,确认 `gemma4-*-heretic` 模型仍可用

**Test scenarios:**
- Error path: 旧 key 调用 → 拒绝(401/invalid)
- Happy path: 新 key 起后端 + 单条草稿生成成功

**Verification:** 旧 key 实测作废;新 key 生成链路通;泄漏排查结论已记录。

- [x] **Unit 1: 核对并合入 MR!6/!7 到 main**

**Goal:** main 成为日常运营唯一基准。

**Requirements:** R1

**Dependencies:** 无(与 Unit 0 并行)。

**Files:** 无代码改动(合并操作);可能触碰冲突文件。

**Approach:**
- 前置核对:`git log main..<!6分支>` 与 `git log main..<!7分支>`,确认 !6 每个 commit 是否含于 !7;不在则逐项判断
- 合 !7(联合 MR);若 !6 全被包含则关闭 !6
- 冲突处理沿用 checkout-HEAD 经验,警惕 doc-sync 越界改动
- 合后在 main 跑 `bash scripts/check-all.sh`

**Test scenarios:**
- Integration: fresh `pnpm install` → build → compile → test 全绿(防 stale tsbuildinfo 假绿,先删 `*.tsbuildinfo` 或 fresh clone)

**Verification:** main 上 check-all 全绿;GitLab 两个 MR 状态闭合。

- [x] **Unit 2: dailyBatchSize 进 shared Settings + 修编译破洞**

**Goal:** 消除「旧 dist 假绿」,补全设置链路。

**Requirements:** R2

**Dependencies:** Unit 1(在 main 之上做,或合并前在分支上修——若 MR!7 尚未合,优先在分支修复后再合,避免把破洞带进 main)。

**Files:**
- Modify: `packages/shared/src/types.ts`(Settings 加 `dailyBatchSize?: number`)
- Modify: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`(补 gate-failed label)
- Modify: `packages/extension/entrypoints/sidepanel/TodayBatchView.tsx`(id undefined 收窄)
- Modify: `packages/extension/entrypoints/background.test.ts`(TS2532 修复)
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`(露出 dailyBatchSize 输入,clamp [1,20] 已在 storage 层)
- Test: `packages/extension/lib/storage.test.ts`、`entrypoints/sidepanel/Settings.test.tsx`
- Modify: `TODOS.md`(两条 P1 核销:dailyBatchSize 完成;grounding gate 标注已于 phase5 分支实现)

**Approach:** 先 `pnpm --filter @51publisher/shared build` 出新鲜 dist,再以 `pnpm compile` 全绿为修复完成判据。

**Patterns to follow:** `lib/storage.ts` 既有 clampDailyBatchSize;Settings.tsx 既有字段编辑模式。

**Test scenarios:**
- Happy path: 设置 dailyBatchSize=10 → 持久化后读回 10
- Edge case: 输入 0 / 25 → clamp 到 1 / 20;未设置 → 默认 5
- Happy path: BatchReviewPanel 渲染 gate-failed 项显示对应标签与 gateFailReason

**Verification:** 新鲜 shared dist 下 `pnpm compile` 全绿;`pnpm test` 全绿。

- [ ] **Unit 3: JWT 凭证轮换与验证(操作者协同)**

**Goal:** 完成 U8/U14 遗留的 JWT 类轮换。

**Requirements:** R3(JWT 部分)

**Dependencies:** Unit 1(在最终基线上验证)。

**Files:**
- Modify: `packages/backend/.env`(本地)

**Approach:**
- `node packages/backend/scripts/hash-password.mjs` 生成新 `JWT_ADMIN_PASSWORD_HASH`;生成强 `JWT_SECRET`(命令见 `.env.example`)
- 验证序列:fail-closed 启动正常 → 旧 token 调受保护路由 401 → 扩展端 clearToken 重登成功

**Test scenarios:**
- Error path: 旧 token → 401;弱值 `.env` → 启动拒绝
- Happy path: 新密码登录 → token 颁发 → 受保护路由 200

**Verification:** 三步验证序列全过;观察并记录扩展端缓存 token 的失效表现(供 runbook)。

- [x] **Unit 4: CORS 收紧(U13)**

**Goal:** `CORS_ORIGIN` 从宽配置钉到扩展 origin allowlist。

**Requirements:** R4

**Dependencies:** Unit 3(凭证稳定后),且在 Unit 5 真发冒烟前完成,使冒烟覆盖收紧后的真实配置。

**Files:**
- Modify: `packages/backend/.env`(本地);必要时 `packages/backend/.env.example` 注释补多值示例

**Approach:**
- 打包扩展(`pnpm build:extension`)与 dev 形态各取一次扩展 ID;实测 background fetch 的 Origin 头形态(deferred question)
- `CORS_ORIGIN=chrome-extension://<dev-id>,chrome-extension://<prod-id>`;禁止放宽为 `*`(后端 fail-closed 已禁,保持)
- 失败回退预案:仅放多 ID,不放宽通配

**Test scenarios:**
- Happy path: 打包扩展真实请求(登录+批次同步)通过
- Error path: 不在 allowlist 的 origin 浏览器内请求被 CORS 拒绝(curl 不受 CORS 限制属预期,JWT 仍拦)

**Verification:** 两种形态扩展均能正常调后端;`cors.test.ts`/`env-check.test.ts` 仍绿。

- [ ] **Unit 5: 路径 B 真实批次验收 + 异常路径抽查(操作者协同)**

**Goal:** 用真实批次证明日常主力流程可用。

**Requirements:** R5、R6

**Dependencies:** Units 1-4 全部完成。

**Files:** 无代码改动;结果记录入 `.ai-memory` 与 runbook 素材。

**Approach:**
- 批次构成:≥3 项待审池题目,其中 ≥1 项人为构造缺事实(触发 gate-failed)
- 验证点:gate-failed 分流可见、gateFailReason 展示、重试(gate-failed→queued)、隔离区行为、≥1 篇真实发布并前台核验
- 注意 `filterReentrantTopics`:重跑同批需 `bypassReentry`,否则静默丢题
- 异常抽查:SW 重启恢复覆盖两个杀点(生成中、生成完成未落盘);后端停机时扩展 fail-closed 降级一次
- 冒烟失败排查顺序:iframe 下钻 → tab 定位 → 扩展重载+刷新后台页

**Test scenarios:**
- Happy path: 正常项走完 生成→gate→审批→填充→发布,前台可见
- Error path: 缺事实项落 gate-failed 并显示原因;补事实后重试成功
- Integration: SW 两杀点恢复后批次状态正确;后端不可达时本地状态继续可用

**Verification:** 上述验证点全部观察到且符合预期;发布帖前台核验通过。

- [x] **Unit 6: 运营 runbook + 首周观察机制**

**Goal:** 操作者不看聊天记录即可独立运营。

**Requirements:** R7、R8

**Dependencies:** Unit 5(吸收冒烟实测经验)。

**Files:**
- Create: `docs/ops-runbook.md`
- Modify: `TODOS.md` 或 `.ai-memory`(首周观察记录位置)

**Approach:**
- 章节:后端启停(`scripts/start-backend.sh`)、每日批量步骤(引用 `docs/batch-usage-guide.md` 与冒烟实测)、备份(每周+真发后;**停后端后拷贝或对 .sqlite 用 `sqlite3 .backup`**;目标 `~/51publisher-backups/`,仓库外、不入同步盘;不含 `.env`)、一次性恢复演练(备份→清 data/→恢复→后端启动验证)、常见故障(token 过期→重登、后端挂、扩展 ID 变更→更新 CORS_ORIGIN、填充失效→fixture 重抓慢循环、字段全未找到→iframe、无法连接→tab/重载两步)
- 首周观察两档:阻断性异常(填充失效、闸门误放行)当日处理走慢循环;非阻断累计记录、周末回顾
- 脱敏约束:不含任何真实凭证/token/hash,仅引用 .env 变量名与生成命令;提交前人工核对

**Test scenarios:** Test expectation: none — 纯文档单元;验收 = 恢复演练实际执行一次成功。

**Verification:** runbook 覆盖 origin R7 全部条目;恢复演练通过;文档无敏感值。

## System-Wide Impact

- **Interaction graph:** Unit 2 触及 shared types → backend/extension 双端编译;Unit 4 触及后端启动校验与扩展全部 fetch
- **Error propagation:** CORS 配错 = 后端拒启或扩展全断流(fail-closed),故 Unit 4 排在冒烟前、且保留多 ID 回退预案
- **State lifecycle risks:** 凭证轮换使存量 token 立即失效——预期行为,runbook 收录重登流程;备份须避开 SQLite 热拷贝
- **Unchanged invariants:** 零提交铁律(第三方平台)、发布闸门链、注入面=闸门面三处同步——本计划全部不触碰

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| MR!6 含 !7 未带的独立 commit,被静默丢弃 | Unit 1 前置 git log 逐 commit 核对,不预设取 !7 |
| 旧 shared dist 假绿掩盖编译破洞 | Unit 1/2 验证一律先重建 shared dist 或 fresh clone |
| CORS 收紧后扩展断流 | 多值 allowlist + dev/prod 双 ID + runbook 恢复条目;排在冒烟前实测 |
| 重跑批次静默丢题(reentry 过滤) | Unit 5 明确 bypassReentry 注意点并写入 runbook |
| 新 key 模型权限范围变化 | Unit 0 轮换后立即跑一次生成验证 gemma4-heretic 可用 |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-11-release-readiness-requirements.md](../brainstorms/2026-06-11-release-readiness-requirements.md)
- Related code: `packages/extension/lib/batch-orchestrator.ts`、`packages/shared/src/types.ts`、`packages/backend/src/env-check.ts`、`packages/extension/wxt.config.ts`
- Related MRs: GitLab !6、!7
- Learnings: `.ai-memory/project_51publisher.md`、auto-memory `repo-ops-gotchas` / `content-quality-gated-baseline` / `intelligent-publisher-roadmap`、`docs/solutions/developer-experience/claude-in-chrome-script-redaction-backend-verify-2026-06-05.md`
