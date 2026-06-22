# 安装与使用指南

51guapi 由两部分组成:一个 **Chrome 扩展**（侧边栏审稿、编辑、导出）和一个**本地后端服务**（抓取 URL、提炼事实、生成草稿、维护待审池）。

> 🛡️ **产品边界**:只爬取 URL → AI 提炼吃瓜事实 → 人工预览/编辑 → 导出 JSON / Markdown。不填充第三方后台、不自动发布、不写回任何站点。

---

## 一、环境要求

| 项目 | 要求 |
| --- | --- |
| 浏览器 | **Chromium 内核**(Chrome / Edge 等)——Firefox 不支持 |
| Node.js | ≥ 20 |
| 包管理器 | **pnpm**（`npm i -g pnpm`） |
| 操作系统 | macOS / Linux（Windows 未测试） |

---

## 二、克隆与安装依赖

```bash
git clone <仓库地址>
cd 51guapi

# 首次克隆后启用脱敏 pre-commit hook（只需一次）
git config core.hooksPath scripts/git-hooks

pnpm install
```

---

## 三、启动后端服务

### 3-1 创建 .env

```bash
cp packages/backend/.env.example packages/backend/.env
```

用编辑器打开 `packages/backend/.env`，必填项如下：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `LLM_ENDPOINT` | LLM 服务地址（到 `/v1`） | `https://la-sealion.inaiai.com/v1` |
| `LLM_API_KEY` | 你在 la-sealion 平台的 API Key | `sk-...` |
| `CORS_ORIGIN` | 扩展的 `chrome-extension://` ID（见下方说明） | `chrome-extension://abcdef...` |
| `JWT_SECRET` | 随机强密钥（≥32 字符） | 见下方生成命令 |

> 自用模式：登入免密，无需 `JWT_ADMIN_PASSWORD_HASH`。

**生成强密钥（在终端运行）：**

```bash
# 生成 JWT_SECRET
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

> **`CORS_ORIGIN` 怎么找？** 先跳到第四步构建并加载扩展，然后打开 `chrome://extensions`，找到 51guapi 扩展，复制 ID（格式如 `abcdef123456`），填入 `chrome-extension://abcdef123456`。多个 ID 用逗号分隔。

### 3-2 启动

```bash
# 开发模式（热更新）
pnpm dev:backend

# 或生产构建后启动
pnpm build:backend
node packages/backend/dist/index.js
```

启动成功后，终端显示：

```
Server listening at http://127.0.0.1:3002
```

验证：`curl http://127.0.0.1:3002/api/v1/healthz` 应返回 `{"status":"ok",...}`。

### 3-3 macOS 开机自动启动（可选）

```bash
# 先把 .env 放到专用安全目录（权限收紧）
mkdir -p ~/.51guapi
cp packages/backend/.env ~/.51guapi/.env
chmod 600 ~/.51guapi/.env

# 注册 launchd daemon（开机自启）
bash scripts/launchd/install.sh

# 卸载
bash scripts/launchd/uninstall.sh
```

日志写入 `/tmp/51guapi-backend.log`。

---

## 四、构建并加载 Chrome 扩展

```bash
# 构建扩展（产出 packages/extension/.output/chrome-mv3/）
pnpm build:extension
```

然后在 Chrome：

1. 打开 `chrome://extensions`，右上角开启**开发者模式**。
2. 点「**加载已解压的扩展程序**」，选择 `packages/extension/.output/chrome-mv3/` 目录。
3. 点工具栏的扩展图标 → 打开 **侧边栏（side panel）**。

> **代码有更新时**：重新 `pnpm build:extension`，再到 `chrome://extensions` 点该扩展的 **↻ 刷新**，然后重新打开侧边栏。

---

## 五、首次配置（⚙ 设置）

打开侧边栏 → 右上角「**⚙ 设置**」，依次填写：

| 项 | 填法 |
| --- | --- |
| **LLM endpoint** | 与 `packages/backend/.env` 的 `LLM_ENDPOINT` 保持一致；API Key 只在后端 `.env` 的 `LLM_API_KEY` 中配置，扩展不保存密钥。 |
| **模型** | 填 `gemma4-31b-heretic`；如果供应商换模型，只改模型名，不在扩展里填写密钥。 |
| **后端 URL** | 本地后端地址，默认 `http://127.0.0.1:3002`。 |
| **Prompt 模板** | 已内置「51娘 + 只写口吻散文」契约，通常无需改。 |
| **Few-shot 范例** | 已内置脱敏范例；可改，但**别写真实连结**（会随请求外发）。 |
点「**保存**」。能成功生成一条草稿，说明后端 endpoint / key / model 都正确。

---

## 六、使用流程

### A. 添加抓取站点

1. 侧边栏点「吃瓜站点」。
2. 添加站点名称与 `https://` 列表 URL。
3. 后端会按 SSRF allowlist / channels 配置 fail-closed 校验；不在白名单内的目标不会被抓取。

### B. 抓取并进入待审池

1. 在「吃瓜站点」页发现文章并生成入池，或等待后端抓取任务入池。
2. 展开选题，核对并编辑结构化 facts。
3. 点「确认核对（进题材池）」后，当前编辑过的 facts 会先保存到后端，再进入题材池。

### C. 生成草稿

1. 在待审池勾选一条，点「批准并生成草稿」；或点「今日一键备稿」取最高分选题。
2. 生成请求会把 `facts` 与 `enrichment` 一起传给后端，草稿预览会保留本次 facts。
3. 在预览区继续人工编辑标题、摘要、正文、标签。

### D. 导出

在草稿预览下方选择：

- **导出 JSON**：包含 `draft` 与 `gossipFacts`，适合后续自动化/归档。
- **导出 Markdown**：适合人工发布到其他工具或做审稿记录。
- **复制 Markdown**：复制到剪贴板。

---

## 七、可选功能

### 自动抓取选题（待审选题池）

抓取站点经 `scraperConfig.addSiteConfig` 配置（详情页或列表发现模式），站点 host 须在 `ALLOWED_HOSTS` 内（fail-closed）。在 `packages/backend/.env` 里设置：

```bash
LLM_ENDPOINT=...           # scheduler 仅在 LLM_ENDPOINT + LLM_API_KEY 齐全时启动
LLM_API_KEY=...
ALLOWED_HOSTS=https://your-target-site.com
# SCRAPER_LIST_BUDGET=20   # 列表发现模式下每轮 cron 最多处理的新 URL 数（默认 20）
```

抓取结果进入「待审选题池」，可在侧边栏预览/编辑。

### Telegram 告警

```bash
TG_ENABLED=true
TG_BOT_TOKEN=<@BotFather 生成的 token>
TG_CHAT_ID=<你的 chat id>
```

抓取连续失败或后端任务异常时，自动推送 Telegram 通知。

---

## 八、安全边界

- **不自动提交/发布**（硬约束）：扩展不注入第三方站点，不填表，不点发布，不写回任何站点。
- **防幻觉**：生成草稿时同时传入结构化 facts 与 enrichment；导出 JSON / Markdown 会保留人工核对后的 facts。
- **API key 安全**：LLM key 只存 `packages/backend/.env`，扩展不保存、不发送、不展示密钥。
- **正文不渲染 HTML**：草稿正文以纯文本展示/编辑，不做 HTML 渲染（无 live XSS 面）；rewrite 模型产出在导出前中和。未来若新增正文 HTML 渲染须同步引入 DOMPurify。

---

## 九、常见问题

| 现象 | 原因 / 解法 |
| --- | --- |
| 「拉取模型列表」报网络错 | endpoint 写错；或该域名未在 `wxt.config.ts` 的 `host_permissions` 里，需加入后重新 `build:extension`。 |
| 生成偶发失败但拉模型正常 | 端点不支持 `json_schema` 响应格式；系统会自动降级为 `json_object` 重试，仍失败则重试或恢复默认 Prompt。 |
| 生成报「未返回合法 JSON」 | 模型不稳或 prompt 被改坏；重试或点「恢复默认」。 |
| 待审池为空 | 先在「吃瓜站点」添加站点，发现文章并生成入池；或确认后端 LLM 与抓取目标白名单已配置。 |
| 生成草稿后导出缺 facts | 从「待审核选题」流程生成会带 facts；手动输入主题生成的草稿没有结构化 facts，导出中 `gossipFacts` 会是 `null`。 |
| 后端启动报「fail-closed」 | `CORS_ORIGIN` 未填或填了 `*`；`JWT_SECRET` 是占位值。按第三步重新生成。 |
| 扩展重装后后端 401/CORS 失败 | 到 `chrome://extensions` 复制扩展 ID，更新 `.env` 的 `CORS_ORIGIN=chrome-extension://<id>` 后重启后端。 |

---

更多文档：
- 运营手册 → [`docs/ops-runbook.md`](ops-runbook.md)
- 旧版自动生成接口历史记录 → [`docs/auto-generate-guide.md`](auto-generate-guide.md)
