---
name: 前后端分离经验总结
description: Waves 1-3 实施中的经验教训和模式
type: feedback
updated: 2026-06-08
expires: never
platform: universal
---

# 前后端分离经验总结

## 架构模式
- **后端 Fastify** 路由按模块分散在 `src/*-routes.ts`，在 `index.ts` 统一 `register*Routes(server)`
- **文件 JSON 存储** 统一模式：`ensureDir()`、`safe filename replace(/[^a-zA-Z0-9_\-]/g, '_')`、`JSON.stringify(data, null, 2)`
- 所有扩展 fetch 调用使用 `authHeaders()` + `handleUnauthorized()` 模式：读取 `getToken()`，401 时 `clearToken()`
- 双写模式：`withBackendSync(localSave)` 闭包包装，`createdRemote` 标记防止重复创建批次

## 验证策略
- **3 层验证**：tsc type check → vitest unit test → curl QA endpoint smoke test
- curl QA 必须覆盖 POST → GET list → GET by id → PUT → DELETE → 404 verify 的完整生命周期

## 注意事项
- 扩展测试中 mock `auth-client` 的 getToken 以避免真实的 chrome API 调用
- 双写模式下后端失败不传播异常，用 try/catch + fail-closed 吞噬
- 创建 `FactsBlock[]` 到 `Record<string, unknown>[]` 的转换需要显式 cast（index signature 不兼容）
