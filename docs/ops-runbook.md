# 运营手册(ops-runbook)

单操作者日常运营 51publisher 的唯一参考。不依赖聊天记录。
**脱敏约束:本文档不得出现任何真实凭证/token/hash,只引用 `.env` 变量名与生成命令。**

## 1. 后端启停

```bash
bash scripts/start-backend.sh        # 构建新鲜度检查 → 启动 → 轮询 /api/v1/healthz 直到 200
```

- 停止:前台运行直接 Ctrl+C;后台运行 `pkill -f "node dist/index.js"`
- 启动失败先看终端输出:**fail-closed 拒启**多为 `.env` 弱值/缺值(`CORS_ORIGIN`、`JWT_SECRET`、`JWT_ADMIN_PASSWORD_HASH`),按提示修复
- 健康检查:`curl http://localhost:3001/api/v1/healthz`

## 2. 每日批量操作

前置:后端已启动;Chrome 已打开后台发帖页(`dx-999-adm` 域)标签;扩展侧边栏已登录。

1. 「待审」页确认今日选题(抓取管线自动入池,也可手动添加)
2. 「今日备稿」→ 一键备稿(取高分前 N 条,N 在设置「每日批量上限」,默认 5)
3. 「批量」视图跟进状态:
   - `gate-failed`(接地拦截)= 草稿缺事实来源 → 补事实后点重新生成,或 KILL
   - `awaiting-approval` → 逐条预览、编辑、审批发布
   - `needs-human-verification`(隔离区)= 发布派发后无回执 → **去前台人工核实是否已发**,绝不自动重发
4. 发布后前台抽查 ≥1 篇(标题/正文/标签/链接)
5. **重跑同一批**:已发布/隔离的题目会被 reentry 过滤静默跳过,属预期;确需重跑选 bypassReentry

## 3. 备份与恢复

- **节奏**:每周一次 + 每次真实发布日加一次
- **位置**:`~/51publisher-backups/`(仓库外;不入云同步盘;不包含 `.env`)
- **方法**(data/ 含 SQLite,禁止热拷贝):

```bash
# 先停后端,再:
cp -R packages/backend/data ~/51publisher-backups/data-$(date +%Y%m%d)
# 或不停后端,对 SQLite(pending.db / app.db,WAL 模式)用在线备份:
sqlite3 packages/backend/data/pending.db ".backup '$HOME/51publisher-backups/pending-$(date +%Y%m%d).db'"
sqlite3 packages/backend/data/app.db ".backup '$HOME/51publisher-backups/app-$(date +%Y%m%d).db'"
```

- **保留**:最近 4 份,更旧删除
- **恢复演练(上线前做一次)**:备份 → 移走 data/ → 从备份恢复 → 启动后端 → 待审池/批次数据可见即通过

## 4. 凭证管理

- 全部凭证只存 `packages/backend/.env`(不入库)
- 管理密码:`node packages/backend/scripts/hash-password.mjs` 生成 `JWT_ADMIN_PASSWORD_HASH`
- 强 `JWT_SECRET` 生成命令见 `.env.example` 注释
- **轮换后验证三步**:后端能启动 → 旧 token 调受保护路由返回 401 → 扩展重新登录成功
- LLM key 轮换:提供商控制台吊销旧 key 并确认旧 key 401;新 key 注意只有 `gemma4-*-heretic` 系模型可用,换后先跑一条草稿验证

## 5. 常见故障与恢复

| 症状 | 处理 |
|------|------|
| 扩展提示 401/登录失效 | 侧边栏重新登录(JWT 24h 过期属正常);若刚轮换过凭证,先 clearToken 再登录 |
| 后端连不上 | `curl /api/v1/healthz`;不通则按 §1 重启;扩展在后端不可达时自动降级为本地状态(fail-closed),数据不丢 |
| 批量填充「字段全部未找到」 | 后台是 layuiAdmin **iframe** 架构,先怀疑 iframe 结构变化;若后台改版走 §6 慢循环 |
| 「无法连接页面填充脚本」 | 确认后台发帖页标签已打开;改过扩展后必须**两步**:chrome://extensions 重载扩展 + F5 刷新后台页 |
| 扩展重装/换目录后后端拒绝请求(CORS) | 扩展 ID 变了:chrome://extensions 复制新 ID,更新 `.env` 的 `CORS_ORIGIN`(逗号分隔可放多个 `chrome-extension://<id>`),重启后端。**禁止放宽为 `*`**(后端会拒启) |
| 填充失效/选择器全红 | 后台改版 → 慢循环:重抓快照(脱敏!见 §6)→ contract 测试定位 → 改 field-mapping/fillers → 人工冒烟 |

## 6. 后台改版(慢循环)

详见 `docs/e2e-and-iteration-guide.md` 与 `docs/field-mapping-guide.md`。要点:原始 dump 存仓库外 scratch → 按 allowlist 脱敏 → `pnpm check:fixtures` 绿 → 才覆盖 fixture → 删 scratch。

## 7. 首周观察(发布后)

- 每天真发后在 `.ai-memory/` 记一行:日期/批次大小/异常
- **两档判定**:
  - **阻断性**(填充失效、闸门误放行、发布无回执频发)→ 当日停批量,走对应修复流程
  - **非阻断**(个别 gate-failed、文案小毛病)→ 累计记录,周末回顾决定是否修
- 一周后回顾:无阻断异常 → 转入常态运营;有 → 开新一轮修复计划
