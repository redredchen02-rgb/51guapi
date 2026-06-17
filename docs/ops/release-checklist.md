# 发布检查清单 v0.2.1

吃瓜小帮手（51guapi）发布前操作清单。功能范围：**只爬取 + 提炼 + 导出，不发布、不写回任何站点。**

---

## 阶段一：机械预检（可由 pnpm preflight 自动覆盖）

```bash
pnpm preflight          # 运行所有 green checks，应全部 pass
pnpm test               # 全包单测（880 tests 应全绿）
pnpm compile            # tsc 类型检查（应无错误）
bash scripts/check-all.sh  # 完整流水线（lint + test + 双端 build + 产物校验）
```

- [ ] `pnpm preflight` 全绿（corsId / backendFailClosed / bundleKeyScan / alarmsPermission）
- [ ] `pnpm test` 全绿
- [ ] `pnpm compile` 无报错
- [ ] `bash scripts/check-all.sh` 全通过

---

## 阶段二：不可逆操作（运营者亲手，严格有序）

> ⚠️ 以下步骤顺序不可颠倒。任何激活线上后端的操作必须在密钥配置完成后执行。

### 2-A. 生成强凭证（首次部署或密钥轮换时做）

- [ ] 生成 `JWT_SECRET`（≥32 字节随机值）：
  ```bash
  node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
  ```
- [ ] 生成 `JWT_ADMIN_PASSWORD_HASH`：
  ```bash
  node packages/backend/scripts/hash-password.mjs
  ```
- [ ] 设置 `LLM_API_KEY`（LLM 供应商控制台获取）
- [ ] 把以上值写入 `packages/backend/.env`（不入库）
- [ ] 权限收紧：`chmod 600 packages/backend/.env`

### 2-B. CORS 配置

- [ ] 确认扩展 ID = `iljimdgfajpgnmanklehhmapojbcjecd`（在 `chrome://extensions` 核对）
- [ ] 设置 `CORS_ORIGIN=chrome-extension://iljimdgfajpgnmanklehhmapojbcjecd`
- [ ] **绝不设为 `*`**（后端 fail-closed 会拒绝启动）

### 2-C. 后端启动验证

- [ ] 启动后端：`bash scripts/start-backend.sh`
- [ ] 确认 fail-closed 通过（弱值/占位值会被拒启动，按提示修复）
- [ ] `curl http://localhost:3001/api/v1/healthz` 返回 200

### 2-D. 扩展加载与冒烟

- [ ] `pnpm build:extension` 产出 `packages/extension/.output/chrome-mv3/`
- [ ] 在 Chrome `chrome://extensions` 开发者模式 → 「加载已解压」→ 选 `.output/chrome-mv3/`
- [ ] 扩展侧边栏 → Settings → 连接后端（`http://127.0.0.1:3001`）→ 登录
- [ ] 添加一条测试 URL → 确认进入待审池（gossip 抓取管线正常）
- [ ] 触发「备稿」→ 确认 AI 草稿生成（LLM 管线正常）
- [ ] 导出 JSON / Markdown → 确认格式正确

---

## 阶段三：打 release tag（CI 自动构建 artifact）

- [ ] 确认所有测试和构建通过
- [ ] 确认 `CHANGELOG.md` 已更新至 `[0.2.1]`
- [ ] 所有变更已合并到 main 分支

```bash
git tag v0.2.1
git push origin v0.2.1      # 触发 .github/workflows/release.yml
```

- [ ] GitHub Actions `release.yml` 触发，等待完成
- [ ] GitHub Releases 页有 v0.2.1，附件 `chrome-mv3.zip` 存在

---

## 阶段四：首次冒烟后操作

- [ ] 更新 `.ai-memory/project_51publisher.md`，记录首次成功使用的日期和关键数据
- [ ] 备份 `packages/backend/data/`（首次运行后）：
  ```bash
  sqlite3 packages/backend/data/app.db ".backup '$HOME/51guapi-backups/app-$(date +%Y%m%d).db'"
  ```

---

## 参考

- 完整运营手册：`docs/ops-runbook.md`
- 首飞 Runbook（旧版，含发布流程参考）：`docs/runbooks/first-flight-runbook.md`
- 环境变量说明：`packages/backend/.env.example`
- preflight checks 源码：`scripts/preflight/checks/`
