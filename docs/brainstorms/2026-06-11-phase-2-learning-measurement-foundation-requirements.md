---
date: 2026-06-11
topic: phase-2-learning-measurement-foundation
---

# 阶段 2：学习与度量地基

## Problem Frame

阶段 1 首飞完成（路径 B ≥1 篇真实发布），基本链路成立。但当前系统存在三个结构性盲区：

1. **度量缺失**：trajectory 只在 authorized 档位落档；off/dry-run 发布路径无遥测；LLM 成本/耗时无记录。「直发率」「degrade 率」「每篇成本」三个关键指标目前全靠人猜。
2. **学习闭环断裂**：`BatchItem.draft` 与 `TrajectoryRecord` 都存在，但无 diff 计算；few-shot 管理仍是自由文本框，结构化 UI 未建；操作者改稿产生的优质数据无一键路径回灌。
3. **首飞观察项未入档**：R1 要求的五项观察（cover_url 类型、admin session 寿命、隐藏帖可访问性、publishUrl 可得性、时间戳行为）已在首飞中经历，但未形成文字，影响后续阶段方案决策。

**阶段 2 目标**：让「直发率 / degrade 率 / 每篇成本」三个数字自动产出，并完成 few-shot 学习闭环基础设施，为阶段 3 质量提升奠定可度量的地基。

---

## 阶段 2 过闸闸门

> 基线数字自动产出（直发率 / degrade 率 / 每篇成本），基线判定规则成文（含样本量、观察窗、直发的计法）

---

## Requirements

**闸门优先组（先跑，跑完才能评估阶段 2 是否通过）**

*度量基础设施*

- R6a. **全档位度量落档**：off / dry-run / authorized 三档均写 trajectory（或单独轻量日志），每条记录包含：档位、`hasManualEdit` 布尔标记（发布手势时是否手动改稿）、生成耗时。当前代码仅 authorized 落档（`batch-orchestrator.ts:248–262`），需补 off/dry-run 落档点。
- R6b. **每篇 LLM 成本计量**：读取 `response.usage`（tokens\_in + tokens\_out）；若端点不返回 usage，按正文字符数降级估算（标注「估算」）。每批次汇总总成本。写入 `BatchItem` 并随 trajectory 落档。

*聚合与基线定义*

- R7. **批次级 degrade/fillResults 汇总**：在批次视图中展示每篇「N 个字段降级 / 总 M 个字段」；在批次列表展示「该批 degrade 率」；高频降级词（top 5，按该批次内降级出现次数排序）显示在汇总区（展示位置见「Deferred to Planning」）。数据源：扩展本地 `fillResults`（权威），不依赖后端镜像。
- R6c. **直发率基线判定规则成文**：在 `docs/baselines/direct-publish-rate.md` 中明确：① 基线样本量与观察窗（如「累计 ≥10 篇且跨 ≥3 次批次」）；② 「直发」的权威判断字段 = `hasManualEdit === false`（而非 slot-level diff；slot diff 由 R5b 在后闸门阶段引入，基线规则不依赖它）；③ 标题候选切换是否计为改稿（计入则需补 `hasManualEdit` 标记）；④ 跨阶段工作流变更时是否重置基线。

**后闸门组（闸门通过后执行，不阻塞过闸）**

*首飞补档与评测*

- R1-obs. **首飞观察项补档**：将首飞中的五项观察结论记录到 `docs/run-sheet-首飞与基线.md` 的空白回填表中：① cover\_url 字段类型（hidden URL input vs file upload）；② admin session 实际寿命；③ status=0 隐藏帖在未登录前台的可访问性；④ save 响应是否携带前台 URL；⑤ 帖子对外时间戳行为。结论影响 R19（封面）、R8（publishUrl 写入）、R24（回访）的规划时方案。
- R10. **评测金标准集**：整理 10–20 条 golden topics（含事实块 + 期望输出方向），记录在 `docs/eval/golden-set.md`；制定人工并排对照流程（改 prompt/换模型/调 few-shot 前后各生成一次，逐条人工打分）。程序化评分为候选项，待变更频率证明需要再建。

*数据差异与学习闭环*

- R5b. **aiDraft 编辑差异计算**：在 `BatchItem` 中新增 `aiDraft` 字段（原稿快照），发布确认时与最终 `draft` 做 slot-level diff（改了哪些字段、改动幅度）；diff 结果落 trajectory。此为 R11 回灌的数据来源。注意：`hasManualEdit` 标记（R6a）独立维护，不被 R5b diff 取代——前者在 R6c 基线中是主判定字段，后者提供细粒度分析。
- R3. **few-shot 可视化编辑器**：Settings 中将现有自由文本 `fewShotExamples` 替换为结构化卡片列表（每条 `{input: string, output: string}`），支持增删改、保存时序列化。上限 8 条（满时提示淘汰旧条目）。存量自由文本自动拆分预填 + 人工确认路径（规划时定拆分策略）。
- R11. **一键回灌**：审读完成后，提供「存为 few-shot 范例」按钮（直接写入，操作即确认，可撤销）；degrade 词聚合推荐走「待确认通道」（diff 预览 + 人工批准）。**严守 L2 边界：绝不静默改 prompt/词表。**

*后端基础设施*

- R9. **备用 LLM 端点 Settings UI**：在 Settings 面板中新增 fallbackModel 输入框（端点 URL + 模型名），保存到 `Settings.fallbackModel`。后端 `llm.ts` 的 fallback 逻辑已就位，仅缺前端配置入口。
- R8. **已发布帖后端注册表 V1**：后端新建 `published_posts` 表（SQLite），字段：`post_id, source_title, publish_url, publish_url_source（枚举：from_save / derived_id / not_available）, published_at, outcome`；发布确认时扩展写入；支持按 source\_title 查重（供阶段 4 R21 去重消费）。publishUrl 写入方式取决于 R1-obs 结论④，不可得时按 ID + 固定模板推导，推导失败时 `publish_url_source = not_available`（表中有记录可查，数据不静默丢失）。

---

## Success Criteria

- **度量自动产出**：连续 ≥3 次批次后，直发率 / degrade 率 / 每篇成本三个指标可从本地日志/UI 直接读取（无需人工统计）。
- **基线规则成文**：`docs/baselines/direct-publish-rate.md` 存在，未来阶段 3 改 prompt 后知道「算没算变好」。
- **学习闭环可用**：操作者可通过结构化编辑器管理 few-shot 范例，且「存为范例」按钮可用（即使 R10 评测集尚未建立）。
- **观察项入档**：run-sheet 空白回填表填完，后续阶段规划不再依赖「尚不确定」的备注。

---

## Scope Boundaries

- 不做报表 UI / 趋势图（等聚合数据被高频使用证明需要再建，R7 只做批次汇总展示）。
- 不做 L3 静默学习（R11 的回灌严格保持 L2 人在环）。
- R8 注册表 V1 只服务去重与回访通路，不做浏览量/收录监测（全路线无消费方）。
- 不做 R19 封面图资产化（依赖 R1-obs 结论①，待观察项补档后再评估）。
- R10 评测集为人工流程，不交付程序化评分脚本（除非变更频率证明需要）。

---

## Key Decisions

- **闸门先行**：R6a + R6b + R7 是阶段 2 核心路径，过闸后才有数据决定阶段 3 哪些需求可以压缩。
- **度量权威域 = 扩展本地**：R7 聚合在扩展侧执行（后端双写是 best-effort，镜像不可作聚合源），沿用路线图决策。
- **R3 + R11 在闸门后执行**：账实对账已知 few-shot 编辑器未实现，但它不阻塞「直发率」这个核心度量指标落地；先跑通度量，再补学习工具。
- **R1-obs 作为独立任务**：不阻塞 R6/R7，但尽早完成，避免 R8/R19 方案带「依赖不确定」技术债进规划。

---

## Dependencies / Assumptions

- `response.usage` 可得性：当前 LLM 代理端点是否回传 usage 尚不确定（标注「估算」的降级方案保证不漏）。
- 首飞观察项（R1-obs）：R8 publishUrl 写入策略、R19 封面方案均依赖其结论；本阶段的 R8 V1 以「推导失败标不可回访」作为兜底，不阻塞实施。

---

## Outstanding Questions

### Resolve Before Planning

（无——所有方案分支均内嵌了兜底路径，不阻塞规划启动。）

### Deferred to Planning

- [Affects R3][Technical] 存量自由文本 `fewShotExamples` 自动拆分策略（按换行/分隔符？还是纯手动预填？）。
- [Affects R6b][Technical] 当前端点 `response.usage` 字段名称与结构（不同代理代理的字段名可能不同）。
- [Affects R5b, R11][Technical] diff 触发「提示存为范例」的阈值（改了多少槽位才弹提示，0 改动不弹）。
- [Affects R8][依赖 R1-obs 结论④] save 响应不含前台 URL 时的 ID→URL 模板推导规则。
- [Affects R7][UX] 批次汇总区的展示位置：高频降级词 top 5 放批次列表行内还是批次详情顶部 banner（或两者都有）。

---

## Next Steps

→ `/ce:plan` 进行阶段 2 结构化实现规划（建议按「闸门优先组 → 后闸门组」两个子计划分开出计划）
