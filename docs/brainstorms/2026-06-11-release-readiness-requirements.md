---
date: 2026-06-11
topic: release-readiness
---

# 发布就绪:自用日常运营优化计划

## Problem Frame

操作者(单人)即将把 51publisher 正式投入每日批量发帖运营。代码与测试基线健康(672 测试绿、安全加固完成、路径 A 首飞成功),但「最后一公里」未闭合:成果未合入 main、凭证轮换未执行、日常主力流程(批量/待审池)未真发验证、运营 SOP 缺失。发布的定义是「自己能每天安心跑批量,出了问题知道怎么恢复」,而非交付他人。

## Requirements

**合入与基线(先做)**
- R1. 合并 MR!6 与 MR!7 到 main,main 成为日常运营的唯一基准分支;合并后跑 `bash scripts/check-all.sh` 确认全绿
- R2. 完成 TODOS 剩余 P1×2:`dailyBatchSize` 设置项 + `runBatch` 中 grounding gate 前置检查(gate-failed 状态),让缺事实草稿在批量中可见可分流

**安全闭环(上线硬条件)**
- R3. 执行凭证轮换,分两步:
  - **立即执行(不依赖 R1)**:轮换 `LLM_API_KEY`(疑似泄漏记录在案)——在提供商控制台显式吊销旧 key 并确认旧 key 调用返回 401;排查泄漏途径(git 全历史搜 key、scratch 目录、日志),确认新 key 不会经同一途径再泄漏
  - JWT 类:`node packages/backend/scripts/hash-password.mjs` 生成新 `JWT_ADMIN_PASSWORD_HASH`、换强 `JWT_SECRET`;改后验证 fail-closed 启动正常、旧 token 调受保护路由返回 401、扩展端 clearToken 后重新登录成功
- R4. 收紧 CORS(U13):用打包后扩展的真实请求实测,`CORS_ORIGIN` 钉到扩展 origin

**运营验证(真发冒烟)**
- R5. 路径 B(待审池→批量→发布)用**真实批次**验收:含 ≥3 项、其中人为构造 ≥1 项 gate-failed/失败项,验证分流、重试、隔离区行为符合预期;至少 1 篇真实发布并前台核验,跑通「生成→gate→审批→填充→发布」全链
- R6. 验证 SW 重启恢复、后端不可达 fail-closed 等异常路径在真实环境表现符合预期(至少各手动触发一次)

**日常运营 SOP**
- R7. 写一份单页运营手册 `docs/ops-runbook.md`:后端启停(start-backend.sh / 常驻方案)、每日批量操作步骤、data/ 备份节奏(建议每周 + 真发后;备份前停后端或对 .sqlite 用 `sqlite3 .backup` 在线备份,避免热拷贝拿到不一致快照,并至少做一次恢复演练验证备份可用)、常见故障与恢复(token 过期、后端挂、填充失效→fixture 重抓流程指引)。验收约束:runbook 不得包含任何真实凭证/token/hash,仅引用 .env 变量名与生成命令,提交前人工核对
- R8. 发布后建立首周观察点:每天真发后记录异常,一周后回顾决定是否需要新一轮修复

## Success Criteria

- main 分支可直接 fresh-clone 构建并全绿,日常使用全部基于 main
- 凭证全部轮换且后端正常启动,旧 key 作废
- 路径 A、B 均有真实发布记录且前台核验通过
- 操作者不看聊天记录、只看 runbook 就能完成日启停、批量发帖、备份、基础故障恢复

## Scope Boundaries

- 不做多用户/交付他人的部署体验(安装向导、用户文档)
- 不做新功能开发(智能化路线 Phase 1-5 已封板,新需求进入发布后迭代)
- 不做 SQLite 全面迁移等架构性重构(已回退的决策不重启)

## Key Decisions

- 以「自用稳定运营」为发布定义:`LLM_API_KEY` 轮换立即执行(持续暴露风险,与代码无依赖);其余优先级 = 合入基线 > 安全闭环 > 真发验证 > SOP,功能开发冻结(R2 属安全/可用性 hardening,不算新功能)
- grounding gate 前置检查(R2)保留在发布前而非延后:它直接决定日常批量的可用性

## Dependencies / Assumptions

- R1 前置验证(不留假设):先 `git log main..<MR6分支>` 与 `git log main..<MR7分支>` 核对 MR!6 的每个 commit 是否已含于 MR!7;不在则逐项判断,不预设「冲突一律取 !7」
- R3/R5 需要操作者本人参与(凭证、真后台登录态),不能全自动

## Outstanding Questions

### Deferred to Planning
- [Affects R5][Technical] 路径 B 冒烟的具体 checklist(哪些 gate 状态、审批操作要覆盖)
- [Affects R7][Technical] 后端常驻方案选 launchd 还是手动 start-backend.sh(单机自用,手动可能足够;若常驻需确认仅监听 127.0.0.1)
- [Affects R4][Needs research] 扩展 Origin 稳定性策略:dev(load unpacked)与打包形态 ID 是否一致;manifest 写死 `key` 固定 ID,或 CORS allowlist 同放 dev/prod 两个 ID;禁止以放宽为 `*` 兜底。注明 CORS 是纵深防御,JWT 仍是主闸
- [Affects R7][Technical] 备份存放位置与保护:仓库外、不入同步盘(或加密后再同步)、不含 .env、保留份数
- [Affects R8][Technical] 首周观察分两档:阻断性异常(填充失效、闸门误放行)当日处理走慢循环;非阻断累计记录、周末回顾
- [Affects R6][Technical] SW 重启恢复至少覆盖两个杀点(生成中、生成完成未落盘),或写明单次冒烟仅为抽查、依赖既有单测

## Next Steps
→ /ce:plan for structured implementation planning
