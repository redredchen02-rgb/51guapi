# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1.0] - 2026-06-16

### Changed

- **大型组件拆分（Unit 6-8）**：`BatchReviewPanel.tsx`（588L→177L）、`TodayBatchView.tsx`（785L→218L）、`Settings.tsx`（590L→146L）各拆分为独立子组件，每个文件降至单一职责；相关逻辑移入 `useTodayBatchDomain` hook
- **fewShotExamples 单一真相源**：`getSettings()` 读取时派生，消除旧有双写路径；兼容旧格式用户，不覆盖已有数据
- **scraper/gossip/pending routes 归位**：三组路由文件从根目录移至 `src/routes/`，与其他路由文件统一存放位置

### Fixed

- **批量轮询无限重启**：`useTodayBatchDomain` 中 `items` 误入 polling `useEffect` 依赖数组，导致每次 `setItems()` 都销毁并重建 1500ms 轮询间隔；移除后只在 `stage` 变化时重建
- **发布/重试静默吞错**：`handlePublish` / `handleRetry` 现在在 `approveSingleItem` / `retryBatchItemMsg` 抛出时向用户展示错误提示
- **设置页数据丢失**：`fewShotExamplesResolved` 回退值从旧状态 `fewShotExamples`（可能为空字符串）改为 `undefined`，防止覆盖迁移用户的遗留数据
- **ApprovalBar 死字段**：移除从未实际使用的 `tabHealthy` 和 `onApproveBypass` props
- **测试加固(落地前评审)**：`app.test.ts` 断言改为带 token 校验；`config-store`/`app` 测试新增 teardown 关闭 WAL 句柄；移除空断言与名不副实的测试标题

### Added (Tests)

- **124 个单元/组件测试**：后端覆盖 config-store、metrics、scraper adapters、enrichment-utils、prompt store/routes、llm-config、app 路由；扩展覆盖 AuthView、DraftPreview、DryRunReport、ErrorBoundary、Settings、pending-client actions
- **useTodayBatchDomain 单元测试**：6 个用例覆盖初始状态、加载设置、Tab 错误处理、handleDailyBatch 早退路径、handleToggleRead、状态 setter
- **JWT 401 防护测试**：补全 gossip-routes / pending-routes / scraper-routes 缺失的 JWT 鉴权测试，确保无 token 请求返回 401



## [0.2.0.0] - 2026-06-11

### Added

- **Few-shot 视觉编辑器**：设置页新增结构化 Few-shot 范例编辑器，支持增删改、上下排序（最多 8 条）；可从旧格式 `fewShotExamples` 一键导入并自动解析 `input/output` 结构
- **保存为范例**：已发布条目可一键存为 few-shot 范例，支持 5 秒撤销 Toast
- **备用 LLM 端点**：设置页新增可折叠的备用 endpoint/model 配置，主端点失败时自动回退
- **published_posts 注册表**：`authorized` 模式下发布成功后 best-effort 双写后端注册表（失败静默，trajectory 为本地 source of truth）
- **AI 原稿快照 + slot-level diff**：生成时保存 `publishedDraft` 快照，发布后计算字段级 diff 并写入轨迹，用于统计操作者编辑率
- **度量基础（U1-U5）**：`DegradeStats`（降级字段统计）、`UsageStats`（token 用量）、`FillStats`（填充率）类型与聚合函数；降级汇总条、fill 率摘要、轨迹条目扩展字段
- **Golden-set 评估基线**：`docs/eval/` 新增 golden-set JSON 评估基准（R10）
- **VERSION 文件**：引入 4 位版本号规范（0.2.0.0）

### Fixed

- **PK 冲突**：`published_posts` 记录 id 改为 `batch.id:item.id`，防止多批次运行时主键碰撞导致第 2 批起全部静默丢失
- **urlSource 永远 undefined**：`lib/publish.ts` 现在在 `extractUrl()` 返回 URL 时正确设置 `urlSource: 'from_save'`
- **Toast 计时器泄漏**：5 秒自动消失计时器改用 `useRef` 管理，新 toast 替换旧 toast 时正确取消前一个计时器
- **Import 丢失结构**：`handleImport` 现在解析 `input\n---\noutput` 格式，正确还原 `input` 和 `output` 字段
- **markGenerating 不重置 userEdited**：re-queue 时正确将 `userEdited` 清为 `false`
- **addFewShotPair TOCTOU**：`BatchView` 新增 `savingItems` Set 防止同条目双击并发写入
- **确认按钮并发保护**：批次审批确认按钮加 `disabled={!!busy}` 防重复点击
- **backendUrl SSRF**：Settings 保存时校验 backendUrl 必须为 localhost/127.0.0.1；`published-posts-client` fetch 前二次校验
- **background.ts 双重类型转换**：`result.urlSource` 直接访问，移除 `as unknown as Record` 绕路
- **CONTENT_SLOTS 含非 AI 字段**：从 slot-diff 计算中移除 `postStatus`、`publishedAt`、`mediaId`（由人工填写，不应计入 AI 编辑信号）
- **日文注释**：`draft-diff.ts` 中的日文注释改为中文

### Changed

- **存储读取并行化**：`published-posts-client` 将 `getSettings` + `getBackendToken` 改为 `Promise.all` 并发读取
- **FewShotPairEditor 无障碍**：textarea 绑定 `id`/`htmlFor`；禁用态按钮增加 `opacity: 0.4` 视觉反馈；字号 12px → 13px
- **设置页无障碍**：备用端点折叠按钮增加 `aria-expanded`；Toast div 增加 `role="status" aria-live="polite"`
- **降级标签对比度**：状态标签颜色 `#888` → `#555`

## [0.1.0] - 2026-06-09

Initial release — batch fill + review panel + safety modes + trajectory auditing.
