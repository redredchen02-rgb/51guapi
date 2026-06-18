---
title: 'extension HTTP 客户端可测性:死参 _fetchFn 与 fetchWithTimeout 注入缝'
date: 2026-06-15
category: docs/solutions/developer-experience
module: packages/extension/lib/*-client.ts (config/prompt/gossip/pending/auth-client)
problem_type: developer_experience
component: extension-http-clients
severity: medium
applies_when:
  - 给 extension 的后端 HTTP 客户端(*-client.ts)补单测
  - 客户端内部走 @51guapi/shared 的 fetchWithTimeout 而非裸 fetch
  - 看到形如 `_fetchFn: typeof fetch = fetch` 的参数,想注入 mock
tags: [testing, dependency-injection, fetch, mock, fetchWithTimeout, wxt, vitest, extension]
---

# extension HTTP 客户端可测性:死参 _fetchFn 与 fetchWithTimeout 注入缝

## Context

要为 4 个无测的后端客户端(config/prompt/gossip-client + auth-client)补 mock 单测。计划原以为「加个 `fetchFn` 默认参数即可、零改动」。实测发现注入缝并不像看上去那样存在。

## Guidance

各客户端的真实注入状态(2026-06-15 核实):

| 客户端 | 注入缝状态 | 测试做法 |
|---|---|---|
| `config-client.ts` | ✅ 真接受并使用 `fetchFn: typeof fetch = fetch` | 直接注入 `mockFetch().fn` |
| `pending-client.ts`(**模板**) | ✅ `fetchFn?` 可选 + 混合 `fetchFn ? await fetchFn(...) : await fetchWithTimeout(...)` | 同上 |
| `prompt-client.ts` | ⚠️ 有 `_fetchFn`(下划线=**死参**),函数体仍调 `fetchWithTimeout` | 需先**接通**:改名 `fetchFn` 并接入混合写法 |
| `gossip-client.ts` | ⚠️ **无**注入参数,全调 `fetchWithTimeout` | 需**新增**可选 `fetchFn?` + 混合写法 |

接通注入缝的标准写法(仿 pending-client,签名兼容、生产路径不变):

```ts
export async function fetchX(
  // ...domain params...
  fetchFn?: typeof fetch,            // 可选、置尾,默认 undefined
): Promise<...> {
  const res = fetchFn
    ? await fetchFn(url, { headers })                     // 测试注入路径
    : await fetchWithTimeout(url, { headers, timeoutMs }); // 生产路径(保留 timeout)
  // ...
}
```

测试用 `pending-client.test.ts` 为模板:`import { fakeBrowser } from "wxt/testing"` + `beforeEach(fakeBrowser.reset)`,`mockFetch` 返回 `{capturedUrls, fn}`,断言 URL/Bearer 头/解析结果/401→clearToken。**加一个 integration 断言** `expect(mockFn).toHaveBeenCalledOnce()` 证明注入缝真接通(防止又写出一个死参)。

## Why This Matters

`_fetchFn`(下划线前缀)是「声明了但故意不用」的信号——注入它**不会拦截请求**,测试会以为在测客户端、实际打了真 fetchWithTimeout(或被 wxt 环境拦),要么误绿要么误红。同理,客户端走 `fetchWithTimeout`(来自 shared)而非裸 `fetch` 时,`vi.stubGlobal("fetch", ...)` 也拦不到——必须走参数注入,或 `vi.mock("@51guapi/shared")`。

## When to Apply

- 给任何 `*-client.ts` 补测前,先读源码确认:它调 `fetch` 还是 `fetchWithTimeout`?参数是 `fetchFn`(真用)还是 `_fetchFn`(死参)?
- 接通注入缝属**改源码的小重构**(非零改动),保留默认参数即可保证 `background.ts` 等既有调用点签名兼容、生产仍走 timeout 路径。

## Examples

- 死参接通:`prompt-client.ts` 把 `_fetchFn` → `fetchFn` 并接入混合写法。
- 新增缝:`gossip-client.ts` 5 个函数各加 `fetchFn?` 末参。
- 反例(别学):`pending-client.test.ts` 自身有重复的 test body 段——复制其结构,勿复制重复。

## 关联
- 落地见 `docs/plans/2026-06-15-001-feat-harden-safety-net-plan.md` Unit 7。
- 同源:[[fixture-secret-gate-false-green-relative-path-2026-06-15]]、[[vitest-excludes-dist-phantom-backend-p0-2026-06-15]]。
- 延伸:[[incremental-pr-adversarial-verification-2026-06-15]] 把本注入缝模式扩展到 `connection-test.ts` 与后端 `fetchWithBackoff`,并归纳 Theme E 的整套交付实践。
