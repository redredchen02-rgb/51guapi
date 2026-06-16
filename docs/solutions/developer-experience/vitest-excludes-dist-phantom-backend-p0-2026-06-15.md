---
title: '幻影 P0:vitest 排除 dist/** 使「后端 dist 测试缺依赖失败」不复现'
date: 2026-06-15
category: docs/solutions/developer-experience
module: packages/backend (vitest.config.ts) + TODOS.md
problem_type: developer_experience
component: test-infra
severity: low
applies_when:
  - TODOS/issue 报告「dist/ 下编译产物测试因缺依赖失败」
  - 要确认一个旧 P0 在当前 CI 是否仍真实
  - 评估 monorepo 测试收集范围(源码 vs 编译产物)
tags: [vitest, dist, monorepo, ci, phantom-bug, test-collection, backend]
---

# 幻影 P0:vitest 排除 dist/** 使「后端 dist 测试缺依赖失败」不复现

## Context

TODOS.md 长期挂着一条 P0:「`packages/backend/dist/` 下 8 个测试文件因缺依赖(fastify、better-sqlite3、@51publisher/shared)持续失败」。补强安全网时要据实确认它是否仍阻塞 CI。

## Guidance

先**实跑确认**,再决定是修还是关:

```bash
pnpm --filter publisher-backend test   # 注意包名是 publisher-backend,不是 @51publisher/backend
```

结果:275(后增至 299)passed,26 files,**无任何 dist 依赖失败**。根因在配置:

```ts
// packages/backend/vitest.config.ts
export default defineConfig({
  test: { exclude: ["dist/**", "node_modules/**"], /* ... */ },
});
```

vitest 只从 `src/` 收集 `*.test.ts`,**从不收集 `dist/` 下的编译产物 `*.test.js`**。CI 跑的是 `pnpm -r test`(源码 vitest),也不碰 dist。所以那条 P0 是**幻影**:dist 里的 `*.test.js` 只是旧 build 残留,从不进测试。据实关闭 TODO,而非投入修「依赖缺失」。

## Why This Matters

一个看似 P0 的阻塞项,可能因测试收集范围而**根本不在执行路径上**。不实跑就盲修(给 dist 装依赖、重配后端测试环境)是纯浪费。「报告的失败文件在 `dist/`」+「vitest 排除 dist」两条事实一对照,P0 当场蒸发。

## When to Apply

- 任何「编译产物/dist 下的测试失败」报告,先查 `vitest.config` 的 `exclude` 和 CI 实际跑的命令,确认这些文件是否真被收集。
- monorepo 里用对包名(`pnpm --filter <name>` 的 name 来自各包 package.json,易与 scope 名 `@scope/x` 混淆)。

## Examples

- 错误路径:照 TODOS 描述去给 `packages/backend/dist/` 配测试依赖(白做)。
- 正确路径:实跑 `pnpm --filter publisher-backend test` → 全绿 → 对照 `exclude: ["dist/**"]` → 关闭 P0 并记录根因。

## 关联
- 见 `docs/plans/2026-06-15-001-feat-harden-safety-net-plan.md` Unit 1 / R11。
- 同源:[[fixture-secret-gate-false-green-relative-path-2026-06-15]]、[[extension-http-client-testability-injection-seam-2026-06-15]]。
