---
date: 2026-06-09
topic: comprehensive-capability-upgrade
---

# 产品能力全面升级

## Problem Frame

51publisher 工程基础扎实（286 单测 + 23 e2e、批量状态机、源接地防幻觉），但四个维度仍有明显短板影响每日可用性：

1. **自动抓取管线** — 基础设施已建（scheduler、site-adapter 接口、fact-extractor、pending-store、PendingTopicsView），但只有 demo 适配器、待审 UI 无法内联编辑事实字段、手动触发入口缺失，管线无法投入真实运营。
2. **分类/标签准确性** — `normalizeCategory` 已修复分类降级；标签仍依赖自由文字模糊匹配，后台 3912 条 tag 选项命中率不稳定。
3. **封面图字段空缺** — 后台新增 `cover_url` 隐藏字段（G3 漂移），`ContentDraft.coverImageUrl` 存在但未进入填充管道，自动抓取到封面时无法传递到表单。
4. **Few-shot 编辑体验** — `Settings.fewShotExamples` 仅支持原始文本输入，无法可视化增删调序，运营者调口吻成本高。

---

## User Flow

```
┌── 自动采集路径 ─────────────────────────────────────────────┐
│ 后端定时抓取 → 事实提取(含 coverUrl) → 待审池              │
│        ↓                                                    │
│ PendingTopicsView：列表 → 展开+内联编辑事实字段 → 批准/驳回  │
│        ↓                                                    │
│ batch-orchestrator → AI 生成草稿(分类/标签 prompt 约束) →  │
│ 填充表单(含封面图 URL → cover_url 字段) → 人工发布          │
└─────────────────────────────────────────────────────────────┘

┌── 手动输入路径(现有，维持不变)──────────────────────────────┐
│ 主题输入 → 生成草稿 → 预览编辑 → 填充 → 人工发布           │
└─────────────────────────────────────────────────────────────┘
```

---

## Requirements

**A. 自动抓取管线完整化**

- R1. PendingTopicsView 的展开卡（「详情」区域）将只读事实展示改为可内联编辑的输入字段：每个 FactsBlock 字段（作品名/集数/制作/漢化/無修/题材/简介）对应一个文本框，编辑后「批准」时携带修改值。
- R2. PendingTopicsView 展开卡展示封面图缩略图预览（当 rawContent.metadata 或 PendingTopic 中有封面 URL 时显示），让运营者在审核时判断图片质量。
- R3. Backend 提供 `POST /api/v1/scraper/trigger/:siteName` 端点（已有 scraper-routes 基础），扩展侧 PendingTopicsView 加「立即抓取」入口（调用该端点后刷新列表）。
- R4. 提供首个真实适配器的开发脚手架：一份带注释的 `template-adapter.ts`，覆盖 `SiteAdapter` 接口所有必填字段，包含 coverUrl 提取示例，放在 `packages/backend/src/scraper/adapters/`。适配器通过代码注册（`scraperConfig.registerAdapter()`），无需配置化框架。

**B. 分类/标签准确性：Prompt 约束 + 运行时安全网**

「双层」指两道防线：① Prompt 层（强，防模型造词）；② Filler 层（弱，兜底模糊匹配失败时记录原因）。两层作用于同一问题（分类/标签自由文字），不是两个不同字段各一层。

- R5. 系统 prompt（`buildPrompt`）内嵌真实分类选项（当前：`漫畫文章 / 動漫文章`）和运营者维护的推荐标签清单；模型被约束只从清单中选择，不自造新词。
- R6. Settings 新增「推荐标签清单」编辑区：运营者可粘贴/编辑以逗号或换行分隔的标签子集（约 20-50 条常用标签），保存后注入 prompt。此清单是运营者手工维护的常用子集，与后台 3912 条全量标签无关——fillers.ts 也只匹配此子集（不尝试命中全量）。
- R7. fillers.ts 标签填充结果中，将现有泛化的 `degrade` 消息细化为「具体哪个标签词在推荐子集中未命中」，便于运营者定向补充推荐列表。

**C. 封面图填充（G3 字段漂移修复 + 抓取联动）**

> G3 = 后台 2026-06-04 新增了隐藏输入框 `input[name=cover_url]`，当前 FieldMapping 无对应字段，首次真实发布（G2）可能因此漏填。

- R8. `FieldMapping` 类型增加 `coverUrl` 可选字段，默认选择器指向后台 `input[name=cover_url]`；`fillPage` 当后台存在该元素时写入值（简单的 `element.value =`，hidden input 无需特殊处理）。
- R9. `ContentDraft.coverImageUrl` 进入填充管道：当该字段非空时，值写入 R8 的 `coverUrl` 映射字段；原「仅作预览参考」标注移除。
- R10. 自动抓取的 `SiteAdapter` 接口扩展，允许适配器返回 `coverUrl`（可选）；`fact-extractor` 将其存入 `PendingTopic`；`PendingTopicsView` 批准时将其传入 batch-orchestrator，最终写入 `ContentDraft.coverImageUrl`。

**D. Few-shot 可视化编辑器**

- R11. Settings 页的 `fewShotExamples` 输入从原始文本 textarea 替换为结构化列表：每条范例显示为可折叠卡片，卡片内有「输入（话题/事实描述）」和「输出（草稿文风样本）」两个文本框。
- R12. 列表支持增加新范例（「+ 添加范例」按钮）、删除单条（卡片内「×」）。不要求拖拽排序。
- R13. 保存时，列表序列化回与现有 `fewShotExamples` 字符串格式兼容的表示（向前兼容；已有范例在升级后仍可读）。

---

## Success Criteria

- 自动管线：运营者按 `template-adapter.ts` 创建一个真实适配器并注册，重启后端后，待审选题出现在 PendingTopicsView；运营者在待审视图内联编辑并批准，该选题进入 batch-orchestrator 生成草稿。
- 标签准确性：首飞后连续 10 条真实发布抽查，标签字段 `degrade` 率 < 20%（现有基准未测量，本次建立基准）。
- 封面图：抓取到封面图 URL 的选题，审核批准后表单内 `cover_url` 字段自动填入（前提：cover_url 接受 URL 字符串已验证）。
- Few-shot 编辑器：操作者无需了解 JSON 格式即可增删 few-shot 范例。

---

## Scope Boundaries

- 不做封面图文件下载 + File 对象注入（只填 URL 到 cover_url 隐藏字段；如后台实际要求 file 上传，R8-R10 需调整，但 Resolve Before Planning 里先验证）。
- 不做完整标签词表同步（从后台自动拉 3912 条）——只维护运营者手工管理的常用子集（~20-50 条）。
- 不做适配器配置文件驱动热加载——适配器通过代码注册，新增适配器走代码变更流程，重启生效。
- 不做分类映射 Settings UI（`CATEGORY_VOCAB` 保持代码维护；当前两个分类极少变更，迁出 UI 引入 RegExp 序列化风险）。
- 不做 few-shot 范例拖拽排序（添加顺序即可）。
- 不做发布时间排程 UI（postStatus/publishedAt 字段保持现有手动填写方式）。
- 不做多站点 / 多操作者 / 权限管理。
- authorized 真实发布首飞（G2）仍是运营者动作，不在此轮代码改动范围内。

---

## Key Decisions

- **抓取目标站点推迟到初始化时决定**：适配器接口设计不绑定具体站点，`template-adapter.ts` 提供模板，运营者按模板创建真实适配器后通过代码注册，重启生效。无配置文件框架（没有第二个适配器需求时不过度设计）。
- **分类/标签准确性双层防线**：prompt 约束（嵌入清单）是主防线（强）；fillers.ts 模糊匹配是运行时安全网（弱），两者都作用于同一问题。fillers.ts 只匹配运营者维护的 20-50 条推荐子集，不尝试全量 3912 条。
- **封面只填 URL，不下载文件**：cover_url 是后台 hidden input，直接赋值字符串是最简路径；此假设需在规划前由运营者验证（见 Resolve Before Planning）。
- **few-shot 向前兼容**：序列化格式选取时优先保证已有范例不丢失。
- **分类映射保持代码维护**：`CATEGORY_VOCAB` 不迁入 Settings UI；当前两个分类极少变更，RegExp 序列化边界风险高于收益。

---

## Dependencies / Assumptions

- 后端在部署环境中持续运行且可被扩展访问（当前 localhost:3001 限制已知，与本轮无关）。
- 推荐标签清单由运营者从后台实际标签中手工整理（本轮不做自动同步）。

---

## Outstanding Questions

### Resolve Before Planning

- **[运营者验证] cover_url 字段类型确认**：请运营者打开后台发帖表单，检查 `input[name=cover_url]` 是否为 hidden 文本输入（值为 URL 字符串），还是关联 file upload 控件。若为 file upload，R8-R10 方案需调整，封面图填充本轮降级为「待定」。

### Deferred to Planning

- [Technical] **R13 fewShotExamples 序列化**：现有 `Settings.fewShotExamples` 是纯字符串还是已有结构？读 `storage.ts` 后决定新结构的序列化策略（JSON array vs 分隔符），确保向前兼容。
- [Technical] **R8 hidden input 填充**：`fillPage` 当前的 FieldType 枚举是否需要新增 `hidden` 类型，还是直接扩展现有 `text` 类型处理 hidden input——读 `fillers.ts` 后决定。
- [Needs research] **R4 scraper trigger 端点**：scraper-routes.ts 是否已有该端点或需新增；检查 backend index.ts 路由注册确认。

## Next Steps

→ `/ce:plan` 进行结构化实现规划
