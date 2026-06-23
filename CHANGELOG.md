# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0.0] - 2026-06-23

### Added

- **吃瓜文章生成**：在「待审核选题」页对已核对的 gossip 选题点击「生成文章」，可一键生成符合规范七/八的九段落结构文章（开头简介 → 快速看懂 → 事件经过 → 图片/视频占位 → FAQ → 结尾总结 → 来源链接），文章主体由 LLM 生成散文槽位 + 系统 verbatim 注入事实骨架，防幻觉不变量确保 body 里唯一的 `<a href>` 来自 facts.來源連結
- **品质警告**：标题过短、含营销词等品质问题在文章生成后以警告提示显示，不阻断草稿编辑流程
- **内容标签校验**：`validateArticleTags` 检测营销词（爆款、必看、炸裂等），统计不足 3 个标签时给出警告

### Fixed

- **并发生成保护**：某条选题正在生成文章时，其余选题的「生成文章」按钮自动禁用，防止并发 LLM 调用重复扣费
- **「生成文章」按钮样式**：补充缺失的 `.btn-secondary` CSS 规则，修复按钮无背景色呈现空白的问题
- **已审核状态守卫**：后端路由新增 `status === 'approved'` 检查，已拒绝/待审核选题不会触发文章生成
- **domain 守卫简化**：`rowToTopic()` 始终强制 domain 为 `gossip` 或 `acg`，移除冗余的 `topic.domain &&` 真值检查

### Changed

- **测试覆盖**：新增 `generateArticle` 代理层测试（422/超时/网络错误/正常路径）；新增选题状态守卫路由测试；新增 `handleGenerateArticle` 路由与 fetch 错误路径测试

## [0.2.5] - 2026-06-23

### Removed

- **JWT 鉴权层完全移除**：个人自用工具，撤除所有权限限制。删除 `auth-middleware.ts`、`auth-routes.ts`、`auth-client.ts`、`AuthView.tsx` 共 8 个文件（含测试），合计净减 ~1 500 行代码
- **extension**：`apiFetch()` 不再携带 `Authorization: Bearer` 头；`llm.ts` 移除 token 获取与 401 刷新逻辑；`App.tsx` 移除登录态、`AuthView`、`Loading` 组件
- **backend**：`app.ts` 移除 `requireAuth` preHandler 与 swagger bearerAuth；`/login` 路由整组删除；`PUBLIC_ROUTES` Set 不再存在
- **preflight**：移除永远 false 的 `jwt-secret` 检查项（JWT 已删，该项无意义）
- **env-check**：移除 `JWT_SECRET` / `JWT_ADMIN_PASSWORD_HASH` 校验；后端启动仅需 `CORS_ORIGIN` 非通配

## [0.2.4] - 2026-06-23

### Fixed

- **useErrorLogger / useOperationHistory 竞态**：同一渲染周期内的两次写入不再互相覆盖（改用 `useRef` 作同步真相源，存储写入与 state 更新都从 ref 取最新值）
- **ExportPanel 定时器泄漏**：`setTimeout` 在 unmount 后可能触发的 `setState` 已改为 `clearTimeout` 清理，消除 React 控制台警告
- **telegram 日志脱敏**：catch 块改为只打印 `e.message`（避免 cause 链意外带出 token），并对错误信息中残留的 token 做 `replaceAll` 脱敏
- **generate-id 同毫秒碰撞**：改用 `crypto.randomUUID()` 前段 + 进程内单调计数器后缀，杜绝同毫秒生成的 ID 相撞

### Changed

- **quality-metrics DDL 记忆化**：全局 bool 换成 `WeakSet<BetterSqlite3DB>`，以 db 实例为键——新连接自动重建表，测试不再需要外部复位操作；DDL/查询错误不再静默吞掉（`healthz` 可感知真实 DB 故障）
- **data-dir 弃用提醒**：单次进程仅警告一次 `PUBLISHER_DATA_DIR is deprecated`，避免每次调用刷屏
- **gossip-client / pending-client 错误样板收敛**：401/非 2xx 处理逻辑从 5 处重复降为 1 个 `handleGossipResponse` helper；`pending-client` 同理抽出 `requestWithFallback`，删除已死亡函数
- **DraftReviewPanel 无障碍**：错误态加 `role="alert"` ARIA live region；review/rewrite 失败后可直接点击重试，不需手动刷新

### Added

- **audit-log 单测**：`auditLogin` 之前无测试，新增 append-only、结构化字段、吞错误、不泄漏 PII 等四类验证
- **CI release 安全门补齐**：`release.yml` 同步 Node 版本到 `.nvmrc`；fixture 脱敏闸（`check-fixture-secrets`）和 gitleaks 全史密钥扫描从 PR 门延伸至 tag 发布路径（之前 tag 是 fail-open）；gitleaks job 加 `timeout-minutes: 10` 和最小权限 `contents: read`

## [0.2.3] - 2026-06-22

### Changed

- **版本号归一为合法 SemVer**：根 `VERSION` 与三个包统一为 `0.2.3`（此前根为 4 段非法 `0.2.2.1`、三包为 `0.2.2`，错位会使构建出的扩展 manifest 版本与 git tag 不一致、破坏 Chrome 更新检测）

### Fixed

- **`.env.example`**：`JWT_SECRET` 占位值留空（弱占位值会触发 fail-closed 首启失败）；移除 Quality gate 段下误植的重复 `ENRICHMENT_MAX_QUERIES`
- **renovate**：弃用的 `config:base` 预设改为 `config:recommended`

## [0.2.2.1] - 2026-06-22

### Removed

- **ACG 批量链路（死代码）**：移除 `RUN_BATCH`/`GET_BATCH` 消息类型、`handleRunBatch`、`batch.ts`、`assemblePrompt` 等整条 ACG 批量管线（从未被 UI 调用），净减 722 行
- **`dailyBatchSize` 设置项**：从 `Settings` 类型、存储层、及设置面板 UI 中完全移除
- **`FACT_TARGET` / `FactTarget`**：ACG 专用字段→草稿映射类型，随链路一并删除

### Fixed

- **指标页 "批次完成数" 卡片**：该卡片在 ACG 链路删除后将永远显示 0 且无法更新，已移除；空状态提示文案更新为实际可触发的路径

## [0.2.2] - 2026-06-18

### Fixed

- **gossip-theme 双向包含匹配 bug**：`parseThemes()` 的 `ftt.includes(ft)` 方向导致输入 `戀情` 被错误归入 `公開戀情`（因为 `"公開戀情".includes("戀情") === true`）；移除该方向，保留 `ft.includes(ftt)` 单向包含，确保精确匹配

### Added (Tests)

- **gossip-theme 精确断言**：`公開戀情` / `戀情` 各自独立测试用例替代旧 `.toMatch(/戀情/)` 弱断言；新增 fold passthrough 与简繁兼容测试
- **draft-gen category fallback 测试**：覆盖 `熱度標籤 为空` 时回落 `normalizeCategory(parsed.category)` 路径
- **prompt-assembly THEME_ALLOWLIST 断言**：验证 `buildConstraintSuffix` 输出包含实际词条 `出軌`

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
