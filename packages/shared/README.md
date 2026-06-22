# @51guapi/shared

吃瓜小帮手 (51guapi) monorepo 的**跨端共享内核**：纯类型 + 纯逻辑，被 `packages/backend` 与 `packages/extension` 共同依赖。无 DOM / chrome / Node 依赖（正则实现），在 service worker、jsdom、node 下都能跑。

## 为什么独立成包

把防幻觉、事实组装、grounding 校验、导出这些**安全关键逻辑**放在一处，两端复用同一份实现，避免双端漂移。

## 关键导出

| 模块 | 职责 |
| --- | --- |
| `post-assembler` | **防幻觉核心**：模型只产叙事散文，事实（當事人/時間/來源連結）由程序 verbatim 注入；`sanitizeToPlainText` 把模型散文里的标签/裸 URL 中和掉，`assembleGossipDraft` 保证 body 里的链接只来自 facts |
| `link-source` | **grounding 闸**：`verifyLinks` + `hasUnsourcedLink` 判定正文里每条 `<a href>` 是否来自输入事实，未注源即疑似幻觉 |
| `gossip-verify` | 抓取选题验证：grounding 重叠、有效性、时效窗（`isWithinWindow`）、内容指纹去重（`computeContentFingerprint`）。`now` 由调用方注入（本包禁用 `Date.now`，保可复现/浏览器安全） |
| `gossip-facts` | 吃瓜事实结构 `GossipFactsBlock`、`GOSSIP_FACT_KEYS`、`gossipFactUrls`（grounding 允许集来源） |
| `export` | JSON / Markdown / CSV 导出；`escapeCsv` 含公式注入防护（`= + - @` 前缀字符串前置单引号中和） |
| `gossip-theme` | 题材词表 `THEME_ALLOWLIST`、`parseThemes`、`normalizeCategory` |
| `quality-gate` | 内容质量门禁评估 |

## 约束

- **本包禁用 `Date.now` / `Math.random`**：时间/随机由调用方注入，保证纯函数可测、可复现、浏览器安全。
- **构建顺序**：本包须先 `pnpm --filter @51guapi/shared build` 出 `dist/`，backend/extension 才能对其类型检查。`pnpm -r compile` 已按拓扑序处理。

## 命令

```bash
pnpm --filter @51guapi/shared build      # tsc 出 dist/
pnpm --filter @51guapi/shared test       # vitest 单测
pnpm --filter @51guapi/shared coverage   # 带覆盖率(有非回退地板)
```
