---
title: "feat: 补强安全网 — CI/发布闸门 + 安全关键路径测试覆盖"
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-harden-safety-net-requirements.md
deepened: 2026-06-15
---

# feat: 补强安全网 — CI/发布闸门 + 安全关键路径测试覆盖

## Overview

两条线收紧 51publisher 的「安全网」:**Theme A** 修 CI/发布闸门(release tag 路径的哑测门、`check:fixtures` 未进 CI、产物未校验、e2e 假绿);**Theme B** 为缺少直接/专属测试的安全关键路径补单测(`ssrf-allowlist`、`auth-middleware`、4 个 extension HTTP 客户端、`field-mapping` contract)。本计划只改 CI YAML 与新增测试,不改闸门逻辑、不做架构重构或产品扩展(见 origin 的 Scope Boundaries)。

> 规划期纠偏(见 origin 修订):首版高估缺口。已核实 `post-assembler.test.ts`、`ssrf-guard.test.ts`(14 cases)、`pending-client.test.ts`、`published-posts-client.test.ts` 均存在;`field-mapping`/`auth-middleware` 有间接覆盖。本计划据实只补**真实未覆盖切面**。

## Problem Frame

安全叙事(防幻觉 / fail-closed / 零提交)需要测试地基,而几处关键路径只有间接覆盖或无覆盖;同时 release tag 路径的测试门 `continue-on-error: true` 形同虚设,机密脱敏闸门 `check:fixtures` 从未进 CI。改动成本低(A 多为改 YAML),回报是堵住「发坏产物 / 泄密 / 安全回归静默通过」。详见 origin: `docs/brainstorms/2026-06-15-harden-safety-net-requirements.md`。

## Requirements Trace

- R1. `release.yml` 移除测试步骤 `continue-on-error: true`,tag 发布时测试失败必须中断。
- R2. `ci.yml` 新增 `check:fixtures` 强制门(fork/PR 也跑,排在 artifact/secret 步骤前)。
- R3. `ci.yml` 新增产物存在性校验(薄断言,非重建 check-all.sh)。
- R4. e2e `skipIf(!API_KEY)` 跳过在 CI 摘要可见,杜绝假绿。
- R5. 修正 CLAUDE.md / `.ai-memory` 中「活跃 CI 为 GitLab」过时陈述为 GitHub Actions;若 `.ai-memory` 机器再生则修生成源。(注:**仅** GitLab CI 陈述过时;`scripts/check-all.sh` 确实存在,CLAUDE.md 对它的描述属实,勿删。)
- R6. ~~post-assembler 单测~~ — 规划期纠偏中**移除**:`packages/extension/lib/post-assembler.test.ts` 已存在并覆盖 verbatim 注入/PLACEHOLDER。保留 R6 编号以示删除,后续编号不重排。
- R7. `shared/field-mapping.ts` 补专属单测。
- R12. `release.yml` Docker build 失败应中断发布(移除其 `continue-on-error`),且确认移除 Test 的 `continue-on-error` 后跨 step/跨 job 的 `if:`/`needs:` 门正确。
- R8. `ssrf-allowlist.ts` 的 `isHostAllowed`/`loadSSRFAllowlist` 补 fail-closed 单测。
- R9. `auth-middleware.ts` 补专属单测(JWT 校验、PUBLIC_ROUTES、过期/clockTolerance、alg-confusion)。
- R10. 4 个无测 extension HTTP 客户端(config/prompt/auth/gossip-client)补 mock 单测。
- R11. 确认 TODOS.md P0「后端测试因缺依赖在 CI 失败」是否仍复现,据实关闭或纳入修复。

## Scope Boundaries

- 不做 Theme C 架构重构、Theme E 产品扩展、D 类闸门**逻辑**增强(只补测试)。
- 不追求覆盖率数字;`metrics/telegram/json-store` 等不在本轮。
- characterization 测试**不得**把当前 bug 冻结成绿测——须对照应然契约断言(见 Key Decisions)。

## Context & Research

### Relevant Code and Patterns

- **后端纯逻辑测试模板**:`packages/backend/src/scraper/ssrf-guard.test.ts` — co-located `*.test.ts`,`import from "./x.js"`(ESM,`.js` 后缀必需),`vi.stubGlobal("fetch", …)` + `afterEach(vi.unstubAllGlobals)`,`await expect(fn()).rejects.toBeInstanceOf(SsrfError)`,表驱动 `expect(x, label)`。
- **后端 Fastify 路由测试模板**:`packages/backend/src/routes/auth-routes.test.ts` — `buildApp()`(register routes → `app.ready()`),`app.inject({method,url,payload,headers})`,`beforeEach` 设 `JWT_SECRET`/`JWT_ADMIN_PASSWORD_HASH`、`afterEach` `app.close()` + 还原 env;**已含 alg:none 测试(117-126 行)可作模板**;helper `makeHash`(scrypt salt:hash)、`lastAuditLine`(读 `AUDIT_LOG_PATH` 取最后一行审计日志,用于断言失败鉴权被记录;若 auth-middleware 不产审计日志则可省)。
- **后端 vitest 配置**:`packages/backend/vitest.config.ts` 明确 `exclude: ["dist/**", "node_modules/**"]` → **vitest 不收集 `dist/**` 下的 test**。这是 R11 的关键事实:TODOS P0「dist 8 个测试缺依赖失败」在 `pnpm -r test` 下**不会复现**(dist 被排除),dist 里的 stale `*.test.js` 仅是旧 build 产物。
- **extension HTTP 客户端测试模板**:`packages/extension/lib/pending-client.test.ts` — `import {fakeBrowser} from "wxt/testing"` + `beforeEach(fakeBrowser.reset)`,`mockFetch(response,status)` 返回 `{capturedUrls, fn}`,**把 mock 作为注入的 `fetchFn` 参数传入**(勿 stub global)。注意该文件有重复 test body(93-146 与 148-195),复制结构勿复制重复。
- **测试隔离**:`packages/backend/src/config/test-setup.ts`(经 `packages/backend/vitest.config.ts` 的 `setupFiles` 装载)在 import 时把 `PUBLISHER_DATA_DIR` 指向临时目录,store-touching 测试自动隔离,**勿手动设**。extension 用 `WxtVitest()` 插件(auto-imports + fakeBrowser),排除 `tests/e2e/**`。
- **被测源**:
  - `packages/backend/src/scraper/ssrf-allowlist.ts` — `loadSSRFAllowlist(env=process.env)`(**可注入 env**,无需改 `process.env`)、`isHostAllowed(url, config)`;env `ALLOWED_HOSTS`(逗号分隔,`*.` 通配 + 可选协议钉);`allowedHosts.length===0` → 全拒(line 55);`",,,"` → 空 pattern → 全拒。
  - `packages/backend/src/middleware/auth-middleware.ts` — `requireAuth` preHandler;`jwt.verify(token, JWT_SECRET, {algorithms:["HS256"], clockTolerance:30})`;`PUBLIC_ROUTES = {"/api/v1/auth/login","/api/v1/auth/status","/api/v1/healthz"}`;无 secret → 500;任何 throw → 401。
  - **客户端注入缝(经核实,首版描述有误)**:
    - `config-client.ts` — 4 个函数**真正接受并使用** `fetchFn: typeof fetch = fetch`(line 26/36 等),最易测,直接注入 mock。
    - `pending-client.ts`(模板)— `fetchFn?` 为**可选**,函数体 `fetchFn ? await fetchFn(...) : await fetchWithTimeout(...)`(line 90-92)。这是「注入则用、否则走 shared timeout」的混合模式。
    - `prompt-client.ts` — 有参数 `_fetchFn`(line 29)但**下划线前缀=未使用**,函数体实际调 `fetchWithTimeout`(line 35/64/96)。**注入它不会拦截请求**。
    - `gossip-client.ts` — **无注入参数**,全部调 `fetchWithTimeout`(import 自 `@51publisher/shared`)。
    - `auth-client.ts` — 提供 `getAuthHeaders`/`clearToken`,被其余 client import。
    - → 让 prompt/gossip 可测需**改源码**(把 fetch 调用改为可注入,仿 pending-client 的 `fetchFn ? : fetchWithTimeout` 混合)**或** `vi.mock("@51publisher/shared")` mock 掉 `fetchWithTimeout`。非「加默认参数即可」的零改动。
  - `packages/shared/src/field-mapping.ts` — 导出 `VALID_FIELD_TYPES`、`isValidFieldMapping(v): v is FieldMapping`(型别守卫)、`DEFAULT_FIELD_MAPPING`;**无专属测试**,仅经 config-client/fillers 间接覆盖。**注意**:`packages/shared` 包**无 vitest 依赖、无 test 脚本、无 vitest 配置** → 直接在 shared 内建测试需先装 runner;**更简做法**:把 field-mapping 测试放在 `packages/extension/lib/`(仿 `post-assembler.test.ts` 在 extension 内测 shared 代码),复用 extension 的 WxtVitest。
- **CI(经核实)**:`.github/workflows/ci.yml`(push/PR,无 continue-on-error,真闸)步骤 = install → build shared → `pnpm -r compile` → **`pnpm lint`(= `biome check --write`,会改文件)+ `git diff --exit-code`** → `pnpm -r test`;**从不跑 e2e / check:fixtures / zip**。`release.yml`(`v*` tag)测试步 `continue-on-error: true`、docker build 步亦 `continue-on-error`;`Build extension zip`/`Prepare extension artifact` 无 `if:` 守卫;`Export/Upload Docker` 用 `if: success()`;另有独立 `release` job `needs: build-and-verify`。脚本:root `package.json` 仅 `test`/`compile`/`lint`/`lint:ci`;`packages/extension/package.json` `check:fixtures` = `bash scripts/check-fixture-secrets.sh`(**相对路径,仅在 repo 根 cwd 可解析**);**`scripts/check-all.sh` 确实存在**(lint:ci + `pnpm -r test` + build backend/extension + 校验 `.output`/`dist` 存在);`scripts/check-fixture-secrets.sh` 在 **repo 根** `./scripts/`(非 `packages/extension/scripts/`)。无 Makefile。
  - ⚠️ **`pnpm --filter publisher-fill-assistant check:fixtures` 会失败**(cwd=packages/extension,`scripts/` 不存在 → exit 127,经 pnpm 上抛 exit 1)。正确调用是 **repo 根 `bash scripts/check-fixture-secrets.sh`**。

### Institutional Learnings

- `docs/solutions/` 几乎空,仅 `developer-experience/claude-in-chrome-script-redaction-backend-verify-2026-06-05.md`:后台契约核验时脚本字面值被打码,须用 **field name + option `value:text`** 间接断言(非字面 URL);记录 2026-06-05 漂移(新增 `cover_url` hidden、`tags[]` 增至 3912、品牌改「海角社区」、`$.post` 提交、draft `status` 选项 `1:显示`/`0:隐藏`)。→ 与 R7 相关,但这些是**真后台契约**,归 e2e fixture-contract;R7 的 field-mapping 单测只验 `isValidFieldMapping`/`DEFAULT_FIELD_MAPPING` 自身完整性。
- 本工作完成后是 `/ce:compound` 沉淀候选(知识库当前几近空)。

## Key Technical Decisions

- **R4 默认不把 LLM key 注入 CI**:仅让 skip 状态在 CI 摘要可见(避免凭证暴露面 + LLM 配额成本);「真跑」留本地/夜间。若用户要 CI 真跑,须限非 fork 推送并 mask。(可逆默认,执行时可改)
- **R12/docker build 一并 gate**:release 既发布镜像,镜像构建失败应中断发布 → 移除 docker build 的 `continue-on-error`;并确认移除 Test 的 `continue-on-error` 后后续 step 的 `if:` 依赖正确。
- **gossip/prompt-client 测试注入方式(已据实裁决)**:两者实际调 `fetchWithTimeout`(prompt 的 `_fetchFn` 是死参),**不是**加默认参数即可。**选定路径 A**:把 prompt/gossip 的 fetch 调用改为 pending-client 式混合 `fetchFn ? await fetchFn(...) : await fetchWithTimeout(...)`(prompt 把 `_fetchFn` 改为真正使用的 `fetchFn`),测试注入 mock。**回退路径 B**:`vi.mock("@51publisher/shared")` mock `fetchWithTimeout`(零源码改动,但 mock 粒度粗)。默认走 A(与 config/pending 一致),A 触及源码超预期时退 B。这是触及源码的小重构,**非向后兼容的零改动**。
- **characterization 防呆**:每个安全路径测试先对照应然契约(fail-closed、token 拒绝、白名单语义)断言,实然≠应然则记 bug(不在本轮修,除 R11),绝不锁死错误行为。

## Open Questions

### Resolved During Planning

- R4 注入策略:默认「只可见、不真跑」(见 Key Decisions)。
- R12 docker gate:默认一并移除 continue-on-error(见 Key Decisions)。
- R8 测试手段:`loadSSRFAllowlist(env)` 可注入 env,纯函数无需网络,fail-closed 直接断言(`ssrf-guard.test.ts` 模式复用)。
- **`check:fixtures` 正确入口**:repo 根 `bash scripts/check-fixture-secrets.sh`(**非** `pnpm --filter … check:fixtures`,后者 cwd 错会 exit 1)。
- **R11 几乎确定关闭**:`backend/vitest.config.ts` 排除 `dist/**`,P0 的 dist 测试不被收集 → `pnpm -r test` 不复现该失败。仍在 Unit 1 实跑确认一次。
- **`scripts/check-all.sh` 存在且属实**:R3/U4 应复用其 build+产物校验逻辑,而非新造;CLAUDE.md 对它的描述不删。
- **R7 测试落点**:放 `packages/extension/lib/field-mapping.test.ts`(复用 extension vitest),不在 shared 内建 runner。

### Deferred to Implementation

- gossip/prompt-client 走路径 A(改源码注入)还是 B(`vi.mock` shared)——以实际改动面定(默认 A,见 Key Decisions)。
- R4 在 GitHub Actions 摘要中暴露 skip 的具体机制(vitest reporter / `$GITHUB_STEP_SUMMARY` / 步骤名),执行时选最简;**最低验收**:CI 摘要须人类可读地显示 skip 计数(如「e2e: N passed, M skipped」)。
- R5 `.ai-memory` 是否机器再生(session-wrap)→ 决定是否须改生成源而非仅改文件。
- Unit 2 跨 job 门:移除 `continue-on-error` 后,独立 `release` job(`needs: build-and-verify`)是否在 build-and-verify 失败时正确 skip——执行时用 workflow 静态检查 / `act` dry-run 确认,**勿**用真 failing tag 验证(不可逆、噪音大)。

## Implementation Units

> 依赖:Unit 1 先行——是 Unit 5–8 的**硬前置**(它们依赖 `pnpm -r test` 基线可信),Unit 2–4(CI YAML)可与 Unit 1 并行。Theme A(U2–U4)与 Theme B(U5–U8)彼此独立;U5–U8 互相独立。

- [ ] **Unit 1: 确认后端 P0 基线 + 修正过时 CI 文档**

**Goal:** 实跑确认 TODOS P0 是否复现并据实关闭;修正 CLAUDE.md/`.ai-memory` 的 GitLab→GitHub 陈述。
**Requirements:** R11, R5
**Dependencies:** 无(先行;Unit 5–8 硬前置,Unit 2–4 可并行)
**Files:**
- Modify: `TODOS.md`(据结果关闭/保留 P0)
- Modify: `CLAUDE.md`(**仅**改 remote/活跃 CI 为 GitHub Actions、`.gitlab-ci.yml` 不存在;**保留** `scripts/check-all.sh` 描述——经核实它属实)
- Modify: `.ai-memory/*.md`(同上;若机器再生则定位生成源)
**Approach:** `pnpm --filter publisher-backend test`(**正确包名**,非 `@51publisher/backend`)实跑确认 P0;因 `backend/vitest.config.ts` 排除 `dist/**`,**预期不复现**,据实关 TODO。CLAUDE.md 第 13 行改 GitLab→GitHub。两类任务(基线确认 / 文档改正)风险都小,可合一 commit;基线确认是 Unit 5–8 的门,文档改正不阻塞。
**Test expectation:** none — 文档/基线确认,无行为变更。
**Verification:** `pnpm -r test` 绿;TODOS P0 状态有据;CLAUDE.md/`.ai-memory` 无「GitLab CI」陈述且未误删 check-all.sh 描述。

- [ ] **Unit 2: release.yml 发布闸门 gating**

**Goal:** tag 发布时测试/镜像构建失败必须中断,不产出 zip/镜像/Release。
**Requirements:** R1, R12
**Dependencies:** 无
**Files:**
- Modify: `.github/workflows/release.yml`(移除 Test 步骤与 docker build 步骤的 `continue-on-error: true`)
**Approach:** 删两处 `continue-on-error`。**须分析而非假设** `if:`/`needs:` 链:`Build extension zip`/`Prepare extension artifact` 无 `if:` 守卫(Test 失败会因 job 中止而不执行,符合意图);`Export/Upload Docker` 用 `if: success()`;独立 `release` job `needs: build-and-verify`——确认 build-and-verify 失败时 release job 正确 skip。副作用须知:移除 docker build 的 continue-on-error 后,flaky docker 构建会阻断原本独立的 extension zip 发布路径(可接受,因 release 发布镜像)。
**Execution note:** 用 workflow 静态检查 / `act` dry-run 验证门行为,**勿**用真 failing tag(不可逆、噪音大)。
**Test expectation:** none(CI 配置)。
**Verification:** dry-run/静态分析显示:Test 或 docker build 失败 → 无 zip/镜像/Release 产出且 release job skip;正常 tag 仍完整发布。

- [ ] **Unit 3: ci.yml 新增 check:fixtures 脱敏强制门**

**Goal:** 机密脱敏扫描成为每次 push/PR 的强制 CI 门。
**Requirements:** R2
**Dependencies:** 无
**Files:**
- Modify: `.github/workflows/ci.yml`(新增 step **`run: bash scripts/check-fixture-secrets.sh`,cwd=repo 根**)
- Modify(建议): `packages/extension/package.json`(修 `check:fixtures` 脚本路径,使其从任一 cwd 可用,或挪到 root `package.json`)
**Approach:** **不要用** `pnpm --filter publisher-fill-assistant check:fixtures`——经核实 cwd=packages/extension 下脚本路径不存在,会 exit 1(不是静默无效,但 step 会红/坏)。正确做法是 repo 根直接跑该脚本。step 排在 install 后、任何 artifact/secret 步骤前。确认脚本内 `FIXTURE_DIR`(相对路径)在 repo 根解析到真实 fixtures。注意 ci.yml 的 `pnpm lint`(`biome check --write`)会改文件,新 step 应放在 lint+`git diff` 之后或不依赖干净树。
**Test scenarios:**
- Happy path:正常 fixture → step 绿。
- Error path:fixture 植入假 token → step 红、阻断合并。
- Edge case:确认脚本确实扫描了目标目录(非因路径错而空扫)——可加 `set -e` 或文件存在断言。
**Verification:** 临时往 fixture 塞假 token,CI 因该 step 红;移除后转绿;CI 日志显示扫描了非空 fixture 集。

- [ ] **Unit 4: ci.yml 产物校验 + e2e 跳过可见**

**Goal:** 消除「CI 绿但产物坏」缺口;杜绝 e2e 静默全 skip 的假绿。
**Requirements:** R3, R4
**Dependencies:** 无
**Files:**
- Modify: `.github/workflows/ci.yml`(新增 build + 产物存在断言;e2e step 暴露 skip 计数)
**Approach:** **复用** `scripts/check-all.sh` 的产物校验尾段思路(`pnpm --filter publisher-backend build`、`pnpm --filter publisher-fill-assistant build`,断言 `packages/extension/.output` 与 `packages/backend/dist` 存在)——ci.yml 当前不建这两者。**不要**整段调 check-all.sh(它会重复 lint:ci + 全量 test)。e2e 可见性:让 `test:e2e` 的 skip 计数写入 `$GITHUB_STEP_SUMMARY`(选最简机制)。
**Test scenarios:**
- Happy path:build 产出 `.output`/`dist` 存在 → step 绿。
- Edge case:e2e 因无 API_KEY 全 skip → CI 摘要人类可读显示「N skipped」,而非静默绿。
- Error path:删除/破坏 build 输出 → 产物断言红。
**Verification:** CI 摘要可见产物校验结果与 e2e skip 计数(**最低验收**:skip 计数人类可读)。

- [ ] **Unit 5: ssrf-allowlist.ts fail-closed 单测**

**Goal:** 锁定 allowlist 的 fail-closed 语义(空/非法 → 全拒)。
**Requirements:** R8
**Dependencies:** Unit 1
**Files:**
- Create: `packages/backend/src/scraper/ssrf-allowlist.test.ts`
**Approach:** 注入 env 调 `loadSSRFAllowlist({ALLOWED_HOSTS:…})`,再 `isHostAllowed(new URL(…), config)`。**勿重复** `ssrf-guard.test.ts` 已覆盖的私网/loopback/redirect-hop(那是 guard 管线;本单元只测 allowlist 匹配逻辑本身)。**断言对照应然 fail-closed 契约**,若现状≠应然则记 [BUG] 另立(不在本轮锁死)。
**Patterns to follow:** `packages/backend/src/scraper/ssrf-guard.test.ts`(import `.js`、表驱动、`expect(x,label)`)。
**Test scenarios:**
- Happy path:`ALLOWED_HOSTS="example.com"` → 精确 host allowed;`*.example.com` → 子域 allowed。
- Edge case:`ALLOWED_HOSTS` 未设/空串 → `allowedHosts.length===0` → 任何 host `false`(fail-closed)。
- Edge case:`",,, "`(全空)→ 空 pattern → 全拒。
- Error path:协议钉 `https://example.com` 但传入 `http://example.com` → 拒。
- Edge case:`evilexample.com` 不应被 `*.example.com` 误配(`.endsWith(".example.com")` 边界)。
- Error path(authority 欺骗):`new URL("https://example.com@evil.com")` 的 hostname=evil.com,在仅允许 example.com 的 config 下 → `false`(确认按真实 hostname 而非 authority 串匹配)。
- Edge case:尾点 host `example.com.` → 断言预期行为。
**Verification:** 新测全绿;断言对照应然 fail-closed 契约(非快照现状)。

- [ ] **Unit 6: auth-middleware.ts 专属单测**

**Goal:** 为 JWT 鉴权入口补专属单测,含 alg-confusion 与 deny-by-default 路径。
**Requirements:** R9
**Dependencies:** Unit 1
**Files:**
- Create: `packages/backend/src/middleware/auth-middleware.test.ts`
**Approach:** 复用 `auth-routes.test.ts` 的 `buildApp()`+`app.inject`,或直接以 mock request/reply 调 `requireAuth`。
**Patterns to follow:** `packages/backend/src/routes/auth-routes.test.ts`(env 设置/还原、`makeHash`、`app.inject`、alg:none 模板 117-126)。
**Test scenarios:**
- Happy path:有效 HS256 token → 放行(受保护路由 200)。
- Error path(deny-by-default):受保护路由**无 `Authorization` 头** → 401(最高频攻击面)。
- Error path:`Authorization` 头**无 `Bearer ` 前缀** → 401。
- Error path:`Bearer ` + 非 JWT 垃圾串 → 401。
- Error path:`alg:none` 伪 token → 401。
- Error path:错误算法(HS↔RS 降级)/错误 secret 签发 → 401。
- Edge case:过期 token 在 30s clockTolerance 内 → 接受;超出 → 401。
- Happy path:PUBLIC_ROUTES(login/status/healthz)无 token → 放行。
- Edge case:PUBLIC_ROUTES 须**精确路径**匹配(如尾斜杠/`..` 变体不应被当公开)。
- Error path:缺 `JWT_SECRET` → 500「auth not configured」。
**Verification:** 新测全绿;alg-confusion、缺头、过期边界、精确路径均有明确断言。

- [ ] **Unit 7: extension HTTP 客户端 mock 单测**

**Goal:** 为 4 个无测客户端补 mock 单测,捕获后端 API 契约漂移。
**Requirements:** R10
**Dependencies:** Unit 1
**Files:**
- Create: `packages/extension/lib/config-client.test.ts`
- Create: `packages/extension/lib/prompt-client.test.ts`
- Create: `packages/extension/lib/auth-client.test.ts`
- Create: `packages/extension/lib/gossip-client.test.ts`
- Modify: `packages/extension/lib/prompt-client.ts`(把死参 `_fetchFn` 改为函数体真正使用的 `fetchFn`,仿 pending-client 混合模式)
- Modify: `packages/extension/lib/gossip-client.ts`(加可注入的 `fetchFn`,`fetchFn ? : fetchWithTimeout`)
**Approach:** config-client 已真用 `fetchFn` → 直接注入 `mockFetch().fn`。prompt/gossip 走 **路径 A**(改源码为 pending-client 式混合注入);若改动超预期退 **路径 B**(`vi.mock("@51publisher/shared")` mock `fetchWithTimeout`)。auth-client 测 `getAuthHeaders`/`clearToken` 形态。**这是触及源码的小重构,非零改动**——改后 `pnpm -r compile` 与既有调用点(background.ts 等)须仍绿(保留默认参数 = 原 fetch 路径)。
**Patterns to follow:** `packages/extension/lib/pending-client.test.ts`(`fakeBrowser.reset`、`mockFetch`、`fetchFn ? : fetchWithTimeout` 混合)。
**Test scenarios:**
- Happy path(每 client):2xx → 正确解析;请求带 `getAuthHeaders()` 的 Bearer 头、命中预期 URL。
- Error path:401 → `clearToken()` 被调用、返回空/抛(按各 client 现有契约)。
- Error path:非 2xx/网络错误 → 按现有错误契约处理(不静默吞)。
- Edge case:auth-client `getAuthHeaders()` 无 token → 头部形态符合预期。
- Integration(若走路径 A):注入的 `fetchFn` 确实被调用(验证重构真的接通了注入缝,而非又一个死参)。
**Verification:** 4 个测文件全绿;断言对照各 client 应然契约;源码改动后 `pnpm -r compile` 与既有调用点仍绿。

- [ ] **Unit 8: field-mapping 专属单测**

**Goal:** 验证字段映射型别守卫与默认配置完整性。
**Requirements:** R7
**Dependencies:** Unit 1
**Files:**
- Create: `packages/extension/lib/field-mapping.test.ts`(**放 extension**,复用 WxtVitest;仿 `post-assembler.test.ts` 在 extension 内测 shared 代码)
**Approach:** 从 `@51publisher/shared` import,测 `isValidFieldMapping`/`DEFAULT_FIELD_MAPPING`/`VALID_FIELD_TYPES`。**不要**在 `packages/shared` 内建测试——该包无 vitest 依赖/脚本/配置,装 runner 是额外未规划工作;放 extension 即复用现成运行器。**真后台漂移契约不在此**(归 e2e `fixture-contract.test.ts`,且按 field name/option `value:text` 断言而非字面 URL,见 learnings)。
**Patterns to follow:** `packages/extension/lib/post-assembler.test.ts`(extension 内测 shared 纯逻辑)。
**Test scenarios:**
- Happy path:`isValidFieldMapping(DEFAULT_FIELD_MAPPING)` → true。
- Edge case:缺字段 / 多余字段 / `type` 不在 `VALID_FIELD_TYPES` → false。
- Edge case:`null`/`undefined`/非对象 → false(型别守卫不崩)。
**Verification:** 新测全绿且在 `pnpm -r test` 中**确实被执行**(extension 运行器收集);`DEFAULT_FIELD_MAPPING` 自洽。

## System-Wide Impact

- **Interaction graph:** Theme A 改 `.github/workflows/*` 与(建议)`packages/extension/package.json` 的 check:fixtures 脚本;Theme B 多为新增 `*.test.ts`,但 **Unit 7 触及源码**:prompt-client 把死参 `_fetchFn` 接通、gossip-client 加可注入 `fetchFn`(均保留默认 = 原 `fetchWithTimeout` 路径,既有调用点 background.ts 等无需改,但**不是零改动**)。
- **Error propagation:** 不变更错误传播逻辑;测试只断言现有行为符合应然契约。
- **API surface parity:** Unit 7 接通/新增 `fetchFn` 须保持默认值 = 原 `fetchWithTimeout` 路径,确保 `background.ts` 等现有调用点**调用签名**无需改(签名兼容,但函数体有改动)。
- **Unchanged invariants:** 不改 safety-gate/grounding-gate/sanitize/SSRF guard 逻辑;不改 JWT 验证实现;零提交铁律(第三方)与发布闸门行为不变。
- **CI 契约面:** `ci.yml`/`release.yml` 是外部契约面,改动影响所有 push/tag;新增门会让此前「绿」的提交可能变红(预期,即修复目标)。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 移除 release `continue-on-error` 后,既有红测/flaky 阻断发布 | Unit 1 先确认 `pnpm -r test` 全绿;flaky 单独记录,不在本轮放宽门 |
| `check:fixtures` 经 `--filter` 调用会坏(cwd 错,exit 1) | **已定**:Unit 3 从 repo 根 `bash scripts/check-fixture-secrets.sh`,不用 `--filter`;并加文件存在/`set -e` 防空扫 |
| 误把 check-all.sh 当不实陈述删掉 | **已核实它存在**;Unit 1 仅删 GitLab CI 陈述,U4 复用其产物校验尾段 |
| characterization 测试把当前 bug 冻结成绿测 | Key Decisions 的应然契约断言规则;发现 bug 记 [BUG] 另立,不锁死 |
| Unit 7 改 prompt/gossip 源码引入回归 | 保留默认参数走原路径;`pnpm -r compile` + 既有调用点 + Integration 场景验证注入真接通;超预期退路径 B(`vi.mock`) |
| field-mapping 测试放错包(shared 无 runner)致不执行 | **已定**:放 `packages/extension/lib/`,复用 WxtVitest;Verification 要求确认被 `pnpm -r test` 执行 |
| e2e skip 可见性机制在 GitHub Actions 不生效 | 选最简 `$GITHUB_STEP_SUMMARY` 写入;最低验收=skip 计数人类可读 |

## Documentation / Operational Notes

- Unit 1 修正 CLAUDE.md/`.ai-memory` 的 CI 事实;完成后建议 `/ce:compound` 把「CI gating + 安全路径测试」沉淀进 `docs/solutions/`(当前知识库几近空)。
- 改 content script 无关本轮;无需重载扩展。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-15-harden-safety-net-requirements.md](docs/brainstorms/2026-06-15-harden-safety-net-requirements.md)
- 测试模板:`packages/backend/src/scraper/ssrf-guard.test.ts`、`packages/backend/src/routes/auth-routes.test.ts`、`packages/extension/lib/pending-client.test.ts`
- 被测源:`ssrf-allowlist.ts`、`middleware/auth-middleware.ts`、`config-client.ts`/`prompt-client.ts`/`gossip-client.ts`/`auth-client.ts`、`shared/src/field-mapping.ts`
- 测试落点参照:`packages/extension/lib/post-assembler.test.ts`(extension 内测 shared)
- CI:`.github/workflows/ci.yml`、`.github/workflows/release.yml`;脚本 **repo 根** `scripts/check-fixture-secrets.sh` 与 `scripts/check-all.sh`(均存在)
- 学习:`docs/solutions/developer-experience/claude-in-chrome-script-redaction-backend-verify-2026-06-05.md`
