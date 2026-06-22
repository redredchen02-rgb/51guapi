# 吃瓜小帮手

> **锁定 URL 爬取目标站资源 → AI 提炼成吃瓜草稿 → 人工预览/编辑 → 导出 JSON / Markdown**

Chrome 扩展 + 本地后端服务。操作者锁定爬取渠道（URL/域名），系统对其抓取内容，大模型负责写口吻散文，事实（作品名/集数/链接）由系统从抓取数据原样注入——模型碰不到事实，从流程上消灭编造。成品导出为 JSON / Markdown，自行取用，不再填入任何后台、不做发布。

---

## 核心设计原则

| 原则 | 实现方式 |
| --- | --- |
| **人工最终控制** | 草稿仅供预览/编辑/导出；不自动提交、不发布、不写回任何站点 |
| **防幻觉** | 模型只写口吻散文；作品名/集数/链接由程序从抓取事实原样注入，模型碰不到 |
| **fail-closed** | 爬取渠道走 SSRF allowlist，私有 IP 阻挡 + 输入层拒 IP literal，列表为空全拒不放行 |
| **正文不渲染 HTML** | 草稿正文以纯文本源码展示/编辑，不做 HTML 渲染（无 live XSS 面）；rewrite 模型产出在存储/导出前中和 |

---

## 快速开始

### 1. 安装依赖

```bash
git clone <仓库地址> && cd 51guapi
git config core.hooksPath scripts/git-hooks   # 启用脱敏 pre-commit hook
pnpm install
```

### 2. 配置并启动后端

```bash
cp packages/backend/.env.example packages/backend/.env
# 编辑 .env，填入 LLM_API_KEY、JWT_SECRET 等必填项
pnpm dev:backend
```

> 启动成功验证：`curl http://127.0.0.1:3002/api/v1/healthz` 返回 `{"status":"ok"}`

### 3. 构建并加载扩展

```bash
pnpm build:extension
```

Chrome → `chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选 `packages/extension/.output/chrome-mv3/`

### 4. 首次配置

侧边栏右上角「⚙ 设置」，填写 endpoint / 模型 / API key 后保存。能成功拉到模型列表，说明配置正确。

---

## 工作流

```
锁定爬取渠道(URL/域名)
      ↓
  对其 URL 发起爬取        ← 通用 adapter 抓取目标站资源
      ↓
  AI 提炼吃瓜草稿          ← 模型只写口吻散文
      ↓
 系统注入事实             ← 作品名/集数/链接原样填入，模型碰不到
      ↓
  侧边栏预览/编辑          ← 查看事实注入状态、来源标注
      ↓
  导出 JSON / Markdown
```

---

## 功能一览

### 基础功能
- 多渠道 URL 管理：操作者持续新增爬取渠道（域名动态进 SSRF allowlist）
- 锁定渠道后对其 URL 爬取，AI 提炼成吃瓜草稿（标题 + 简介 + 正文 + 标签）
- 待审选题池 + 侧边栏预览/编辑
- 导出 JSON / Markdown

### 审核保障
- 事实注入状态面板（每个字段标 ✓已注入 / —未提供）
- 来源标注（✓ 程序注入 / ✗ 非来源，异常即红标）
- 质量门禁：多维度评估（正文长度 / 事实完整性 / 标题无占位符 / 口语化口吻 / 标签数量）

### 高级功能
- **Telegram 告警**：抓取连续失败时自动推送通知

---

## 安全与边界

- **不发布、不写回**（硬约束）：成品只导出，绝不提交到任何站点
- **SSRF 守卫**：爬取渠道走 allowlist，私有 IP 阻挡 + 输入层拒 IP literal；新增渠道需人手确认手势，LLM/爬取管线无法自开渠道
- **防幻觉**：AI 只写口吻散文；作品名/集数/链接由程序 verbatim 注入，模型碰不到
- **API key 安全**：明文存本地，只在 background service worker 里使用，绝不进入页面上下文
- **正文不渲染 HTML**：草稿正文（LLM 产出）仅在 side panel 以纯文本源码展示/编辑，**不做 HTML 渲染**，故无 live XSS 面；rewrite 路径的模型产出在**存储/导出前**经 `sanitizeToPlainText`+`esc` 中和（剥除一切链接/标签）。**约束**：未来若新增正文 HTML 预览渲染（`dangerouslySetInnerHTML` 等），必须同步引入 DOMPurify 白名单消毒层

---

## 后端运维

### macOS 开机自动启动

```bash
pnpm build:backend
bash scripts/launchd/install.sh      # 注册 launchd daemon，开机自启
# 卸载：bash scripts/launchd/uninstall.sh
```

健康检查：`GET /api/v1/healthz`（无需鉴权）。

### Telegram 告警

在 `packages/backend/.env` 中配置：

```bash
TG_ENABLED=true
TG_BOT_TOKEN=<@BotFather 生成的 token>
TG_CHAT_ID=<你的 chat id>
```

---

## 项目结构

```
51guapi/
├── packages/
│   ├── extension/          # Chrome 扩展（WXT + React 19 + Manifest V3）
│   │   ├── entrypoints/
│   │   │   └── sidepanel/              # React UI：渠道/选题/草稿预览/导出/设置
│   │   └── lib/                        # 核心逻辑（提炼、导出、客户端…）
│   ├── backend/            # Fastify 5 + TypeScript，端口 3002
│   │   └── src/
│   │       ├── routes/                 # 按模块分文件的路由（gossip/pending/channels/prompt）
│   │       └── scraper/                # 爬取与提炼管线（SSRF 守卫 + 通用 adapter）
│   └── shared/             # 跨端共享类型与纯逻辑（@51guapi/shared）
└── docs/                   # 详细文档
```

---

## 常用命令

```bash
# 开发
pnpm dev:extension          # 扩展热更新
pnpm dev:backend            # 后端热更新

# 构建
pnpm build:extension        # 产出 packages/extension/.output/chrome-mv3/
pnpm build:backend          # 产出 packages/backend/dist/

# 测试与检查
pnpm test                   # 全包单元测试（vitest）
pnpm compile                # 全包 tsc 类型检查
pnpm lint                   # biome 格式化
bash scripts/check-all.sh   # 测试 + 双端构建 + 产物校验（提交前跑）
```

> **构建顺序**：`@51guapi/shared` 必须先 build 出 `dist/` 才能对 backend/extension 做类型检查；`pnpm -r compile` / `pnpm -r test` 已按拓扑序处理。

---

## 已知局限

- 仅支持 Chromium 内核浏览器，Firefox 不支持
- 导出格式 v0.1 仅 JSON / Markdown，CSV 延后
- 爬取依赖目标站结构，站点大改可能需调整通用 adapter
