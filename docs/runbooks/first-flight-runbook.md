# 首飞 Runbook（首次真实上线）

> 来源计划：`docs/plans/2026-06-15-001-refactor-release-readiness-remediation-plan.md`（B1）。
> 衔接 `docs/plans/2026-06-11-004` Unit 5（路径 B 真实批次验收，仍未完成）——不重开。

本清单**严格有序**。规则铁律：**任何激活线上后端的部署/push，都不得先于密钥撤销（Step 1）**。
两类动作已标注：🟢 代码侧前置（可由 agent/CI 完成，多已就绪）／🔴 不可逆运营动作（运营者亲手，不可由代码代替）。

---

## Step 1 — 密钥撤销 + 轮换（先于一切线上暴露）🔴

> 代码闸门只能挡占位符/弱值，挡不了「已泄漏但够强」的旧密钥。撤销是唯一可靠边界。

- [ ] **LLM_API_KEY（疑两次曝光，无条件处理）**
  - [ ] 在 LLM 供应商控制台**显式 revoke 旧 key**（生成新 key ≠ 撤销旧 key）。
  - [ ] **验证旧 key 已死**：用旧 key 调一次供应商接口，确认返回 401/403。
  - [ ] 生成新 key，经 `.env`（运行时）/ GitHub Actions secrets（CI）注入——**绝不提交进 git**。
  - [x] ~~确认 release 构建**不把 `LLM_API_KEY` 打进扩展 bundle**~~ ✅ **已查(2026-06-15)**:`LLM_API_KEY` 仅在 `packages/backend/**` 经 `process.env` 读取,扩展代码**从不引用**,结构上不可能进 bundle。
  - [x] ~~若旧 key 曾进 git 历史:`git filter-repo`/BFG 清史~~ ✅ **已查(2026-06-15)可省**:全史 `git log -S "sk-"` 搜不到任何 key 字面值,`.env` 未被追踪(仅 `.env.example`),CI gitleaks 全史扫描(`fetch-depth:0`)当前 passing。**git 历史无密钥,清史不需要。**(撤销旧 key 仍须做——防它从打包/日志等别处泄漏;revoke 才是真边界。)
- [ ] **JWT_SECRET**：换强随机值（≥32 字节）。轮换后所有旧 token 失效，扩展须重登。
- [ ] **JWT_ADMIN_PASSWORD_HASH**：scrypt 生成（命令见 `AGENTS.md` 第 24–26 行 / `hash-password.mjs`）。
- [ ] 改 `.env` 后启动后端，确认 fail-closed 校验**通过**（弱值会被拒启动）。

## Step 2 — CORS 收紧 🟢前置 + 🔴核验

> ✅ **EXTENSION_KEY 之谜已解(2026-06-15)**:`wxt.config.ts` 硬编默认公钥,CI/release **未** 经 env 覆盖 `EXTENSION_KEY`(workflow 无此 env)→ dev 与 prod **同一固定 id**。无需双 id。
> 已用公钥计算并与仓库注释逐字符核对,确认 id = **`iljimdgfajpgnmanklehhmapojbcjecd`**。

- [ ] 把 `CORS_ORIGIN` 设为(单一值,直接 paste):
  ```
  CORS_ORIGIN=chrome-extension://iljimdgfajpgnmanklehhmapojbcjecd
  ```
  载入扩展后到 `chrome://extensions` 确认实际 id 与此一致(理论上必一致;仅当你改了 `EXTENSION_KEY` env 才会变)。**绝不为 id 不符而放宽到 `*`/通配**(后端 fail-closed 会拒 `*`)。
- [ ] 🔴**CORS 负向核验**：伪造一个非 allowlist 的 `Origin` 请求后端 → 确认被拒；真实扩展 `Origin` → 放行。

## Step 3 — Dry-run 预演 🟢

- [x] **代码层已验证（2026-06-15，main `38bd759c`）**：U3 授权矩阵 e2e（`tests/e2e/publish-gate.test.ts`，6/6 绿）在真实表单 + 真实 fetch 拦截上证 `dry-run` 走完闸链且**真实提交=0**（对照 `authorized`+名单内=1；`off` / host 不符 / 伪装相似 host / 空名单 均=0）；批量 `dry-run` 路径产出 `DryRunReport`（每项：选题 / 标题 / ✓已填·↷跳过·⚠降级）。「结构性零提交 + 闸链正确」是硬证据。
- [ ] 🔴**真实环境亲眼核验（并入 Step 4 开场，同一浏览器会话）**：加载扩展 + 开真实后台页，档位设 `dry-run` 跑一批 → 侧边栏看「🧪 预演填充报告」核对标题/字段填充无误 → 再切 `authorized` 真发。

## Step 4 — 真实发布冒烟 🔴（确立填充基线有效）

> 验收口径接 06-11-004 Unit 5：用**真实批次**而非单篇。

- [ ] 准备真实批次 **≥3 项**，其中 **≥1 项人为制造 gate-failed**。
- [ ] 执行真发，验证：正常项发布成功、gate-failed 项被拦进隔离区、重试回流正常。
- [ ] 前台核验已发布内容正确。
- [ ] 踩坑提醒：后台是 layuiAdmin 弹层表单,**填充已 frame-agnostic**（`lib/frame-resolve.ts`:顶层优先、找不到下钻同源 iframe）;字段找不到先确认弹层已打开,再看 frame 是否被解析到;改 content script 须「**重载扩展 + 刷新后台页**」两步；重跑同批被 `filterReentrantTopics` 静默过滤时需 `bypassReentry`。
- [ ] 若重抓 fixture（含 D2 变体）在登录态下产生：**先过 `check:fixtures` 脱敏闸**再提交（登录窗口是新攻击面）。

## Step 5 — 推送 GitHub 🔴

- [ ] 确认 GitHub `redredchen02-rgb/51guapi` 仓库为**私有**。
- [ ] `git push` feat 分支与 rescue 分支。
- [ ] 首飞成功后再备份 `data/`（备份**绝不落 `data/` 内**——后端测试 `cleanData()` 会 `rmSync data/`）。

---

## 完成后

- [ ] 更新 `.ai-memory/project_51guapi.md` 的首飞状态（从「待运营者动作」移到「已完成」）。
- [ ] D 组重构（apiFetch / BatchReviewPanel 拆分）在此验证过的填充基线上进行。
