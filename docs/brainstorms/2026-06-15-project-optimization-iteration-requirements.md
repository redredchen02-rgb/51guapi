---
date: 2026-06-15
topic: project-optimization-iteration
---

# 全面优化迭代 — 需求文件

## Problem Frame

51publisher 的核心逻辑已经成熟且硬：三世界模型、防幻觉事实注入、安全闸门链（auth fail-closed / SSRF 默认拒绝 / 发布·grounding 闸 / XSS 消毒）都真实落地且有对抗性测试守护。一次四维度体检（安全 / 技术债 / 测试 / DX-Ops）确认：**风险不在脊椎，在边缘**——项目指南文件与现实脱节、首飞运营从未执行、CI/测试是「被动漂移」架构。

受影响者是**单人运营者**：照错误文件走会浪费除错时间；「可上线」目前是愿望而非事实。本轮目标是把这些边缘缺口一次收齐，让项目从「能跑的代码」变成「可信地上线并维护的产品」。

体检基线（2026-06-15）：33k 行 TS、86 个测试档、`pnpm -r compile` 全绿、实际仅 1 处 TODO（非散落债务）。

## Requirements

**A. 真相校正（文件 vs 现实，P0）**
- R1. 修正 `CLAUDE.md` / `AGENTS.md` / `.ai-memory/*` 中所有「remote 是 GitLab」「活跃 CI 是 `.gitlab-ci.yml`」的陈述：实际 remote 为 `github.com/redredchen02-rgb/51publisher`，活跃 CI 为 `.github/workflows/`（`.gitlab-ci.yml` 不存在）。删除全部死掉的 GitLab 引用。
- R2. 修正 `CLAUDE.md` 中「路由在 `index.ts` 统一 `register*Routes`」的描述——实际**大部分**路由在 `app.ts` 注册，`index.ts` 仅注册 `registerDraftRoutes`（措辞勿写成「全部移到 app.ts」，否则制造新漂移）；顺带复核 e2e/field-mapping guide 的同类陈述。

**B. 首飞运营 Runbook（P0）**
- R3. 把记忆档里散落的首飞待办固化成一份可勾选的 runbook：密钥轮换（`JWT_SECRET` / `JWT_ADMIN_PASSWORD_HASH` / 疑泄漏的 `LLM_API_KEY`）、两条路径各 ≥1 篇真实发布冒烟、前台核验、CORS 收紧（U13）、推送到 GitHub。
  - **CORS 收紧不变量**：扩展须先在 manifest 内 pin `key`（固定 `chrome-extension://<id>`），再以该确定 origin 收紧；禁止为迁就浮动 id 放宽到通配/多 origin（保持后端 fail-closed）。注：`wxt.config.ts` 已设默认 `EXTENSION_KEY`，id 实际已固定（见 Dependencies）。
- R4. Runbook 中明确「代码闸门只能挡占位符，挡不了已泄漏但够强的旧密钥」——轮换是运营者必须亲手执行的硬前置，不可由代码自动完成。`LLM_API_KEY` 须拆成两个独立勾选项：(1) 在 LLM 供应商控制台**显式 revoke 旧 key**（生成新 key ≠ 撤销旧 key）；(2) 定位泄漏源——若旧 key 曾进 git 历史或扩展打包产物，用 filter-repo/BFG 清史 + force-push，否则任何 clone 仍可取得。

**C. CI 与测试硬化（被动漂移收敛，P1）**
- R5. 在 `.github/workflows/ci.yml` 增加 `pnpm test:e2e` 与 `pnpm check:fixtures` 两个 job（产品核心风险：填充正确性、防夹带机密，目前只在本地验）。**前置**：先完成 R8，再加跑这些测试的 CI job。
- R6. 收敛 git-hook 缺口：`package.json` **已有** `"postinstall": "git config core.hooksPath scripts/git-hooks"`——勿重复造。真正残留缺口是 postinstall 只在 `pnpm install` 后触发，bare `git clone` 与 CI 不覆盖。故本项收窄为：在 CI 加一道**无条件强制**的 gitleaks job 作后备闸。
- R7. 把固定版本的 gitleaks 定为 CI 强制闸（**且**，非「或」R6 的本地 hook）：本地 hook 仅作快速反馈，CI gitleaks 失败即 fail pipeline，使密钥拦截不依赖任何 clone 端配置。先确认 `scripts/check-fixture-secrets.sh` 当前实际检测逻辑（keyword 搜不到 gitleaks/regex，「非穷尽 regex 后备」描述需核实）再决定替换什么。
- R8. 补安全边角测试：SSRF DNS-rebind（`dns.lookup` 返回 public-then-private → 期望 `SsrfError`）；grounding-gate「连结 host 不在 facts 内 → 期望 block」。**（R5/R9 跑这些测试前的前置项）**
- R9. 加一个带合成 blur/keydown 提交 handler 的 e2e fixture 变体，证明 fillers 不会触发动态提交——补上「永不自动发布」不变量目前唯一靠人工冒烟兜底的盲区。**定为 R11 的前置**（非可选）：R11 拆的正是提交手势/审批栏/diff 等互动最重组件，而这些互动落在现有 jsdom e2e 蓋不到的盲区；不先闭合 R9，R11 的「行为零回归」无法被自动验证。

**D. 代码健康重构（P1）**
- R10. 抽出统一 `apiFetch()` helper（base URL + timeout + `401→clearToken`），把 6 个 client（pending/gossip/config/published-posts/prompt/auth）里重复 20+ 次的样板收成薄包装。
- R11. 拆 `BatchReviewPanel.tsx`（1236 行、95 处 inline style）为 item-card / approval-bar / diff 子组件；抽离 `TodayBatchView`(692) 与 `BatchView`(544) 重叠的 batch-state 逻辑；集中 style token。

**E. 卫生与可维护性（P2 — 已拆出到跟进迭代，本轮不做）**

> 决策（2026-06-15 文件审查后）：E 组对「可信上线」零贡献，为避免把上线时机压在最慢一环之后，整组降为跟进迭代。本轮范围收敛为 A→C→B→D。以下保留供下轮规划引用。
- R12. 把 `src/scraper/` 下的 `gossip/pending/prompt/scraper` 四个 `*-routes.ts` 移到 `src/routes/`，与 auth/batch/config/published-posts 对齐；`scraper/` 只留 adapters/ssrf/scheduler。
- R13. 给 `fewShotExamples`（`@deprecated`，与 `fewShotPairs` 双真相）设清除里程碑；UI 全面读 `fewShotPairs` 后删除派生字串与迁移垫片。
- R14. 把已完成/被取代的计划文件移到 `docs/plans/archive/`（23 份中 19 份含 pivot/phase/superseded 语义），让活跃计划一眼可读。
- R15. 删除投机性死字段（如 `TodayBatchView.tsx:212` 的 `void postStatus; // 计划中的字段`），YAGNI。
- R16. 观测性补强：**本轮最小切片仅 pino redaction**（防 secret 进日志，有上线相关 payoff）；per-env level 调节与 `/healthz` 文档无当前监控消费者，留待真有 ops/告警需求时再做。

## Success Criteria
- 任何人（或 agent）只读项目文件就能正确找到 remote 与 CI，不会被误导（R1-R2 验收：`CLAUDE.md` / `AGENTS.md` / `.ai-memory/*` / `docs/*` 中零 GitLab 残留、CI 描述与 `app.ts` 一致）。
- 首飞 runbook 走完一遍：≥1 篇真实发布成功、前台核验通过、密钥已轮换、CORS 已收紧（R3-R4）。
- CI 一次跑通即覆盖 e2e + fixture 脱敏；fresh clone 后 hooks 自动生效（R5-R7）。
- **首飞冒烟先于重构通过**：≥1 篇真实发布（或 dry-run + 1 篇真发）成功、前台核验，确立「填充基线真实有效」后才动 D 组（B 前置于 D）。
- 重构后 `pnpm -r compile` / `pnpm test` / `pnpm test:e2e` 全绿，行为零回归；R9 盲区测试已闭合方可宣告 R11 零回归；client 样板单点维护（R8-R11）。
- （E 组 P2 卫生验收 R12-R16 移至跟进迭代，不计入本轮。）

## Scope Boundaries
- **不**重写安全闸门链或三世界模型——体检确认其健康，动它只增风险。
- **不**新增产品功能（选题智能、批量体验、学习闭环等留待后续迭代）。
- **不**迁移存储或引入新框架（JSON/SQLite 双轨保持现状）。
- 首飞的密钥轮换与真实发布**由运营者亲手执行**；本轮只产出 runbook 与代码侧前置，不代执行不可逆的生产动作（密钥轮换/CORS 收紧/push）。但「冒烟验证一篇能否真发」前移为重构前置，由运营者尽早跑一次。
- **E 组（P2 卫生）本轮不做**，拆到跟进迭代；本轮范围收敛为 A→C→B→D。

## Key Decisions
- **首飞前置 + P2 拆出（2026-06-15 文件审查后定）**：北极星「可信上线」只有 B 组首飞能达成，故把 B 组的「dry-run + ≥1 篇真实发布冒烟」前移到 D 组重构之前——先以一次真实发布证伪/证实「可上线」假设，让重构建在已验证的填充基线上。E 组（P2 卫生）整组降为跟进迭代。本轮范围：A → C(R8) → B(冒烟验证基线) → D。
  - 注：密钥轮换 / CORS 收紧等**不可逆**运营动作仍留后段，只把**廉价、高证伪价值**的冒烟前移。
- 重构（D 组）以「行为零回归 + 测试守护」为前提；R9（动态提交盲区测试）为 R11 硬前置，先补 R8 安全测试再动相关代码。
- 真相校正（A 组）优先级最高且成本最低，应最先落地——它在阻塞其他所有照文件行事的工作。
- 范围全包的原始理由「体检已暴露全貌，一次收齐优于分批」未对比「先 A+B 上线、C-E 后置」的更小子集；审查后采纳更小子集（A→C→B→D），P2 后置。

## Dependencies / Assumptions
- 假设 `github.com/redredchen02-rgb/51publisher` 是唯一正确 remote（已 `git remote -v` 验证）。
- R3/R4 依赖运营者持有真实 `.env` 与目标站点登录态；规划无法代替执行。
- **e2e 跑在 jsdom（非真浏览器）+ 真 Quill 2.0.2**（已核 `vitest.e2e.config.ts` `environment: "jsdom"`）——CI 无需 headless 浏览器，只需确认 jsdom 下 Quill 依赖可装，余下仅「CI runner 稳定性」为真正待验项。
- **扩展 id 已固定**：`wxt.config.ts` 设 `key: EXTENSION_KEY`（有硬编默认值），manifest 含固定 key → `chrome-extension://<id>` 确定。CORS allowlist 可由该 key 直接算出 id；唯一变量是 CI/release 是否经 env 覆盖 `EXTENSION_KEY`。

## Outstanding Questions

### Resolve Before Planning
- （无阻塞规划的产品决策——范围与边界已定）

### Deferred to Planning
- [Affects R5][Technical] e2e（jsdom + 真 Quill）在 GitHub Actions runner 是否需要额外 DOM/global polyfill？Quill 的 range/selection API 在 jsdom 下是否全可用？（已确认无需 headless 浏览器）
- [Affects R7][Technical] `scripts/check-fixture-secrets.sh` 当前实际检测逻辑是什么？「非穷尽 regex 后备」描述未经 keyword 验证，须先确认再决定 gitleaks 替换什么。
- [Affects R3][Technical] CI/release 构建是否经 env 覆盖 `EXTENSION_KEY`？这决定 dev 与 production 的 `chrome-extension://<id>` 是否一致（id 固定性本身已确认）。
- [Affects R11][Technical] god-component 拆分的边界以哪个 state 容器为锚（现有 hook vs 新 context），需读代码定夺——视为 R11 实施的硬前置，非细节。

## Next Steps
→ `/ce:plan` 进行结构化实施规划。本轮排序 **A → C(含 R8) → B(冒烟验证基线) → D(R9 前置后再 R11)**；E 组（P2 卫生）拆到跟进迭代。先校正真相、补安全测试与 CI、用一次真实发布验证可上线、再在验证过的基线上重构。
