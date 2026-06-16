---
date: 2026-06-15
topic: comprehensive-health-checkup
---

# 全面体检 — 新基线与升级方向

## Problem Frame

运营者要求「全面升级规划」。但本项目已有 19 份 brainstorm + 9 份 plan，规划不缺——故先做一次五维度现状盘点（安全 / 技术债 / 测试 / DX-Ops / **产品完成度**），用真实信号决定升级方向，而非凭印象。

体检确认：**脊椎比 06-15 修复前更硬，但北极星依旧是 0——一篇真实发布都没发过。** 升级最高杠杆不是加功能，是收口已完成工作 + 发出第一篇。

## 体检结果（2026-06-15 新基线）

| 维度 | 状态 | 关键信号 |
|---|---|---|
| 安全 | 🟢 健康 | 闸门链有对抗测试守护；CI 新增无条件 gitleaks + SSRF DNS-rebind 测试 |
| 技术债 | 🟢 健康 | 0 个 TODO/FIXME；compile 全绿；BatchReviewPanel 已 1236→633 行 |
| 测试 | 🟢 强 | 906 通过（后端 277 / 扩展 629），91 测试档；e2e 动态提交盲区已闭合 |
| DX-Ops | 🟡 一处风险 | CI 六道闸（compile/lint/test/e2e/fixtures/gitleaks）；pino redaction 落地 |
| 产品完成度 | 🔴 北极星缺口 | 真实发布 = 0；runbook 已写但运营动作从未执行 |

## Requirements

**A. 文件真相校正（P0，已部分完成）**
- R1. ✅ **iframe 漂移已修**（commit `2a4af66`）：`CLAUDE.md` / `field-mapping-guide.md` 仍写「非 iframe」（停在 06-03 快照），但 06-10 再勘查发现表单在 layuiAdmin 同源子 iframe 内、顶层查询必然落空（故有 `lib/frame-resolve.ts`）。三份核心文件已统一到 frame-agnostic 真相。

**B. 收口已完成工作（P0）**
- R2. 把 `refactor/p2-hygiene` 分支（19 commit、66 档、+2568/-1094，含整个 A→C→B→D 修复计划 + P2 卫生）合并进 `main`。clean fast-forward 可行。**push 由运营者确认后执行**（不可逆）。

**C. 首飞（P0，运营者亲手）**
- R3. 按 `docs/runbooks/first-flight-runbook.md` 走完一遍：密钥轮换（含 LLM key revoke + 清史）、dry-run、真发 ≥1 篇、前台核验、CORS 收紧、push。代码侧前置已就绪，卡在不可逆运营动作。

**D. 产品能力路线图（P1，首飞后再规划）**
- R4. 选题智能 / 批量体验 / 学习闭环 / 多站点扩展等中长期能力——**刻意延后到首飞之后**，避免在「从没真发过一篇」的状态下规划第 20 份没人执行的功能文档。

## Success Criteria
- 任何人/agent 只读文件就能正确理解后台 frame 结构，不被「非 iframe」误导（R1 ✅）。
- 已完成工作落进 main，未合并风险清零（R2）。
- ≥1 篇真实发布成功 + 前台核验通过——「可上线」从愿望变事实（R3）。

## Scope Boundaries
- 不重写安全闸门链 / 三世界模型（体检确认健康）。
- 不新增产品功能（D 组延后到首飞后）。
- 密钥轮换 / 真发 / CORS / push 等不可逆动作由运营者亲手执行。

## Key Decisions
- **先收口 + 首飞，后规划功能**：体检证实项目不缺规划缺执行；最高杠杆是发出第一篇，而非加能力。
- **iframe 真相取最新勘查**：06-10 再勘查（同源 iframe）推翻 06-03（顶层），代码 `frame-resolve` 本就两种兼容，文件统一到此。

## Next Steps
→ 合并 `p2-hygiene` → `main`（本地 FF，push 待确认）→ 运营者跑首飞 runbook → 首飞成功后 `/ce:brainstorm` 规划 D 组产品路线图。
