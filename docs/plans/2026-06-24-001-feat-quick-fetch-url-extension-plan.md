---
title: "feat: 扩展快速抓取 URL 入口（pipeline 起点）"
type: feat
status: active
date: 2026-06-24
---

# feat: 扩展快速抓取 URL 入口（pipeline 起点）

## Overview

在 Chrome 扩展的 **GossipView** 顶部新增一个「快速抓取」面板，让用户可以：

1. 一键抓取**当前浏览器标签页** URL
2. 手动粘贴**任意 URL** 后抓取

抓取后调用已有的 `POST /api/v1/gossip/topics/from-url` 接口，结果直接进 pending 队列，不需要走「管理站点 → 发现列表」的完整流程。

## Problem Frame

现有 pipeline 最短路径：`GossipView` → 添加站点 → 点「刷新」发现 → 逐条点「加入」→ pending 队列。用户正在浏览某篇吃瓜文章时，没有快捷方式直接把这条 URL 送进 pipeline，必须先经过站点管理和发现步骤。

目标：在 pipeline 最前端增加一个「直送」入口，绕过站点管理，单条 URL 快速入池。

## Requirements Trace

- R1. 点击「抓取当前页面」按钮 → 获取当前 tab URL → 送入 pipeline
- R2. 输入任意 URL + 点击「抓取」→ 送入 pipeline
- R3. 抓取成功后 → 跳转 pending 选题页，与现有「加入」按钮行为一致
- R4. SSRF 拦截（域名不在 allowlist）时 → 显示明确错误，提示先在「渠道白名单」中添加该域名
- R5. 当前 tab URL 不可用（非 http/https）→ 友好提示

## Scope Boundaries

- **不涉及**：修改后端 `from-url` 接口（直接复用）
- **不涉及**：批量抓取或队列管理
- **不涉及**：扩展注入任何页面内容（仅读 tab URL）
- **不涉及**：在主视图（App.tsx 的 main 模式）直接加入（集中在 GossipView 统一维护数据收集入口）

## Context & Research

### Relevant Code and Patterns

- `packages/extension/lib/gossip-client.ts` — `fetchGossipTopicFromUrl(url, siteName)` 是核心调用，已有 60s 超时、409 去重处理
- `packages/extension/entrypoints/sidepanel/gossip/SiteCard.tsx` — 调用 `onGenerate` 的模式（busy/error per-item）供参考
- `packages/extension/entrypoints/sidepanel/GossipView.tsx` — 父组件，持有 `onTopicAdded` 回调，是集成挂载点
- `packages/extension/wxt.config.ts` — 当前 permissions: `["storage", "sidePanel", "alarms"]`，**未含 `tabs`**

### Institutional Learnings

- 自用模式下后端无鉴权（JWT 已移除）；`fetchGossipTopicFromUrl` 直接可用
- SSRF allowlist 在后端是 fail-closed：域名不在 channel 列表时后端返回 400/403，扩展端需解析 error 字段
- 测试用 `lib/__test-utils__/mock-fetch.ts` 统一 mock fetch

### External References

- Chrome MV3 `tabs` 权限：`tabs.query({active: true, currentWindow: true})` 需要 `tabs` permission 才能访问 `tab.url`（`activeTab` permission 在 sidepanel 不会自动授权）

## Key Technical Decisions

- **`tabs` 权限**：在 `wxt.config.ts` 中加入。side panel 不触发 `activeTab` 临时授权，只有声明 `tabs` 权限才能读当前 tab 的 `url`。
- **`siteName` 从 URL 提取**：用 `new URL(url).hostname` 自动生成，不要求用户手动填写，降低摩擦。
- **QuickFetchPanel 自治**：自管 busy/error/url-input state，不把状态上浮到 GossipView，减少父组件改动。只通过 `onTopicAdded: () => void` 向外通知成功。
- **SSRF 错误友好处理**：后端 400 返回「SSRF」/ 「不在 allowlist」类错误时，组件显示「该域名未在渠道白名单，请先在下方添加」，而不是裸错误码。
- **非 http/https URL 在客户端拦截**：避免无意义的后端请求（如 `chrome://`、`about:`）。

## Open Questions

### Resolved During Planning

- **当前 tab URL 能否读**：需要 `tabs` 权限，在 manifest 中声明即可（见 Key Technical Decisions）。
- **`siteName` 怎么填**：从 URL hostname 自动提取。
- **组件放在哪**：GossipView 顶部，与现有站点管理 / 渠道白名单保持同页，统一「数据收集」视图。

### Deferred to Implementation

- 是否需要显示抓取进度百分比（目前只显示「抓取中…」文字，与现有 SiteCard 一致）

## High-Level Technical Design

> *以下为方向性设计，不是实现规格；实现时以代码和测试为准。*

```
用户在 GossipView
│
├── QuickFetchPanel（新组件，GossipView 顶部）
│   ├── [📋 抓取当前页面] 按钮
│   │    └── getCurrentTabUrl()          ← lib/current-tab.ts（新）
│   └── [URL 输入框] + [🔗 抓取] 按钮
│         └── 直接读 state.urlInput
│
│ 两者共用同一抓取逻辑：
│   1. 校验 URL 格式（http/https，client-side）
│   2. siteName = new URL(url).hostname
│   3. fetchGossipTopicFromUrl(url, siteName)  ← 已有
│   4a. 成功 → onTopicAdded()（跳转 pending 页）
│   4b. SSRF 错误 → 友好提示「请先加渠道」
│   4c. 其他错误 → 显示后端 error 字段
│
└── ChannelWhitelistPanel（现有，位置不变）
└── AddSiteForm（现有，位置不变）
└── SiteCard 列表（现有，位置不变）
```

## Implementation Units

```
U1 ──► U2 ──► U3
```

- [ ] **Unit 1: tabs 权限 + getCurrentTabUrl 工具函数**

**Goal:** 为扩展声明 `tabs` permission；提供可测试的工具函数读取当前 tab URL。

**Requirements:** R1, R5

**Dependencies:** 无

**Files:**
- Modify: `packages/extension/wxt.config.ts`
- Create: `packages/extension/lib/current-tab.ts`
- Create: `packages/extension/lib/current-tab.test.ts`

**Approach:**
- `wxt.config.ts`：permissions 数组加入 `"tabs"`
- `lib/current-tab.ts`：导出 `getCurrentTabUrl(): Promise<string | null>`，内部调用 `browser.tabs.query({ active: true, currentWindow: true })`，返回第一个 tab 的 `url`（若不是 http/https 则返回 `null`）
- 测试用 vitest + mock `browser.tabs.query`

**Patterns to follow:**
- `lib/connection-test.ts` — 同样 mock `browser.*` 的工具函数测试模式

**Test scenarios:**
- Happy path: `browser.tabs.query` 返回 `[{ url: 'https://example.com/article' }]` → 返回该 URL
- Edge: tabs 为空数组 → 返回 `null`
- Edge: URL 是 `chrome://newtab/` → 返回 `null`（非 http/https 过滤）
- Edge: URL 是 `about:blank` → 返回 `null`
- Edge: `browser.tabs.query` 抛出异常 → 捕获并返回 `null`（不向外抛）

**Verification:**
- `pnpm test` 通过；`lib/current-tab.ts` 无 TypeScript 错误

---

- [ ] **Unit 2: QuickFetchPanel 组件**

**Goal:** 实现「快速抓取」自治 UI 组件，覆盖当前页面抓取 + 手动 URL 抓取两种方式。

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 1（`getCurrentTabUrl`）, `fetchGossipTopicFromUrl`（已有）

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/gossip/QuickFetchPanel.tsx`
- Create: `packages/extension/entrypoints/sidepanel/gossip/QuickFetchPanel.test.tsx`

**Approach:**
- 组件 Props: `{ onTopicAdded: () => void }`
- 内部 state: `urlInput: string`, `busy: boolean`, `error: string`, `successMsg: string`
- 共用 `doFetch(url: string)` 私有函数：client-side 校验（非 http/https → 直接 setError）→ 调 `fetchGossipTopicFromUrl` → 成功 onTopicAdded → SSRF 类错误 → 附加「请先在渠道白名单添加该域名」提示
- SSRF 错误识别：后端返回 HTTP 502 + error 字段含 `"not in allowlist"` 字样时（来自 `ssrf-guard.ts` 抛出的 `SsrfError`，经 `gossip-routes.ts:217-220` 包装为 `"Failed to fetch URL: Host not in allowlist (hop N): hostname"`），显示「请先在渠道白名单添加该域名」友好提示；其他错误直接显示后端 error 字段
- 样式沿用 `gossip/styles.ts` 中已有 `btn` 样式
- 「当前页面」按钮 disabled 时机：busy 中

**Patterns to follow:**
- `gossip/SiteCard.tsx` — busy/error 状态模式
- `gossip/AddSiteForm.tsx` — 输入框 + 按钮组合样式
- `lib/__test-utils__/mock-fetch.ts` — 测试中 mock fetch

**Test scenarios:**
- Happy path（手动 URL）: 填入有效 URL → 点「抓取」→ `fetchGossipTopicFromUrl` 调用成功 → `onTopicAdded` 被调用、error 清空
- Happy path（当前页面）: `getCurrentTabUrl` 返回 URL → 点「抓取当前页面」→ 同上
- Error path: `getCurrentTabUrl` 返回 `null` → 显示「当前标签页不是有效网页」提示
- Error path: 输入 `chrome://` URL → 客户端校验拦截，显示「只支持 http/https 链接」
- Error path: 后端返回 HTTP 502 + error 含 `"not in allowlist"` → 提示「请先在渠道白名单添加该域名」
- Error path: 后端返回其他 400（如「抓取失败」）→ 原样显示后端 error
- Edge: 409 重复 URL → 与现有 `GossipView.handleGenerate` 相同，视为成功并调 `onTopicAdded`
- Edge: busy 中再次点击 → 按钮 disabled，无二次触发

**Verification:**
- `npx vitest run entrypoints/sidepanel/gossip/QuickFetchPanel.test.tsx` 全通过
- 无 TypeScript 错误

---

- [ ] **Unit 3: 集成进 GossipView**

**Goal:** 将 `QuickFetchPanel` 挂载到 `GossipView` 顶部，连通 `onTopicAdded` 回调。

**Requirements:** R1–R5（端到端流通）

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/GossipView.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/GossipView.test.tsx`（补集成场景）

**Approach:**
- 在 `GossipView` return JSX 的最顶部（header 之后、`ChannelWhitelistPanel` 之前）渲染 `<QuickFetchPanel onTopicAdded={onTopicAdded} />`
- `GossipView` 本身无需新增 state（QuickFetchPanel 自治）
- 测试补充：渲染 `GossipView` 时 `QuickFetchPanel` 的「抓取当前页面」按钮存在于 DOM 中

**Patterns to follow:**
- 现有 `GossipView.tsx` 中 `ChannelWhitelistPanel` / `AddSiteForm` 的挂载方式（受控组件传 props）

**Test scenarios:**
- Integration: 渲染 `GossipView`，断言「抓取当前页面」按钮可见
- Integration: 模拟 `QuickFetchPanel` 调用 `onTopicAdded` → GossipView 上层 `onTopicAdded` prop 被调用

**Verification:**
- `pnpm test` 全通过（包含 GossipView + QuickFetchPanel 测试）
- `pnpm compile` 无 TypeScript 错误

## System-Wide Impact

- **权限变更**：新增 `tabs` 声明，Chrome 扩展安装/更新时用户会看到权限变更提示（「读取浏览器标签页」），这是唯一对外可见的影响
- **后端无变更**：复用现有 `/api/v1/gossip/topics/from-url`，SSRF 守卫不变
- **不变量**：GossipView 的渠道管理 / 站点管理 / discover 流程全部保持不变；QuickFetchPanel 是附加入口，不替代现有流程

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `tabs` 权限导致 Chrome 权限提示影响用户体验 | 权限提示是「读取标签」而非「访问所有网站」，是标准操作；在 README / CHANGELOG 说明 |
| 后端 SSRF 错误消息字符串变动导致友好提示失效 | 在 QuickFetchPanel 里检测 error 消息的匹配逻辑加注释，未来改后端时同步更新；测试 cover SSRF 错误场景 |
| `browser.tabs.query` 在测试中需要 mock | 与 `lib/connection-test.ts` 同模式，已有先例 |

## Sources & References

- 现有 gossip 调用链: `packages/extension/lib/gossip-client.ts`
- 渠道管理: `packages/backend/src/routes/channel-routes.ts`
- 后端 from-url 路由: `packages/backend/src/routes/gossip-routes.ts`
- WXT 权限配置: `packages/extension/wxt.config.ts`
- 测试 mock 工具: `packages/extension/lib/__test-utils__/mock-fetch.ts`
