---
title: '安全地交付用户可见功能:小步 PR + 对抗式验证 + 固定枚举错误 + 原子批操作'
date: 2026-06-15
category: docs/solutions/best-practices
module: packages/extension + packages/backend(Theme E 横跨两包)
problem_type: best_practice
component: development_workflow
severity: medium
related_components: [tooling, testing_framework]
applies_when:
  - 一个主题要拆成多个改动落地(每 unit 一个 PR,等 CI 绿再做下一个)
  - 依赖子代理/AI 完成多步工作并自报结果(需对抗式复核前提真伪)
  - 给会接触密钥的功能写错误反馈(映射为固定文案,绝不回显上游原始错误)
  - 给重试/退避逻辑设默认值(只重试 429/5xx,每次尝试新建 AbortController,clamp 到 cap)
  - 批量状态变更需保证原子性(一次性 fold 成单个对象,无变化则返回同一引用)
tags: [incremental-pr, adversarial-verification, retry-backoff, error-message-safety, atomic-batch-update, dependency-injection, scope-discipline]
---

# 安全地交付用户可见功能:Theme E「产品体验升级」沉淀

## Context

Theme E 落地了三个互相独立的用户可见改进:Settings「测试连接」、LLM 重试/退避、批量撤出隔离区。每个功能本身都小,真正的摩擦不是「怎么做」,而是 **如何在不破坏项目安全姿态的前提下交付** —— 本仓库有零提交铁律、API key 绝不能进 UI、批次状态绝不能写一半。三个反复出现的坑:

1. 安全关键的异步代码(重试、超时、网络探测)难以在不依赖真实时间/网络下测试,容易被省掉测试。
2. 错误反馈是最容易泄密的地方 —— 上游原始错误体里带 endpoint/key。
3. 评审子代理反复提出伪造前提(「0 个测试」「生产里丢了 timeout」「四态被夸大」),盲信即被带偏。

## Guidance

### 1. 错误映射成固定枚举 —— 绝不把上游原始文本回显到 UI/日志

`packages/extension/lib/connection-test.ts` 暴露闭合的 `ConnectionTestStatus` 联合(`ok | unauthorized | timeout | backend-unreachable | llm-error`)+ `FIXED_MESSAGE` 表。任何未识别的 `!res.ok`(包括一个 body 里夹着 endpoint/key 的 500)都坍缩成 `llm-error` 的 **固定** 文案,原始 body 永不进入 UI 字符串。

承重的是 **负向断言** 测试(`connection-test.test.ts`):

```ts
const leak = "https://la-sealion.inaiai.com/v1 key=sk-secret123";
// body = leak 的 500 响应
expect(r.message).not.toContain("la-sealion");
expect(r.message).not.toContain("sk-secret");
```

断言是「不包含」—— 证明泄漏的缺席;正向的「显示友好文案」会漏掉这点。

### 2. 注入式依赖让安全关键异步可在零真实时间/网络下测试

- `testConnection(fetchFn?: typeof fetch)` —— 换 mock fetch 驱动每条状态分支。
- `fetchWithBackoff(..., deps)`(`packages/backend/src/services/llm.ts`)—— 注入 `sleep` 让退避测试瞬时完成;注入 `maxRetries`。
- 批操作注入 `genBatchId`、`now`。

规则:函数行为若依赖时间、网络或随机性,该依赖必须是带真实默认值的参数,而非硬 import。

### 3. 只对可重试状态重试;每次尝试新建 AbortController+timer

`fetchWithBackoff` 只对 **429 & 5xx** 重试,从不重试 4xx。微妙的正确性点(llm.ts 内联注释):

> 每次尝试各自 AbortController+timer(勿共享,否则重试请求会被旧 signal 立即 abort)

跨尝试复用同一个 `AbortController` 是经典 bug —— 第二次尝试打在已 abort 的 signal 上瞬间失败。另:`res.headers?.get?.("retry-after")` 防御式写法,因为 mock fetch 响应可能没有 `headers` 对象。退避指数增长、clamp 到 cap;日志只带 `{status, attempt, delay}` 永不带 body。默认 `maxRetries=2`、`base=500`、`cap=8000`。

### 4. 原子/幂等批操作:无变化返回同一引用 + fold 成单个对象

`releaseAllQuarantine(batch)`(`packages/extension/lib/batch.ts`)用 `reduce` 把所有 `needs-human-verification` 项 fold 成 **一个** 新 `Batch` —— 中间态从不落盘(全或无)。无可撤项时,对空 id 列表 reduce 返回 **原 `batch` 引用**。

handler 借此跳过持久化(`background.ts`):

```ts
const next = releaseAllQuarantine(batch);
if (next === batch) return batch; // 无隔离项,不写
await deps.saveBatch(next);        // 单次原子保存(全或无)
```

引用相等就是廉价的 noop 信号,无需深比较。

### 5. 小而独立的 PR,以 CI 绿为闸,顺序合并

每个 unit = 一个 PR(#17 测试连接、#19 退避、#20 批量撤出)。每个 CI 绿才合,下一个在其上构建。胜过把三个维度塞进一个 PR —— 跨 Theme C 与 Theme E 反复印证的 institutional learning。

### 6. 对评审的前提先验证再行动

评审子代理提出过假声明(「0 个测试」「生产里丢了 timeout」「四态被夸大」),每个都被 30 秒 grep/read 证伪。把代理评审结论当 **待验证假设**,而非待修复事实。

### 7. 范围纪律:评审揭出更深问题时,砍掉而非硬接

E2(grounding 手编后复核)在评审揭出「grounding strip 已对编辑后草稿求值 = 潜在铁律泄漏」时被砍掉,延到 `/ce:brainstorm` 正式设计,而非硬塞进在飞的 PR。

## Why This Matters

这些实践把「交付有风险」变成「交付很无聊」。固定枚举 + 负向断言让密钥泄漏成为 **被捕获的回归** 而非潜伏隐患。注入式依赖把不可测异步变成毫秒级单测。同引用 noop + fold-into-one 消除半写损坏 —— 当批次状态守着零提交安全系统时至关重要。小步 CI 闸 PR 让爆炸半径小且可二分。前提核验杜绝最贵的失败模式:自信地修一个不存在的问题。

## When to Apply

- **固定枚举错误映射** —— 任何上游(后端/LLM/三方)错误文本可能到达 UI 或日志面时。所有用户可见错误态默认采用。
- **注入式依赖** —— 任何触及时间/网络/随机、又想单测的函数。
- **每次尝试新建 AbortController** —— 任何带超时的重试循环。
- **同引用 noop + fold-into-one** —— 任何对持久化集合的批量/批操作变更。
- **小步 CI 闸 PR** —— 多功能工作默认;仅当改动真正不可分割才打包。
- **前提核验** —— 每次评审代理(或人)递来一个会改变你计划的「事实」时。
- **砍而非接** —— 评审在实现中途揭出设计级问题时。

## 关联

- [[extension-http-client-testability-injection-seam-2026-06-15]] —— 本 doc 的「注入式依赖」实践的前身,覆盖 config/prompt/gossip/pending/auth 客户端的 `fetchFn` 注入缝;本次扩展到 `connection-test.ts`(extension)与 `llm.ts fetchWithBackoff`(backend),延续而非取代该模式。

## 相关文件

- `packages/extension/lib/connection-test.ts`(+ `.test.ts`)
- `packages/backend/src/services/llm.ts`(`fetchWithBackoff`、`parseRetryAfter`)
- `packages/extension/lib/batch.ts`(`releaseAllQuarantine`)
- `packages/extension/entrypoints/background.ts`(`handleReleaseQuarantineBatch`、`RELEASE_QUARANTINE_BATCH`)
</content>
</invoke>
