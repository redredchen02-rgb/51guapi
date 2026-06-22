# 运营手册(ops-runbook)

单操作者日常运营 51guapi 的唯一参考。不依赖聊天记录。
**脱敏约束:本文档不得出现任何真实凭证/token/hash,只引用 `.env` 变量名与生成命令。**

## 1. 后端启停

```bash
bash scripts/start-backend.sh        # 构建新鲜度检查 → 启动 → 轮询 /api/v1/healthz 直到 200
```

- 停止:前台运行直接 Ctrl+C;后台运行 `pkill -f "node dist/index.js"`
- 启动失败先看终端输出:**fail-closed 拒启**多为 `.env` 弱值/缺值(`CORS_ORIGIN`、`JWT_SECRET`),按提示修复(自用模式免密登入,无 `JWT_ADMIN_PASSWORD_HASH`)
- 健康检查:`curl http://localhost:3002/api/v1/healthz`

## 2. 每日操作

前置:后端已启动;扩展侧边栏已登录;`.env` 已配置 LLM 与抓取目标白名单 / channels。

1. 「吃瓜站点」页确认抓取站点配置正确。
2. 「吃瓜站点」页发现文章并生成入池，或等待定时抓取入池。
3. 展开选题,核对并编辑 facts;确认无误后点「确认核对（进题材池）」。
4. 勾选一条后点「批准并生成草稿」,或点「今日一键备稿」取最高分选题。
5. 在草稿预览页继续编辑,然后导出 JSON / Markdown。
6. 导出的内容如需发布到外部站点,由操作者在仓库外手动处理;本系统不填表、不提交、不写回。

## 3. 备份与恢复

- **节奏**:每周一次 + 每次重要导出后加一次
- **位置**:`~/51guapi-backups/`(仓库外;不入云同步盘;不包含 `.env`)
- **方法**(data/ 含 SQLite,禁止热拷贝):

```bash
# 先停后端,再:
cp -R packages/backend/data ~/51guapi-backups/data-$(date +%Y%m%d)
# 或不停后端,对 SQLite(pending.db / app.db,WAL 模式)用在线备份:
sqlite3 packages/backend/data/pending.db ".backup '$HOME/51guapi-backups/pending-$(date +%Y%m%d).db'"
sqlite3 packages/backend/data/app.db ".backup '$HOME/51guapi-backups/app-$(date +%Y%m%d).db'"
```

- **保留**:最近 4 份,更旧删除
- **恢复演练(上线前做一次)**:备份 → 移走 data/ → 从备份恢复 → 启动后端 → 待审池、站点配置、导出前草稿数据可见即通过

## 4. 凭证管理

- 全部凭证只存 `packages/backend/.env`(不入库)
- 自用模式:登入免密,无 `JWT_ADMIN_PASSWORD_HASH`
- 强 `JWT_SECRET` 生成命令见 `.env.example` 注释
- **轮换后验证两步**:后端能启动 → 旧 token 调受保护路由返回 401(换 `JWT_SECRET` 后旧 token 失效)
- LLM key 轮换:提供商控制台吊销旧 key 并确认旧 key 401;新 key 注意只有 `gemma4-*-heretic` 系模型可用,换后先跑一条草稿验证

## 5. 常见故障与恢复

| 症状 | 处理 |
|------|------|
| 扩展提示 401/登录失效 | 侧边栏重新登录(JWT 24h 过期属正常);若刚轮换过 `JWT_SECRET`,先清本地 token 再登录 |
| 后端连不上 | `curl /api/v1/healthz`;不通则按 §1 重启;扩展在后端不可达时自动降级为本地状态(fail-closed),数据不丢 |
| 扩展重装/换目录后后端拒绝请求(CORS) | 扩展 ID 变了:chrome://extensions 复制新 ID,更新 `.env` 的 `CORS_ORIGIN`(逗号分隔可放多个 `chrome-extension://<id>`),重启后端。**禁止放宽为 `*`**(后端会拒启) |
| 吃瓜站点抓取/生成失败 | 确认站点 URL 是 `https://`;host 已在 channels / `ALLOWED_HOSTS` 白名单;LLM_ENDPOINT / LLM_API_KEY 已配置 |
| 待审选题重复或旧瓜过多 | 调整 `GOSSIP_WINDOW_DAYS_DEFAULT` 与 `GOSSIP_FINGERPRINT_FIELDS`;调整后重启后端,旧 pending 不会自动回溯重算 |
| 导出 JSON 中 `gossipFacts=null` | 这是手动主题生成的草稿;只有从待审选题批准生成的草稿会携带结构化 facts |

## 6. 抓取目标改版(慢循环)

目标站 HTML 改版时,先保存脱敏后的样本到仓库外 scratch,再用适配器/提取器测试复现。修复顺序:

1. 先确认 SSRF allowlist / channel host 没有误配。
2. 用 `packages/backend/src/scraper/adapters/*` 的单测补一个最小样本。
3. 修正提取器或站点配置。
4. 跑 `pnpm --filter 51guapi-backend test -- scraper` 与全量验证。

## 7. 首周观察

- 每天导出后在 `.ai-memory/` 记一行:日期/抓取量/入池量/导出量/异常
- **两档判定**:
  - **阻断性**(抓取失败、facts 丢失、生成/导出缺上下文、闸门误放行)→ 当日停用对应流程,走修复流程
  - **非阻断**(个别 gate-failed、文案小毛病)→ 累计记录,周末回顾决定是否修
- 一周后回顾:无阻断异常 → 转入常态运营;有 → 开新一轮修复计划
