# 安装与使用指南

51guapi 由两部分组成:一个 **Chrome 扩展**（生成草稿 + 填充表单）和一个**本地后端服务**（持久化批次、抓取选题、健康监控）。

> 🛡️ **防幻觉核心**:模型**只负责写口吻散文**;作品名、集数、连结等事实由**系统从你提供的事实里原样填入正文,模型碰不到**——从流程上让它没机会编造连结或作品事实。

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

> **代码有更新时**：重新 `pnpm build:extension`，再到 `chrome://extensions` 点该扩展的 **↻ 刷新**，并刷新目标后台页。

---

## 五、首次配置（⚙ 设置）

打开侧边栏 → 右上角「**⚙ 设置**」，依次填写：

| 项 | 填法 |
| --- | --- |
| **LLM endpoint** | 填 `https://la-sealion.inaiai.com/v1`，系统会自动补 `/chat/completions`。 |
| **API key** | 你在 la-sealion 平台的 API Key。⚠️ 明文存于本地浏览器，并随请求发往 endpoint——**只配可信地址**。 |
| **模型** | 填好上面两项后，点「**↻ 拉取模型列表**」→ 下拉选择 `gemma4-31b-heretic`；拉不到也可直接手填模型名。 |
| **后端 URL** | 本地后端地址，默认 `http://127.0.0.1:3002`。 |
| **Prompt 模板** | 已内置「51娘 + 只写口吻散文」契约，通常无需改。 |
| **Few-shot 范例** | 已内置脱敏范例；可改，但**别写真实连结**（会随请求外发）。 |
| **字段映射** | 默认值来自现场勘查，后台改版时才需按指南更新。 |

点「**保存**」。能成功拉到模型列表，说明 endpoint / key 都正确。

---

## 六、使用流程

### 单条流程

1. 在 51guapi 后台打开「添加帖子」表单。
2. 侧边栏输入主题 →「**生成草稿**」。
3. 预览区核对/修改草稿内容。
4. 「**填充到当前页**」→ 看「填充结果」面板：绿=已填 / 黄=跳过 / 红=需手动。
5. 若正文显示「需手动」，点「复制正文」自行粘贴。
6. **人工在后台核对后手动点发布。**

### 批量流程（推荐）

点击侧边栏右上角 **≣ 批量** 进入批量视图：

**第一步：输入选题 + 事实**

每行一条，格式：`选题 || 字段=值 | 字段=值`

```
住在拔作島上的我該如何是好成人動畫介紹 || 作品名=住在拔作島上的我該如何是好 | 集数=2期 | 漢化=https://… | 無修=https://…
精靈寶可夢同人推薦 || 作品名=精靈寶可夢 | 题材=同人本 | 简介=莉莉艾/瑪俐/奇樹
某新番(只写选题也行，缺的事实 AI 会标【待补】，不会编造)
```

支持字段：`作品名` / `集数` / `制作` / `漢化` / `無修` / `题材` / `简介`（及别名 `name` / `ep` / `tags` / `desc` 等）。

**第二步：生成 + 审核**

点「**开始批量（生成+填充）**」。展开每条草稿，看审核卡：

- **事实注入状态**：每个字段标 ✓已注入 / —未提供，一眼看缺口。
- **连结**：每条连结标「✓ 程序注入（不可编造）」；出现「✗ 非来源」即异常，务必核实。
- **发布前硬闸**：标题缺作品名 / 正文残留【待补】 / 无来源连结 → 拦截，需补全后再发。

**第三步：选发布档位（在 ⚙ 设置里切）**

| 档位 | 行为 |
| --- | --- |
| `off` | **只填充，不发布**（最安全，默认）。需人工去后台手动点发布。 |
| `dry-run` | 预演：走完整流程但**不真发**，产出 DryRunReport。 |
| `authorized` | **真实发布**（仅当目标页在授权站点）。批准时需输入 `publish` 手势确认。 |

> ⚠️ **authorized 真发后无法自动撤回**。强烈建议先 `dry-run` 预演，首次真发把后台状态设「隐藏」，核对无误再显示。

**第四步：批准**

切到 `dry-run` 或 `authorized` → 批准前自动做**选择器漂移自检**（后台改版会被挡下）→ 通过后批准。

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

抓取连续失败或帖子健康监控异常时，自动推送 Telegram 通知。

---

## 八、安全边界

- **不自动提交/发布**（硬约束）：除非显式切到 `authorized` 并打字确认；第三方平台一律只填充。
- **防幻觉**：AI 只写口吻散文；作品名/集数/连结由程序从你的事实 verbatim 注入，模型碰不到。`authorized` 发布前有硬闸（残留【待补】或无来源连结即拦截）。
- **API key 安全**：明文存本地，只在 background service worker 里使用，绝不进入页面上下文。请只配置可信 endpoint，建议用权限受限的专用 key。
- **XSS 防护**：LLM 返回的 HTML 写入编辑器前，在隔离世界按白名单消毒（剥除 `<script>`/事件处理器等）。

---

## 九、常见问题

| 现象 | 原因 / 解法 |
| --- | --- |
| 「拉取模型列表」报网络错 | endpoint 写错；或该域名未在 `wxt.config.ts` 的 `host_permissions` 里，需加入后重新 `build:extension`。 |
| 生成偶发失败但拉模型正常 | 端点不支持 `json_schema` 响应格式；系统会自动降级为 `json_object` 重试，仍失败则重试或恢复默认 Prompt。 |
| 生成报「未返回合法 JSON」 | 模型不稳或 prompt 被改坏；重试或点「恢复默认」。 |
| 草稿连结被红标 ✗ | AI 编造了不在你输入里的 URL，**别发**，改用你的真连结或留【待补】。 |
| 正文显示「需手动」 | 极端情况 Quill 不可用，走兜底写入；点「复制正文」手动粘贴。 |
| 后端启动报「fail-closed」 | `CORS_ORIGIN` 未填或填了 `*`；`JWT_SECRET` 是占位值。按第三步重新生成。 |
| 后台改版后填充错位 | 选择器漂移；轻则改「⚙ 设置 → 字段映射」，重则需改代码，见 [`docs/field-mapping-guide.md`](field-mapping-guide.md)。 |
| 改了 content script 后无效 | 须到 `chrome://extensions` 点 **↻ 刷新**，并刷新目标后台页；旧脚本否则仍驻留。 |

---

更多文档：
- 批量细节 → [`docs/batch-usage-guide.md`](batch-usage-guide.md)
- Dry-run 策略 → [`docs/dry-run-strategy.md`](dry-run-strategy.md)
- 字段映射指南 → [`docs/field-mapping-guide.md`](field-mapping-guide.md)
- 自动生成选题 → [`docs/auto-generate-guide.md`](auto-generate-guide.md)
