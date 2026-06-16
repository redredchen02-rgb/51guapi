---
title: "feat: 全面迭代路线图 — 首飞到产品能力升级"
type: feat
status: active
date: 2026-06-16
origin: 用户需求 + 多轮体检对账 (2026-06-09 至 2026-06-15)
supersedes: []
---

# 全面迭代路线图 — 首飞到产品能力升级

## Overview

51publisher 核心脊椎（三世界模型、防幻觉事实注入、安全闸门链、CI 管线）已硬。多轮迭代（06-09 至 06-15）已落地 grounding 完整字段防护、空缺事实填充、首飞工具链、安全网 CI 硬化。

但北极星缺口仍在：**从未真实发布过**。本计划按「首飞 → 收尾 → 度量 → 产品 → 运维」五阶段依序推进，从让第一篇内容真实上线，到基于运营数据提升批量发布效率。

## Current Status Baseline (2026-06-16)

| 维度 | 状态 | 关键信号 |
|------|------|----------|
| 类型检查 | ✅ | `pnpm -r compile` 全绿 |
| 测试 | ✅ | 后端 ~300 / 扩展 ~670 / e2e 绿 |
| 构建 | ✅ | 双端 build 成功 |
| CI | ✅ | compile + lint + test + e2e + fixture + gitleaks |
| 安全闸门 | ✅ | SSRF/grounding/XSS/auth/CORS/rate-limit |
| 防幻觉 | ✅ | grounding Phase 1+2 已合入 |
| 首飞工具链 | ✅ | CLI wizard + runbook 已产出 |
| 产品完成度 | 🔴 | **真实发布 = 0** |
| 技术债 | ✅ | 计划文件已归档 / routes 已移入 routes/ / TypeBox 已全覆盖 / graceful shutdown + Request ID + CSP + bodyLimit 已落地 |
| 运维基础 | ✅ | Graceful shutdown / Request ID / CSP / bodyLimit / pino redaction / rate limit 均已落地 |
| 扩展 UX | ✅ | Loading states 已补齐 / structured logger 已落地 / Settings 已拆为 hooks + sections |
| 真实发布 | 🔴 | **尚未执行首飞（需人工操作）** |

## Core Sequencing Logic

```
Phase 0: 首飞落地 (P0)        ← 北极星缺口，先于一切
Phase 1: 收尾清理 (P1-P2)     ← 低成本高价值，穿插 Phase 0 间隙
Phase 2: 度量与学习闭环 (P1)   ← 需要首飞数据输入
Phase 3: 产品能力升级 (P1)     ← 运营经验驱动
Phase 4: 运维与可观测 (P2)     ← 持续改进，穿插各周
```

## Success Criteria

- Phase 0: ≥1 篇真实发布成功 + 前台核验通过
- Phase 1: 计划文件已归档 / 无 deprecated 引用 / routes 统一 / CI audit step 绿
- Phase 2: 度量 tab 可用 / golden-set 可一键跑 / 反馈通道存在
- Phase 3: 一批操作时间降低 ≥30% / 选题推荐可衡量
- Phase 4: 无裸 console.log / 构建时间已知 / graceful shutdown 可工作

---

## Phase 0: 首飞落地 (P0)

**Goal:** 从「从未真发」到「≥1 篇真实发布成功」。代码侧前置已就绪，卡在不可逆运营动作。

### Unit 0.0: 合入当前分支

**HEAD 当前在 `fix/metrics-counters-wiring`，须合入 main。**

**Approach:**
- 确认 `pnpm -r compile` + `pnpm test` + `pnpm test:e2e` 全绿
- PR → main（若为修复分支则直接 merge 或 squash-merge）
- 若存在冲突，保持 main 基线正确

**Verification:** `pnpm -r compile` + `pnpm test` 绿；HEAD 在 main

### Unit 0.1: 运营者执行首飞 runbook

**按 `docs/runbooks/first-flight-runbook.md`（已产出）逐项执行，由运营者亲手执行不可逆动作。**

**Steps:**
1. **密钥轮换**
   - `LLM_API_KEY`：供应商端 revoke 旧 key → 验证返回 401 → 生成新 key → 注入 env / GitHub Secrets
   - 若旧 key 曾进 git 历史：filter-repo/BFG 清史 + force-push
   - `JWT_SECRET` / `JWT_ADMIN_PASSWORD_HASH`：scrypt 重新生成（命令见 AGENTS.md:24-26）
2. **CORS 收紧**
   - 用 `EXTENSION_KEY` 派生 id 填 `CORS_ORIGIN`（逗号分隔，含 dev + 打包 id）
   - 确认 dev/prod 的 `EXTENSION_KEY` 策略是否一致
   - 禁放宽到 `*`
3. **dry-run**
   - `orchestratePublish` 返回 `dryRun:true`，确认闸链行为
4. **真发冒烟**
   - 真实批次 ≥3 项（含 ≥1 项人为 gate-failed）
   - 验证：分流 / 重试 / 隔离 / 成功发布
   - 前台核验：确认内容正确显示
5. **CORS 负向测试**
   - 伪造非 allowlist `Origin` → 后端拒绝（fail-closed）
   - 真实扩展 `Origin` → 放行
6. **push 到 GitHub**
   - 确认 CI 绿
   - 确认 release pipeline 不 `continue-on-error`

**Known pitfalls:**
- iframe 架构（`frame-resolve.ts`）
- 改 content script 须「重载扩展 + 刷新后台页」
- `filterReentrantTopics` 会过滤已发布题，重跑同批需 `bypassReentry`
- 重抓 fixture 若在登录态下产生，须过 `check:fixtures` 脱敏闸

**Verification:** runbook 所有勾选完成；≥1 篇真发成功 + 前台核验

### Unit 0.2: 首飞复盘记录

- 踩坑记录沉淀到 `docs/solutions/`
- 更新 `.ai-memory/project_51publisher.md` 首飞状态
- 更新 `CHANGELOG.md` 记录首飞里程碑

---

## Phase 1: 收尾清理 (P1-P2)

**Goal:** 消除所有已知技术债，让项目从「功能完备」进入「生产就绪」。

### Unit 1.1: 计划文件归档 (P2)

**Move completed/superseded plans to `docs/plans/archive/`.**

**归档判定标准:**

| Status | 文件 | 动作 |
|--------|------|------|
| completed | 06-03-001 ~ 06-05-003 (7份) | → archive |
| completed | 06-10-002/003, 06-11-001/005 | → archive |
| completed | 06-12-001/002, 06-15-001 (harden-safety-net) | → archive |
| completed | 06-15-001 (release-readiness-remediation) | → archive |
| completed | 06-15-002 (orchestration-cleanup) | → archive |
| completed | 06-15-003 (product-ux-upgrades) | → archive |
| completed | 06-15-004 (fill-missing-facts-reassemble)  | → archive |
| completed | 06-15-004 (grounding-gate-publish-basis) | → archive |
| completed | 06-15-005 (grounding-phase2) | → archive |
| superseded | 06-09-001, 06-10-001 | → archive |
| needs review | 06-11-002/003/004 | 审查后决定 |
| active | 本计划 + 06-15-005 (comprehensive-system-optimization) | 保留 |

**Verification:** `docs/plans/` 下只有活跃计划；存档文件 git 历史完整

### Unit 1.2: 废弃代码清理 (P2)

**Requirements:** 原 E 组 R13/R15

**Files:**
- `git grep -n 'fewShotExamples\|@deprecated'` → 清查全部引用
- `TodayBatchView.tsx:212` 的 `void postStatus; // 计划中的字段` → 删除

**Approach:**
- `fewShotExamples`：确认所有消费点已切到 `fewShotPairs` → 删除字段 + 迁移垫片
- 删除后 `pnpm -r compile` 绿

**Verification:** 无 `fewShotExamples` / `@deprecated` 残留；compile 绿

### Unit 1.3: Route 文件组织 (P1)

**Requirements:** 原 E 组 R12

**Files:**
```
git mv src/scraper/pending-routes.ts src/routes/pending-routes.ts
git mv src/scraper/gossip-routes.ts   src/routes/gossip-routes.ts
git mv src/scraper/prompt-routes.ts   src/routes/prompt-routes.ts
git mv src/scraper/scraper-routes.ts  src/routes/scraper-routes.ts
```
- 更新 `src/app.ts` import 路径
- `scraper/` 只保留 `adapters/` `ssrf/` `scheduler/`

**Verification:** `pnpm compile` + `pnpm test` 全绿（纯移动，零行为变更）

### Unit 1.4: TypeBox Schema 全覆盖 (P0)

**Requirements:** 06-15-005 项目 U1.1

**Files to audit:**
- `packages/backend/src/scraper/pending-routes.ts`（迁移到 routes/ 后）
- `packages/backend/src/scraper/gossip-routes.ts`
- `packages/backend/src/scraper/scraper-routes.ts`
- `packages/backend/src/routes/config-routes.ts`
- `packages/backend/src/routes/preflight-routes.ts`
- `packages/backend/src/routes/published-posts-routes.ts`

**Approach:**
- 逐 route 核查是否已有 TypeBox schema
- 缺失的补上（参考已有 `schemas.ts` 的 17 个 schema 模式）
- `app.inject` 测试确认 serialize 不静默 strip

**Verification:** 每个 POST/PUT/PATCH route 有 TypeBox 验证；`pnpm test` 绿

### Unit 1.5: 后端运维基础 (P1)

**4 项独立、低风险：**

**U1.5.1 Graceful Shutdown**
```typescript
process.on('SIGTERM', () => { app.log.info('SIGTERM'); await app.close(); process.exit(0); });
process.on('SIGINT', () => { app.log.info('SIGINT'); await app.close(); process.exit(0); });
```

**U1.5.2 Request ID**
```typescript
const server = Fastify({ genReqId: () => crypto.randomUUID() });
```

**U1.5.3 Input Size Limits**
```typescript
const server = Fastify({ bodyLimit: 1048576 }); // 1MB
```

**U1.5.4 CSP Headers**
```typescript
reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
```

**Verification:** SIGTERM → 优雅关闭；请求日志带 reqId；大 body → 413；CSP header 存在

### Unit 1.6: 依赖漏洞扫描 (P0)

**CI 集成:**
- `.github/workflows/ci.yml` 新增：`pnpm audit --audit-level=high`
- 高/严重漏洞 fail pipeline
- Dependency Review GitHub Action

**Verification:** CI run 显示 audit step 通过；故意引入有漏洞依赖 → step 红

---

## Phase 2: 度量与学习闭环 (P1)

**Goal:** 让运营者能看到发布质量数据，形成反馈链路。

### Unit 2.1: 度量面板可视化

**现有数据源:**
- `DegradeStats`（降级字段统计）
- `UsageStats`（token 用量）
- `FillStats`（填充率）
- slot-diff（操作者编辑率）
- `published_posts` 注册表

**Approach:**
- sidepanel 新增「度量」tab
- 展示：降级率趋势、token 用量、填充成功率、编辑率分布
- 复用现有 trajectory 数据

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/MetricsPanel.tsx`
- Modify: `App.tsx`（新增 tab）
- Test: 对应组件测试

### Unit 2.2: Golden-set 评估标准化

**Existing:** `docs/eval/golden-set.md`

**Approach:**
- 做成可一键运行的脚本：`pnpm eval:golden`
- 输出基准报告
- 可在 CI 中作为 non-blocking step 运行

**Files:**
- Create: `scripts/eval-golden.sh`
- Modify: `package.json`（新增 `eval:golden` script）

### Unit 2.3: 发布后反馈收集

**Approach:**
- 发布成功后显示「反馈」入口（emoji 评分 + 可选文本）
- 反馈写入 trajectory 或独立 storage
- 汇总视图展示反馈模式

**Verification:** 运营者可查看历史质量趋势；golden-set 可一键跑；有反馈通道

---

## Phase 3: 产品能力升级 (P1)

**Goal:** 基于真实运营经验，提升批量发布效率与质量。**建议 Phase 2 完成后再开始，以便用数据驱动。**

### Unit 3.1: 选题智能推荐

**Existing:** topic intelligence pipeline (`pending-client` + `gossip`)

**Approach:**
- 质量预评分（基于历史发布数据的简单模型/启发式规则）
- 排序：分高 → 低，标出「高潜力」
- 一键跳过评分低的候选
- 记录推荐准确率用于迭代

### Unit 3.2: 批量体验大幅优化

**Approach:**
- 减少操作步骤：从选题→填充→审批→发布的点击次数优化
- 智能默认值：基于历史行为自动填常用字段
- 批量操作：全选/多选 approve/reject、批量调整标签/分类
- 键盘快捷键支持

### Unit 3.3: 发布质量引擎延续

**Approach:**
- 发布前质量评分（可配置阈值）
- 内容预览增强（移动端预览、多平台格式适配）
- 发布失败智能重试（非简单 retry，分析失败原因后自适应）

### Unit 3.4: 多站点扩展预备

**Approach:**
- 后台适配器接口抽象化
- 字段映射按站点配置
- 支持同时管理多个站点的发布队列（独立 tab）

---

## Phase 4: 运维与可观测性 (P2)

**Goal:** 让生产运行更安心。不阻塞上线，持续改进。

### Unit 4.1: 扩展端 UX 补强

**Loading States（U2.1）**
- PendingTopicsView → 用 `<Loading>` 替换纯文本
- BatchView → 新增完整 loading state
- HistoryPanel → 新增完整 loading state
- 统一用 `useLoadingState` hook

**Structured Logger（U2.2）**
- Create: `packages/extension/lib/logger.ts`
- 取代 38 处 `console.log`
- Level: `info` / `warn` / `error` / `debug`（debug 由 `import.meta.env.DEV` 守卫）

**CSS Modules（U2.3）**
- Settings.tsx inline `style={{}`（15 处）→ `.module.css`
- BEM 命名：`.settings__input`、`.settings__label`
- 建立 CSS 变量文件 `styles/variables.css`

### Unit 4.2: 观测性补强

- pino redaction 已落地，per-env level 调节
- `/healthz` 增加依赖检查（LLM 端点/数据库/存储）
- 发布失败率告警阈值

### Unit 4.3: 构建与性能基线

- `.nvmrc` / `.node-version`（Node 20）
- 构建时间基线 → `docs/baselines/build-baseline.md`

---

## Scope Boundaries (Not Doing)

- **Firefox 支持**：仅 Chromium
- **JWT refresh token**：单人运营 7d access token 够用
- **JSON → SQLite 全迁移**：此前已否决，保持双轨
- **Tailwind/Turborepo/Nx**：规模不需要
- **E2E 真浏览器自动化**：jsdom 已够用
- **全量测试覆盖率门**：不受数字驱动
- **多用户系统**：保持单人运营模型

## Timeline

```
Week 1:  Phase 0 (首飞) + Phase 1 低风险 (归档/清理/TypeBox并行)
Week 2:  Phase 1 收尾 (Route/运维基础) + Phase 0 可能延续
Week 3:  Phase 2 (度量面板 + golden-set + 反馈)
Week 4-5: Phase 3 (选题智能 + 批量体验)
Ongoing: Phase 4 (运维改进 + UX 穿插各周)
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| 首飞运营者迟迟不执行不可逆动作 | runbook 严格有序；代码侧前置先行 |
| Phase 2/3 在无首飞数据基础上规划 | 刻意排序在首飞之后 |
| 大范围并行改出冲突 | 各 Phase 独立分支 PR；改前 `pnpm -r compile` |
| 多站点扩展增加维护成本 | 先抽象 adapter 接口，不实际接入新站点 |