---
date: 2026-06-12
topic: complete-publish-workflow
---

# 完整发帖 Workflow 收尾

## Problem Frame

Phase 5 的计划已写好，但三个关键缺口导致「从准备到发布隐藏帖子」流程无法完整跑通：

1. **postStatus 默认公开**：`llm.ts` 硬编码 `postStatus: "1"`，批次发布帖子直接公开，没有保护。
2. **published_posts 回写是死代码**：`publish-confirmed` 后 `recordPublishedPost()` 从未被调用，去重/历史追踪名存实亡。
3. **TodayBatchView 缺逐篇审读 UI**：点「一键备稿」后只触发生成并提示去 BatchView，R28（每篇必读才能发布）没有实现。

修复后，操作者能走通：**一键备稿 → 逐篇审读 → 发布为隐藏帖 → 注册表回写** 的完整闭环。

## 用户流程

```
操作者打开侧边栏
  │
  ├─ [今日备稿] 按钮
  │     │
  │     └─ 从 pending 高分选题取 N 条，触发批量生成
  │           │
  │           ├─ 生成中 → grounding gate 分流
  │           │     ├─ gate 通过 → filled / awaiting-approval（备稿就绪）
  │           │     └─ gate 拦截 → gate-failed（待人工）
  │           │
  │           └─ 生成完成 → TodayBatchView 切换到「审读队列」模式
  │
  ├─ [审读队列] 显示 filled/awaiting-approval 草稿列表
  │     │
  │     └─ 每条：[展开预览] → 读完 → [发布]
  │           │
  │           ├─ 触发 approve + fill + publish（postStatus="0" 隐藏）
  │           └─ publish-confirmed → recordPublishedPost() 写入注册表
  │
  └─ gate-failed 条目显示「内容问题」+ [重新生成] 按钮
```

## Requirements

**缺口 1：postStatus 默认隐藏**
- R1. `llm.ts` 生成草稿时 `postStatus` 默认值改为 `"0"`（隐藏）
- R2. 现有测试期望值同步更新为 `"0"`

**缺口 2：published_posts 回写**
- R3. `background.ts` 在 batch `publish-confirmed` 后调用 `recordPublishedPost()`，写入 topic/title/url/publishedAt
- R4. `publishedPostsClient.recordPublishedPost()` 入参取自 `BatchItem.draft`（title、topic）+ 当前时间戳
- R5. 回写失败不阻断主流程（best-effort，catch + warn 即可）
- R6. 单测覆盖：`publish-confirmed` 后 `recordPublishedPost` 被调用一次

**缺口 3：TodayBatchView 逐篇审读 UI**
- R7. `TodayBatchView` 生成完成后切换至「审读队列」模式，展示 `filled`/`awaiting-approval` 草稿列表
- R8. 每条草稿有「展开预览」折叠区，显示 title、subtitle、body 摘要（前 200 字），让操作者确认内容
- R9. 每条草稿必须「展开过至少一次」才能点「发布」（`readItems` Set 持久化进 `chrome.storage.local`）
- R10. 点「发布」后该条走 approve → fill → publish 完整链路，状态实时更新
- R11. `gate-failed` 条目显示拦截原因 + 「重新生成」按钮（已有 `retryItem` 逻辑，接入即可）
- R12. `aborted`/`error` 条目显示原因，不提供发布按钮

## Success Criteria

- 批次发布后，51acgs.com 后台帖子状态为「隐藏」而非「公开」
- `published_posts` 表行数 = 本次 publish-confirmed 数量
- 操作者无法在未展开预览的情况下点到「发布」
- 全部测试（`pnpm test`）绿

## Scope Boundaries

- **不含** `chrome.alarms` 定时自动触发（仍为操作者到场一键）
- **不含** `/healthz` 路由挂载（独立且次要，不进本 PR）
- **不含** postStatus UI 改为下拉选择器（文本输入已够用）
- **draftOverrides 不跨 SW kill 持久化**（已知限制，接受）

## Key Decisions

- **R9 用 `chrome.storage.local` 而非纯 React state**：SW kill 后 React state 丢失，read 标记消失会逼操作者重读；持久化保证「未读不能发」约束跨 kill 有效
- **R5 best-effort**：注册表写失败不应阻断已完成的发布；操作者可从后台手动补录，无需强事务
- **R3 调用点在 background.ts 的 APPROVE_BATCH handler 内**：与现有 `addPublishedTopics` 调用点一致，不新增消息类型

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] `recordPublishedPost` 的 `url` 字段：batch item 有无 url 字段，或需从 topic 拼接？
- [Affects R10][Technical] approve 单条的消息类型是否需要新增，还是复用 `APPROVE_BATCH` 只传该 item？

## Next Steps

→ `/ce:plan` for structured implementation planning
