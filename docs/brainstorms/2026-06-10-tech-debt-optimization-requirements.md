---
date: 2026-06-10
topic: tech-debt-optimization
---

# 技术债全面优化计划（修订版）

## Summary

对 51publisher codebase 的执行现有 7 维度优化计划的修订版本——在已实现 50–60% 的基础上，完成剩余的 TypeBox 接入、Rate Limit 启用、CORS 收窄、错误标准化、Loading states、CSS Modules、结构化日志、Config 持久化等工作。预计工作量约 3–4 天。

---

## Problem Frame

2026-06-09 产出的全面优化计划涵盖 5 个 Phase（A–E），但自其撰写以来，Plans 001+002（自动抓取管线 + 能力全面升级）已完全实现并提交，期间多个优化项也同步落地：`packages/shared/` 已建并可 build、Biome 已配置、CI pipeline 完整（含 shared build + type check + test + fixture check）、pre-commit 已设、Error Boundary 存在、CSS 变量体系就位、TypeBox/Rate Limit/Coverage 依赖已装、SQLite migration 系统存在。原计划大约 50–60% 的工作量已经是既成事实。

剩余部分的共同点是「依赖就位但尚未接入」——TypeBox 的包装了但路由没连、Rate Limit 装了但 server 没注册、Loading.tsx 存在但未连接数据加载点。这些是典型的「最后 20% 集成」工作，每项独立且不相互阻塞。

---

## Requirements

**[Phase A：基础设施扫尾]**

- R1. 关键路由接入 TypeBox type provider：`POST /api/v1/auth/login`、`POST /api/v1/pending/generate`、`POST /api/v1/pending/:id/approve`，至少包含请求体验证（body schema）、可选的响应 schema。
- R2. Rate Limit 启用：server 级全局限制（100 req/min/IP）+ 严格路由（auth/login 5 req/min、pending/generate 20 req/min）。
- R3. CORS 收窄：读取 `process.env.CORS_ORIGIN`，dev 保持 `origin: '*'`，生产环境限制到扩展 origin 或目标域名。`.env.example` 更新说明。
- R4. 错误格式标准化：`error-response.ts` 定义的格式在所有路由中一致采用；Fastify `setErrorHandler` 统一格式化 400/401/404/500 的输出。

**[Phase C：前端 UI 品质]**

- R5. ErrorBoundary 实际包裹 App.tsx 最外层 + 各独立面板（BatchView、PendingTopicsView、HistoryPanel）。
- R6. Loading.tsx 接入所有主要数据加载点：PendingTopicsView 首次加载、BatchView 列表、HistoryPanel。
- R7. CSS Modules 迁移（优先级：Settings.tsx → BatchView.tsx → PendingTopicsView.tsx），建立共用 `variables.css` 的 CSS 变量引用。
- R8. App.tsx 清理：移除空 `CSSProperties` 声明、整理 import、确认 key props。

**[Phase E：运维安全]**

- R9. Extension 端 logger 抽象：`lib/logger.ts`，提供 `info()` / `error()` / `warn()`，统一格式 `[51publisher] [level] message {context}`，开发环境输出 console，生产可静默。
- R10. Config routes 持久化：将 `config-store.ts` 的 site/scraper mappings 从内存写入 `pending-db.sqlite` 的 config 表（或独立 config.json），启动时读取，写入时双写。

---

## Success Criteria

- TypeBox: 3 个关键路由收到无效 body 时返回 400 + 描述性错误消息，不再抛出 generic 500。
- Rate Limit: `curl -X POST http://localhost:3001/api/v1/auth/login` 连续 6 次后第 6 次返回 429。
- CORS: 非白名单 origin 的请求被拒绝；dev 保持可访问。
- ErrorBoundary: 在 Settings 或 BatchView 内 `throw new Error()` 后不白屏，显示 fallback UI 和重试按钮。
- Loading states: PendingTopicsView 在数据返回前显示灰色 skeleton，不闪烁空白。
- CSS Modules: Settings.tsx 中无 `style={{ }}` 内联对象，全量引用 `.module.css`。
- Logger: `logger.info('batch', { id })` 输出 `[51publisher] [info] batch {id: ...}`。
- Config 持久化：重启后端后 `GET /api/v1/config/scraper-mapping` 返回重启前设置的值。

---

## Scope Boundaries

- **不做** JWT refresh token（单人运营，7d access token 够用。
- **不做** 全量 TypeBox（只对关键路由加，不强求 100% 覆盖）。
- **不做** Biome 一键全量 format（只在修改的文件上应用）。
- **不做** CSS Modules 迁移所有组件（只覆盖 Settings.tsx / BatchView.tsx / PendingTopicsView.tsx）。
- **不做** Extension 日志存储到后端（只 console，后续需要再加发送）。
- **不做** Docker 化 / CI/CD 平台迁移 / 新框架替换。

---

## Key Decisions

- **执行顺序 A → C → E**：基础设施先行（TypeBox/Rate Limit/CORS/错误标准化），因这些改动会改变 API 契约，应先落地再添加基于它们的测试。
- **CSS Modules 不全覆盖**：三个最复杂的组件迁移即可，小型单一用途组件保留 inline styles（无抽象成本）。
- **Config 持久化用 SQLite 而非独立文件**：复用已有的 `pending-db.sqlite`，不引入额外存储文件。与 Phase B 的 migration 系统一致（原计划 B1 已实现）。
- **Loading 不引入 skeleton 库**：用现有的 `Loading.tsx` 组件（灰色条块模拟），不额外安装依赖。

---

## Dependencies / Assumptions

- 当前 `packages/shared/` 的构建产物可能不是最新（如果 shared 源码有改动需先 build）。
- TypeBox schema 定义需读后端现有路由 handler 确认输入类型（buildPrompt、login 等的实际参数结构）。
- CORS 更改需与部署方确认 Chrome extension 的实际 origin（`chrome-extension://<id>`）。
- CSS Modules 迁移中 WXT/Vite 已原生支持 `.module.css`——假设无需额外配置。

---

## Outstanding Questions

### Resolve Before Planning

（无——所有问题已在本轮对话中确认。）

### Deferred to Planning

- [Affects R1][Technical] TypeBox schema 定义：`POST /api/v1/pending/generate` 和 `POST /api/v1/pending/:id/approve` 的具体请求体结构——规划时读 handler 确认。
- [Affects R8][Technical] App.tsx 中当前有多少空 `CSSProperties` 声明——规划时 grep 确认后再估算。
- [Affects R10][Technical] `pending-db.sqlite` 中是否已有 config 表——规划时检查 migration 001 的 schema。
