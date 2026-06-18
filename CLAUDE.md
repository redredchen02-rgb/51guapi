# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

吃瓜小帮手 (51guapi):锁定 URL 爬取目标站资源 → AI 提炼成吃瓜草稿 → 人工预览/编辑 → 导出 JSON / Markdown。**只爬取 + 提炼 + 导出,不发布、不写回任何站点。** pnpm monorepo,三个包:

- `packages/extension/` — Chrome 扩展(WXT + React 19 + Manifest V3),仅支持 Chromium
- `packages/backend/` — Fastify 5 + TypeScript,端口 3001(JWT 鉴权、多渠道爬取/提炼管线、SSRF 守卫)
- `packages/shared/` — 跨端共享类型与纯逻辑(`@51guapi/shared`:facts、vocab、export 等)

仓库 remote 是 **GitHub**(github.com/redredchen02-rgb/51guapi);活跃 CI 是 `.github/workflows/`(`ci.yml` push/PR 真闸、`release.yml` `v*` tag)。根目录无 `.gitlab-ci.yml`。`scripts/check-all.sh` 存在(lint:ci + 测试 + 双端 build + 产物校验)。

会话开始时读 `.ai-memory/*.md` 获取前序会话的项目状态与经验(见 AGENTS.md)。

## 常用命令

```bash
pnpm install                      # 安装依赖
git config core.hooksPath scripts/git-hooks   # 一次性:启用 pre-commit/pre-push hook(clone 后不会自动生效)

pnpm dev:extension                # 扩展开发(热更新);dev:backend 同理
pnpm build:extension              # 产出 packages/extension/.output/chrome-mv3/
pnpm compile                      # 全包 tsc 类型检查(拓扑顺序,shared 先 emit dist)
pnpm test                         # 全包单测(vitest)
pnpm lint                         # biome check --write;CI 用 pnpm lint:ci
bash scripts/check-all.sh         # 测试 + 双端构建 + 产物校验
```

扩展专属(在 `packages/extension/` 下或加 `--filter 51guapi-extension`):

```bash
pnpm check:fixtures               # 脱敏闸门:扫 fixture 是否夹带机密(pre-commit 自动跑)
npx vitest run lib/export.test.ts             # 跑单个测试文件
npx vitest run -t "测试名"                     # 按名称过滤
```

**构建顺序**:`@51guapi/shared` 必须先 build 出 `dist/` 才能对 backend/extension 做类型检查。`pnpm -r compile` / `pnpm -r test` 已按拓扑序处理;单独操作某包前若报 shared 类型缺失,先 `pnpm --filter @51guapi/shared build`。

后端环境:复制 `packages/backend/.env.example` → `.env`。后端 **fail-closed**:`CORS_ORIGIN` 缺失或为 `*`、`JWT_SECRET`/`JWT_ADMIN_PASSWORD_HASH` 弱值/占位值时拒绝启动。生成强值的命令见 AGENTS.md 或 `.env.example` 注释。

## 架构

### 扩展

- `entrypoints/background.ts` — service worker,调度中心。路由 `GENERATE_DRAFT`(调 LLM 提炼,API key 只在此处)、读取/导出相关消息;**无任何发布/填充/注入逻辑**
- `entrypoints/sidepanel/` — React UI:渠道管理、待审选题、草稿预览/编辑、导出(JSON / Markdown)、设置

### 安全与防幻觉(改动前必读)

- **不发布、不写回**(硬约束):成品只导出,绝不提交/写入任何站点
- **SSRF 守卫**:爬取渠道走 `src/scraper/ssrf-guard.ts` 的 allowlist(fail-closed,列表为空全拒)+ 私有 IP 阻挡 + 输入层拒 IP literal。新增渠道需人手确认手势,爬取管线/LLM 自身不可触发 allowlist 写入(防 prompt 注入自开渠道)
- **防幻觉**:模型只写口吻散文槽位;作品名/集数/链接由系统从抓取事实 verbatim 注入,模型碰不到
- **正文 HTML 处理**:草稿正文(`draft.body`,LLM 产出)目前仅在 side panel 的 `<textarea>` 以纯文本源码展示/编辑,**不做 HTML 渲染**,故无 live XSS 面。**约束**:未来若新增正文 HTML 预览渲染(`dangerouslySetInnerHTML` 等),必须同步引入白名单消毒层(如 DOMPurify),否则即引入存储型 XSS

### 后端

- 路由按模块分文件 `src/routes/*-routes.ts`,在 `index.ts` 统一 `register*Routes(server)`;JWT 鉴权 preHandler,`PUBLIC_ROUTES` 白名单放行
- 存储:pending/config 用 SQLite(better-sqlite3),读 `GUAPI_DATA_DIR`(旧名 `PUBLISHER_DATA_DIR` 仍兼容 fallback,解析见 `src/config/data-dir.ts`);vitest 经 `src/test-setup.ts` 指向临时目录,测试不碰真实 `data/`
- `src/scraper/` — 爬取与提炼管线:通用 adapter(`adapters/generic-adapter.ts`)、SSRF 守卫(`ssrf-guard.ts` + 可配置 allowlist)、`gossip-fact-extractor.ts` 提炼事实、`pending-store.ts` 入待审池
- 数据流:URL → `generic-adapter.fetchContent()` → `gossipExtractFacts()` → `pending-store`(SQLite,`domain='gossip'`)→ 扩展经 `/api/v1/gossip/*` 读回
- 扩展对后端的调用统一走 `authHeaders()` + 401 时 `clearToken()` 模式

## 迭代节奏

```
改代码 → pnpm test → pnpm compile → 全绿才提交
```

## 仓库约定

- 实施计划放 `docs/plans/`,命名 `YYYY-MM-DD-NNN-<type>-<slug>-plan.md`;已解决问题沉淀到 `docs/solutions/`
- 代码注释与文档用中文,commit message 用英文
- Lint/format 用 biome(tab 缩进、双引号);扩展包内另有 prettier 的 `format` 脚本,以根目录 biome 为准
