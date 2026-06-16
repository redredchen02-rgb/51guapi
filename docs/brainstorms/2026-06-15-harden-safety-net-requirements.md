---
date: 2026-06-15
topic: harden-safety-net
---

# 补强安全网:CI/发布闸门 + 安全关键路径测试覆盖

> **2026-06-15 文档审查修订**:首版高估了缺口。经核实,`post-assembler.test.ts`、`ssrf-guard.test.ts`(14 cases)、`pending-client.test.ts`、`published-posts-client.test.ts` 均已存在;`field-mapping`、`auth-middleware` 有间接覆盖。"核心逻辑 0 测试 / 安全叙事建在未验证地基" 的原始论据**部分被证伪**,本文已据实重写。真实缺口已缩小但仍存在(见 Theme B)。

## Problem Frame

51publisher 已是成熟项目(智能化路线图全合 main、真发已验收)。一轮跨维度健检(经文档审查纠偏)发现"安全网"有几个**真实但比初判更窄**的洞:

1. **tag 发布路径的测试步骤形同虚设**——`release.yml`(仅在 tag push 触发)的测试步骤标 `continue-on-error: true`,即便测试红仍继续打包扩展 zip + 建 Docker 镜像 + 发 GitHub Release。
   - 校正:`ci.yml` 已在**每次 push/PR** 跑 `pnpm -r test` 且无 `continue-on-error`,红测在 CI 已被拦。因此本项不是"红测悄悄发布",而是"release 流程的测试门是哑的,tag 时不再独立把关"——价值在于消除误导性的哑门、确保 tag 时仍有真实测试闸。
2. **机密可能随 fixture 进公开仓库**——脱敏闸门 `check:fixtures` 只在 pre-commit hook(还需手动 `git config core.hooksPath` 启用),`ci.yml` 完全没跑。这是确凿且未被任何 CI 步骤覆盖的缺口。
3. **若干安全关键路径缺少直接/专属测试**(注意:不是"0 测试",多数有间接覆盖)——`ssrf-allowlist.ts` 的 `isHostAllowed`/`loadSSRFAllowlist` 无直测;`auth-middleware.ts` 只经 `auth-routes` 间接覆盖;4 个 extension HTTP 客户端(config/prompt/auth/gossip-client)无测;`field-mapping.ts` 仅经 e2e/contract 间接覆盖。这些是回归会"静默通过"的薄弱点。

影响对象:维护者(tag 时哑测门、机密泄漏)、最终用户(字段映射/SSRF/auth 回归无专属测试守护)。Theme A 改成本极低(改 YAML),应先做。

> 重要事实校正:`.gitlab-ci.yml` **不存在**,remote 是 GitHub,活跃 CI 即 `.github/workflows/`。CLAUDE.md 与 `.ai-memory` 在此点已过时(R5)。

## Requirements

**CI / 发布闸门加固(Theme A)**
- R1. `release.yml` 移除测试步骤的 `continue-on-error: true`:tag 发布时测试失败必须中断,不得产出 zip / Docker 镜像 / Release。(价值:消除哑测门,使 tag 路径与 push CI 同样真实把关。)
- R2. `ci.yml` 新增 `check:fixtures` 步骤,使脱敏闸门成为推送/PR 的强制门,不再只依赖手动启用的本地 hook。该步骤须在 fork/PR 触发时也运行,且排在任何 artifact 上传或持有 secret 的步骤**之前**,否则不能真正堵住泄漏路径。
- R3. `ci.yml` 新增产物校验。先核对 `ci.yml` 现有 `build shared`/`compile` 已覆盖多少,只补"产物存在性断言"这一薄层(而非重建一套与 `check-all.sh` 重复的重型 job),消除"本地绿 / CI 绿但产物坏"的缺口。
- R4. e2e 中 `skipIf(!API_KEY)` 一类条件跳过在 CI 必须可见:要么提供 key 真跑,要么显式标注"已跳过"且 CI 摘要可见,杜绝"假绿"。
- R5. 修正 CLAUDE.md 与 `.ai-memory` 中"活跃 CI 为 GitLab"的过时陈述为 GitHub Actions 实况。**注意**:`.ai-memory` 可能由 session-wrap 工具自动再生,纯文本一次性改可能被覆盖——若确为机器生成,须修正生成源而非仅改文件,否则 R5 不持久。

**安全关键路径测试覆盖(Theme B,已据实重新瞄准)**
- R7. 为 `shared/field-mapping.ts` 补**专属 contract 测试**(现仅经 selectors/fillers/fixture-contract 间接覆盖),使字段漂移在单测层即可被捕获,而非纯靠 e2e/人工冒烟。
- R8. 为 `ssrf-allowlist.ts` 的 `isHostAllowed` / `loadSSRFAllowlist` 补单测,验证 fail-closed(空/非法 allowlist 拒绝一切)。**注意**:`ssrf-guard.ts` 的私网/loopback/redirect-hop fail-closed 已有 14 个测试,不要重复;本项只补 allowlist 这一未覆盖切面。
- R9. 为 `auth-middleware.ts` 补**专属单测**(现仅经 auth-routes 间接覆盖):JWT 校验、PUBLIC_ROUTES 白名单、过期与 clockTolerance 边界,并应包含 **alg-confusion(`alg:none` / HS↔RS 降级)** 这一经典 JWT 绕过类。
- R10. 为**确无测**的 extension HTTP 客户端(`config-client` / `prompt-client` / `auth-client` / `gossip-client`)补 mock-server 单测,使后端 API 契约变更能被及早捕获。**注意**:`pending-client` / `published-posts-client` 已有测试,不在此列。

**测试基线确认**
- R11. plan/执行第一步直接跑一次确认 TODOS.md 标记的 P0("后端测试因缺依赖在 CI 失败")是否仍复现。该 P0 根因是 `dist/` 下文件缺依赖,而现行 CI 跑 `pnpm -r test`(源码 vitest,不碰 dist),**极可能已不复现**;若证实如此,关闭 TODO 并更新记录;若仍复现,纳入修复范围。

> 已移除原 R6(post-assembler 单测):`post-assembler.test.ts` 已存在且覆盖 verbatim 注入/PLACEHOLDER 契约,无需新建。
> 原 R12(Docker build `continue-on-error` 复核)转入 Outstanding Questions。

## Success Criteria
- 故意推一个让任一测试失败的 tag,`release.yml` **不会**产出 zip / 镜像 / Release(R1)。
- 故意往 fixture 塞一个假 token,`ci.yml` 因 `check:fixtures` 红灯拦下(R2)。
- `ssrf-allowlist.ts` 的 allowlist 函数、`auth-middleware.ts`、4 个无测 HTTP 客户端、`field-mapping.ts` 专属 contract 从"无直接/专属测试"变为有覆盖关键契约的单测,且 `pnpm -r test` 全绿(R11 确认后)。
- CI 摘要中不再出现"显示绿但实际整组 skip"的 e2e 步骤(R4)。
- CLAUDE.md / `.ai-memory` 不再有"GitLab CI"陈述,且若 `.ai-memory` 为机器生成则生成源已修(R5)。

## Scope Boundaries
- **不做** Theme C 架构重构(拆 batch-orchestrator、合并 approve 处理器、统一 HTTP 客户端、ErrorCode enum)。
- **不做** Theme E 产品体验扩展(测试连接、grounding 二次评审、隔离区视图、LLM 退避重试)。
- **不做** D 类安全闸门**逻辑**增强(grounding 正则→DOMParser、authorizedHosts sanitize、DOMPurify 版本检查、SSRF socket-level pinning)——本轮只**补测试**,不改闸门逻辑。这些残留攻击面见下方"残留风险",**不得**因新增了测试就被读作"已加固"。
- 不追求覆盖率数字,只补"安全关键路径"与"核心契约";其余无测文件(metrics/telegram/json-store 等)不在本轮。

## Key Decisions
- 先补安全网(A+B)而非先做功能/重构:A 近乎零成本却堵住"哑测门/泄密"真漏洞;B 让安全关键路径有专属测试守护。
- B 类测试以"固定现有正确行为"为目标(characterization + contract),不顺手改实现。**但** characterization 测试有"把当前 bug 当正确行为冻结"的风险,对安全路径尤甚——执行规则:写每个安全路径测试前,须先对照该路径的**设计意图/文档化契约**(如 fail-closed、verbatim 注入、token 拒绝)断言"应然行为",而非盲目快照"实然行为";若实然 ≠ 应然,记为 bug(不在本轮修,除 R11),**绝不**写一个把错误行为锁死的绿测。
- 术语:本文"**contract 测试**"= 验证当前行为符合预期接口/契约(如 field-mapping 选择器与真后台结构一致);"**characterization 测试**"= 在无规格时记录当前可用行为。两者均以应然为准绳(见上条)。

## Dependencies / Assumptions
- 假设 GitHub Actions 为唯一活跃 CI(已验证:无 `.gitlab-ci.yml`,remote 为 GitHub)。
- 假设 `check:fixtures`(extension 包内脚本)可在 monorepo 根 CI runner 运行;需确认其工作目录/相对路径假设(R2)。
- 假设 `shared` 包需先 `build` 出 `dist/` 才能被 backend/extension 类型检查;新增 shared 测试须遵循既有拓扑顺序。

## Outstanding Questions

### Deferred to Planning
- [Affects R3][Technical] `ci.yml` 现有 `build shared`/`compile` 已覆盖多少?产物校验应是薄断言还是独立 job?`check-all.sh` 在 CI runner 的耗时与是否需无头浏览器/真 Quill 依赖。
- [Affects R4][User decision] e2e 的 `API_KEY`/`KEY` 是作为 CI secret 注入真跑,还是仅本地/夜间跑?若注入 secret,须限制为非 fork 推送并从 R4 要暴露的 CI 摘要中 mask,避免 hardening 本身引入新的凭证泄漏面。
- [Affects R2][Needs research] `check:fixtures` 的检测模式(hidden value/token/真实数据)覆盖面本轮不测;是否需为扫描器自身的模式覆盖补测,以防漏掉真实世界 secret 格式仍通过假 token 测试?
- [Affects R8][Needs research] `ssrf-allowlist` 函数的 fail-closed 单测如何在不发真实网络下验证(`ssrf-guard.test.ts` 的现有做法可复用)。
- [Affects R1/R12][User decision] `release.yml` 中 Docker build 的 `continue-on-error`(在 Docker build 步骤上)是否应在镜像构建失败时中断发布?取决于发布流程是否依赖该镜像产物;并确认 R1 去掉 Test 的 `continue-on-error` 后,后续 step 的 `if:` 依赖是否需一并调整。

## Next Steps
→ /ce:plan for structured implementation planning
