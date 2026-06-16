# 首飞执行单（唯一入口 · 从头走到尾）

> ⚠️ **已废弃（2026-06-16）**：本运行单描述「填入后台发布 + acgs51 漫画来源」的首飞流程。
> 该发布机器与 acgs51 来源已在 v0.1（吃瓜小幫手）转型中整体移除，下文 `ACGS51_*` 环境变量、
> `51acgs.com`、`/scraper/trigger/acgs51` 等均不再适用。保留仅作历史记录。
>
> **本文件是 U8 对齐版本（2026-06-10）**，全量覆盖旧版。
> 首飞定义 = 手动路径 + 待审池路径 **各 ≥1 篇真实可见帖**，两条都过才算 G2 完成。

---

## ◾ Part 0 · 密钥轮换（R14 — 首飞前必须完成，只做一次）

> 这一步不做，后端 fail-closed 拒绝启动。顺序：生成 → 供应商轮换 → 写 .env → 重启 → 验证。

### 0-A 生成 JWT_ADMIN_PASSWORD_HASH

```bash
node packages/backend/scripts/hash-password.mjs
# 提示输入密码（不回显），输出：
# JWT_ADMIN_PASSWORD_HASH=<saltHex>:<keyHex>
# 把这行复制到 .env
```

密码长度 ≥8 位，记在安全的地方（后续无法还原）。

### 0-B 生成新 JWT_SECRET

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# 输出 96 字符 hex，复制到 .env 的 JWT_SECRET=
```

要求 ≥32 字符，不能是占位值（`change-this-*`、`secret` 等）。

### 0-C LLM_API_KEY 轮换（无条件执行）

> probe-grounding.mjs 下落不明 + 机构记忆 G5「已曝光须轮换」→ 无条件执行。

1. 在 LLM 供应商（DeepSeek / OpenAI 等）控制台：**作废旧 key，生成新 key**。
2. 把新 key 写入 `.env` 的 `LLM_API_KEY=`。
3. 旧 key 在供应商侧生效失效大约需要几分钟——开窗前等它失效再启动。

### 0-D 写 `.env` 并重启后端

最终 `.env` 必须包含（缺任何一项后端会拒绝启动）：

```dotenv
JWT_SECRET=<96字符hex>
JWT_ADMIN_PASSWORD_HASH=<saltHex>:<keyHex>
LLM_API_KEY=<新key>
LLM_ENDPOINT=https://api.deepseek.com/v1   # 或你的供应商地址
CORS_ORIGIN=chrome-extension://<你的扩展ID>   # 在 chrome://extensions 开发者模式下查看

# —— 路径 B(待审池)专属,首飞必配 ——
ACGS51_ENABLED=true
ACGS51_START_URL=<具体内容详情页URL>   # 必须是详情页!adapter 是单条详情页解析器,填首页抓出来的是垃圾
ALLOWED_HOSTS=51acgs.com               # START_URL 的 host 必须在此清单内,否则后端拒绝启动
```

> **触发方式与 allowlist 的分叉**:curl 带 `url` 参数触发时,该 url 额外过 `ALLOWED_HOSTS` 校验;
> 侧边栏按钮 / cron 不带 url,走上面配置的 `ACGS51_START_URL`(启动时已校验 host 在 allowlist 内)。

> **找扩展 ID**：`chrome://extensions` → 开启右上角「开发者模式」→ 找 51publisher → 复制 ID（32位字母）。
> 若同时有已解压（开发版）和打包版两个 ID，逗号分隔填两个。

```bash
# 停止旧进程后
cd packages/backend && pnpm start
# 启动日志应显示：Server listening on http://127.0.0.1:3001
# 若报 "CORS_ORIGIN is not set" → 补填 .env 再重启
# 若报 "Weak JWT_SECRET" 或 "Invalid JWT_ADMIN_PASSWORD_HASH" → 检查 .env 格式
```

### 0-E 扩展端验证轮换成功

1. `chrome://extensions` → 找 51publisher → 点 ↻ 重载。
2. 打开后台页，**刷新该页**（两个动作都要做）。
3. 侧边栏点「登录」，输入新密码 → 应收到新 token。
4. 旧 token（如有）401 是预期行为。

**0 步完成条件**：扩展登录 200 + 后台侧边栏显示已认证。

---

## ◾ Part 1 · G1 基线冒烟（首飞前置，每次开窗前确认）

| 检查项 | 方法 | 预期 |
|--------|------|------|
| 后端编译零错误 | `pnpm --filter publisher-backend compile` | 无红字 |
| 后端运行 | `curl http://127.0.0.1:3001/api/v1/auth/status` | `{"ok":true,"authenticated":false}` |
| 扩展已加载今天构建 | chrome://extensions → 查看「最后更新」时间 | 今天 |
| 登录 round-trip | 扩展侧边栏登录 | 200 + token |
| batch 写入 | `curl -X POST http://127.0.0.1:3001/api/v1/batches -H 'Authorization: Bearer <token>' -d '{"id":"smoke","tabId":1,"authorizedHost":"test","topics":["test"]}'` | `{"ok":true,...}` |
| pending 读取 | `curl http://127.0.0.1:3001/api/v1/pending-topics -H 'Authorization: Bearer <token>'` | `{"ok":true,"topics":[...]}` |

> **注意：data/ 恢复**：若此前跑了后端测试（会清空 data/），先恢复 Unit 1 备份的 `~/51publisher-backups/` 副本，待审池路径的数据源才就位。

**G1 满足时间**：\_\_\_\_\_\_ （写入，首飞 3 天窗口从此刻起算;**此时刻同时是观察② session 寿命的 t0**）

---

## ◾ 首飞中止协议（适用全程,触发即停,不现场即兴）

**中止判据**(任一触发即中止本次开窗):
1. dry-run 连续 3 次失败(同一问题反复)。
2. 单一问题排障超 30 分钟。
3. authorized 真实发布失败 1 次(save 非 code:0 且按 Q5 排查后仍不明)。
4. 暴露的问题触碰发布闸门链/消毒面(此类绝不现场热修)。

**中止动作**:`.env` 关回 `ACGS51_ENABLED=false` → 把已完成步骤与中止原因记入 Part 5 回填表 → data/ 保持现状不清理。

**改期规则**:在 Part 4「首飞完成声明」区写入带日期的改期承诺;缺陷修复走正常快循环(改码→测试→提交)后再开窗。

**中飞热修资格边界**(允许现场修的唯一类别):阻断首飞继续、且**不触碰闸门链/发布/消毒面**的问题。修后必须跑受影响文件的单测再继续;并在 Part 5「热修记录」栏写明「当时代码 = 基线 commit + 未提交改动摘要」——否则首飞实证结论无法复现。

---

## ◾ Part 2 · 路径 A · 手动路径（变量最少，推荐先飞）

### A-1 准备题材

在侧边栏「≣ 批量」选题框，每行一条，格式：

```
作品名称 || 作品名=实际作品名 | 类型=動畫/漫畫 | 集数=XX | 制作=制作方 | 漢化=https://example.com/link | 简介=一句梗概
```

**注意**：
- 连结（漢化、無修）填真实 URL，**不要把真实 URL 存进任何代码文件**，只在运行时输入。
- 先用一条安全测试题（可以是不真实发的）跑通流程，再换真题材。

### A-2 生成 + 填充

1. 档位 → `dry-run`（先验证填充，不真发）。
2. 「开始批量(生成+填充)」→ 等生成完成。
3. 展开草稿，逐项核对：
   - 标题/副标题是否合适？
   - 分类是「漫畫文章」还是「動漫文章」？（若 degrade 记在回填表 D 列）
   - 标签有没有匹配上？（若黄色/降级记下模型吐的原始词;**degrade 不会阻塞发布,黄色项必须人工看过再放行**）
   - 正文有没有编造的事实？
   - （路径 B 抓取选题）**事实与正文须与源页人工核对**——抓取内容是不可信输入,警惕源页夹带的指令性文本把模型带偏。

### A-3 media_id 手填

> **必须由操作者手填**，系统不会自动匹配。
> ⚠️ **操作位 = 侧边栏审读面板(DraftPreview)的 media_id 草稿字段,绝不在后台表单里手改!**
> 批准时填充器会用草稿值覆盖整个表单——你在表单里手填的任何值都会被冲掉。

在后台搜索或浏览找到对应作品的 media_id（数字），回到**侧边栏审读面板**展开该条草稿,填入 media_id 字段。

### A-4 cover_url 处理

`cover_url` 字段（`input[name="cover_url"]`）：
- 如果后台允许直接输入封面图 URL → 填入 CDN 地址。
- 如果必须走文件上传 → 操作者在表单里手动上传，并记录是否会因空 cover_url 报错（记入 Part 5 回填表）。
- MVP 阶段可先试 status=0 隐藏帖不带封面，看 save 是否成功。

### A-5 以 status=0 隐藏帖发布

1. 档位切 `authorized`。
2. ⚠️ **在侧边栏审读面板(DraftPreview)的草稿字段里把 postStatus 设为 `0`(隐藏)——不要在后台表单里改!**(草稿默认是 `1`=显示;填充会用草稿值覆盖表单,表单里手改的 status 会被冲回可见,首飞帖直接公开上线。)
3. 点「批准」→「发布」→ 操作者看到提示后手势确认（填充器不会替你点）。
4. F12 → Network → 找 `POST /admin/webarticle/save`：
   - 响应应为 `{"code":0,"msg":"操作成功"}` 或类似成功标志。
   - 若报错，记在 Part 5 回填表 F 列。
   - **【观察④】**顺带记录:响应 JSON 的结构性字段(code/msg/data.id/data.url 是否存在)+ 帖子 ID + save 时刻(观察⑤的 t_save)。
     **入库脱敏纪律**:写进本文件前剥除 token/cookie/Set-Cookie/会话类字段,只留结构性字段;原始完整响应如需留存,放仓库外 scratch 路径(脱敏闸门不扫 docs/,这里只能靠纪律)。

### A-6 后台核验

1. 进后台「文章管理 → 列表」，刷新。
2. 找到刚发的帖（状态=隐藏）：
   - 标题 ✓ / 正文渲染正常 ✓ / 分类 ✓ / 标签可见 ✓
   - cover_url 有没有错误？（记入回填表）
3. **【观察③·停顿步,转正前必做——转正后此窗口永久关闭】**
   开一个**无痕窗口**(未登录态)访问该帖的前台 URL(由帖子 ID 按既有帖的 URL 形态推导,如 `/topic/blog/<id>`):
   - 记录:HTTP 状态(200/404/跳转?)/ 页面是否渲染出内容 / 是否跳登录页。
   - 这是「隐藏帖免登录可访问性」的唯一实证窗口,结论直接决定路线图「隐藏态自动发」候选项的生死。
   - 若实证**可公开访问**:同时把它记为自家站点访问控制观察,反馈站点侧处置。
4. 核验通过 → 把状态改为「显示」（`status=1`）。**【观察⑤】**记录转正时刻。
5. 前台访问路径确认帖子可见。**【观察⑤】**记录前台显示的发布时间——与 save 时刻、转正时刻对照:时间戳取的是哪一刻?转正是否刷新了时间?(三元组记入 Part 5;另注意草稿 publishedAt 默认为空,「空值后台落什么时间」本身就是实验。)
   **【观察④续】**用真实前台 URL 反推「帖子 ID → URL 固定模板」是否成立(影响阶段 2 注册表设计)。

**路径 A 完成条件**：帖子在前台可见，回填表 A 列完整填写。

---

## ◾ Part 3 · 路径 B · 待审池路径

> **过闸铁律**:路径 B 的过闸帖**必须源自 scraper 真实抓取入池**的选题(id 前缀 `scheduled_` 或手动 trigger 产物)。
> 手注条目(下方「排障演练」)只用于演练流程,**不计阶段 1 过闸**——否则抓取管线(本次首飞的主角)依然从未点火。

### B-0 选题指引(防重入守卫假死)

`ACGS51_START_URL` 填一个**从未发布过的新作品**详情页。重入守卫按选题名过滤已发布主题——若抓的作品与历史发布(含 ID 121)同名,批量会「点了没反应」(静默返回旧批次,见排障 Q9)。

### B-1 触发抓取入池

前提:`.env` 已配 `ACGS51_ENABLED=true` + `ACGS51_START_URL=<详情页>` + `ALLOWED_HOSTS=51acgs.com`(缺任一项后端拒绝启动,见 Part 0-D)。

三种触发方式(任选其一):
- **方式 1·侧边栏**:「⏳ 待审」→「⚡立即抓取」。若弹出适配器选择框选 `acgs51`;若选择框不出现(side panel 对 prompt 支持存疑)→ 走方式 2。
- **方式 2·curl(指定任意详情页,过 allowlist)**:
  ```bash
  curl -X POST http://127.0.0.1:3001/api/v1/scraper/trigger/acgs51 \
    -H 'Authorization: Bearer <token>' \
    -H 'Content-Type: application/json' \
    -d '{"url":"https://51acgs.com/<详情页路径>"}'
  ```
- **方式 3·等 cron**(默认每 6 小时,抓 START_URL)。

⏳ **触发后耐心等**:UI 的「抓取中…」提示 2 秒就消失,但后端链路(抓取重试+LLM 提取)实际要 45-90 秒——**等 90 秒再刷新列表,千万不要重按**(无去重,重按=重复入池)。

记录:触发方式 \_\_\_、触发→入池耗时 \_\_\_、confidence \_\_\_、封面是否入池 \_\_\_。

### B-1b 排障演练用·手注条目(不计过闸)

仅当需要在抓取不可用时演练后续流程:
```bash
curl -X POST http://127.0.0.1:3001/api/v1/pending-topics \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"sourceUrl":"https://example.com","siteName":"acgs51","title":"测试作品 · 首飞验证","facts":{"作品名":"测试作品","类型":"漫畫"},"confidence":0.8}'
```
若抓取在窗口内无法走通 → 按**中止协议**改期,而不是用手注条目换道过闸。

### B-2 待审 → 批准 → 生成

1. 侧边栏「⏳ 待审」→ 展开该条:核对事实字段(可**内联编辑**修正,记录改了哪些:原值→改值)、查看封面缩略图。
2. **批准前确认活动 tab = 后台发帖页**(tab 漂移会让批次静默暂停)。
3. 勾选 → 「批准所选」→ 进入批次生成流程。
4. 后续步骤同 A-2 至 A-6(dry-run 核对 → media_id 手填【在 DraftPreview!】 → postStatus=0【在 DraftPreview!】 → authorized 发布 → 核验 → 观察③停顿步 → 转正)。
5. 记录 pending id ↔ 批次条目 对照(系统无关联键,手记)。

**路径 B 完成条件**：来自**真实抓取入池**的帖子在前台可见，回填表 B 列完整填写,「pending 来源」列可证明非手注。

---

## ◾ Part 4 · 首飞收尾(顺序固定:观察① → 清理 → U13【后端在跑】→ 停后端 → 备份 → 声明)

### 观察① · 弹层自动化 dry-run 实测(限时 15 分钟,可选时点)

> 实证「无人触碰能否完成填充」——路线图「定时/隐藏态」候选项的前置数据。**与本次发布无关,放收尾做最安全**(也可在 A-2 dry-run 通过后、切 authorized 前做)。

1. 档位确认 `dry-run`。新开后台发帖页 tab,**不点「添加」**(弹层不开)→ 触发一次填充 → 记录失败形态(全字段 skip?报错?)。
2. F12 console 尝试程序化打开弹层(layui 弹层在 iframe 内,注意切到正确 frame 上下文)→ 成功打开后再触发填充 → 记录是否全绿。
3. **超过 15 分钟未决 → 记「未决,留阶段 2」**,F5 刷新后台页恢复干净状态,停止实验。
4. 结论记入 Part 5 观察①栏。

### 清理测试帖

后台「文章管理」→ 搜索 `TEST_勿用` → 删除全部结果。
同样检查 id 110 / 111 / 112 是否仍存在（遗留测试帖） → 若存在，删除。

### U13 集成验证（首飞后,~5 分钟,**后端必须还在跑**）

> CORS 收紧代码已合入，`CORS_ORIGIN` 未设置或为 `*` 时后端已 fail-closed 拒绝启动。
> 唯一还差的是「打包版扩展真实请求」走一遍：

1. 确认 `.env` 中 `CORS_ORIGIN` 已填你的扩展 ID（见 Part 0-D）。
2. 用**已加载的扩展**（非 curl）执行一次带认证的操作（如「拉取模型列表」或触发一次生成）。
3. F12 → Network → 找该请求 → Response Headers：
   - `access-control-allow-origin: chrome-extension://<你的ID>` ✓ 即通过。
   - 无该头 → 检查 CORS_ORIGIN 是否与扩展 ID 完全一致（区分大小写）。
4. 记录(脱敏:**排除 Set-Cookie 类字段**):实测用的扩展 ID \_\_\_\_\_\_、响应头值 \_\_\_\_\_\_、完成时间 \_\_\_\_\_\_ ✅

### 备份 data/（R0 第二次备份,U13 完成后再停后端）

```bash
# 先停止后端,再执行:
sqlite3 packages/backend/data/pending.db ".backup '$HOME/51publisher-backups/pending-$(date +%Y%m%d-%H%M).db'"
cp -r packages/backend/data/ "$HOME/51publisher-backups/data-postflight-$(date +%Y%m%d-%H%M)/"
```

- 记录备份路径：\_\_\_\_\_\_
- **机密结论成文**:data/ 是否含机密类配置?\_\_\_(是/否+依据。已知:config 库只存 field_mappings 无凭证,但含抓取原文与草稿等业务数据;异地落点的访问控制一并记录)
- 纪律:备份加密落异地,或上面「无机密」结论成文;**`.env` 永不进备份集**。

### 首飞完成声明与收尾决定

两条路径都完成后，在此记录：

- **路径 A 完成时间**：2026-06-10（ID 121,已完成）
- **路径 B 完成时间**：\_\_\_\_\_\_
- **帖子 URL（路径 A）**：\_\_\_\_\_\_ （若愿意记录）
- **帖子 URL（路径 B）**：\_\_\_\_\_\_ （若愿意记录）
- **收尾决定·ACGS51_ENABLED**:关回 false / 保持 true(保持=接受每 6 小时重抓同 URL 重复入池)→ 决定:\_\_\_\_\_\_
- **收尾决定·ALLOWED_HOSTS 中 51acgs.com**:去留 → 决定:\_\_\_\_\_\_(防首飞后长期残留)
- **观察② t1**(收尾最后一次后台成功请求时刻):\_\_\_\_\_\_
- **观察② t2**(次日开机首查后台 tab 是否仍登录;**后补采点,空白不算回填缺口、不阻塞收尾**):\_\_\_\_\_\_
- （改期时)中止原因与改期日期:\_\_\_\_\_\_

**G2(路径 B)+ U13 完成 → 整个阶段 1 运营部分收工,进入收工复盘(Unit 6b)。**

---

## ◾ Part 5 · 回填表

### 5-1 每条帖子记一行

| # | 路径 | 分类 degrade 词 | 标签命中? | cover_url 报错? | media_id 来源 | save 结果 | 前台核验 | 摩擦点备注 |
|---|------|----------------|-----------|----------------|--------------|-----------|---------|-----------|
| A-1 | 手动 | | | | | | | |
| B-1 | 待审池 | | | | | | | |

**degrade 词**：填充器匹配不到标签时，模型吐的原始词（如「成人動畫」「校園/日常」），是 G4 词表的真底料。

### 5-2 路径 B 抓取段(每条入池选题)

| 项 | 记录 |
|---|------|
| 触发方式(侧边栏/curl/cron) | curl,**不带 url**(走 config.url=ACGS51_START_URL),2026-06-10 18:14:56 |
| 触发→入池耗时 | ~2.6 秒(抓取+LLM 提取同步返回) |
| extractionMode(strict/fallback) + confidence | confidence **0.43**(偏低;extractionMode 未在 trigger 响应暴露) |
| facts 内联修正(原值→改值,逐项) | 待审读阶段(原 facts 稀疏:作品名✓、题材=多人群交、简介=多人群交[=meta desc 直抄]) |
| 封面:是否入池 / 是否进草稿 | 入池=是,但取到的是**站点 TG 占位图** `/static/web/images/tg-image.jpg`(相对路径,非真实封面) |
| **cover_url 字段实证结论**(hidden URL 可填 vs 必须 file upload) | 待发布阶段(建议 status=0 隐藏帖先不带封面,占位图相对路径不可用) |
| **pending 来源校验**(id 前缀 `scheduled_`/trigger 产物=真实抓取 ✓;手注=不计过闸) | id=`scrape_1781086498819_jr414k`,前缀 `scrape_`=trigger 真实抓取产物 ✓(非手注) |
| pending id ↔ 批次条目对照(手记) | 待批准 |

> **首飞实证·确凿 bug(留首飞后快循环修,触碰 SSRF 安全面不飞行中热修)**:
> `scraper-routes.ts:8` 的 `loadSSRFAllowlist()` 在模块顶层执行,因 ESM import 提升早于 `index.ts:24` 的 `dotenv.config()` → 路由层 ALLOWED_HOSTS 快照永远为空 → **凡带 `url` 参数的 trigger(run-sheet 方式2)一律 deny-all 403**。env-check 在 `start()` 内(dotenv 之后)读到正确值故启动通过——这正是账实不符:方式2 从未真跑过所以缺陷一直潜伏。
> **合规绕过(本次采用)**:trigger 不传 `url`,走 `config.url`(=已被 env-check 启动时校验的 START_URL),路由 SSRF 块整段跳过,`safeFetch` 的公网 IP 校验照常生效。
> **修复方向**:把 allowlist 改为首次调用时惰性加载,或 index.ts 确保 dotenv 先于路由 import。受影响:`scraper-routes.ts` + 其测试。

### 5-3 审读与发布确认(每条)

| 项 | 确认 |
|---|------|
| postStatus=0 已在 **DraftPreview** 改(非表单) | ☐ |
| media_id 已在 **DraftPreview** 填(非表单) | ☐ |
| grounding 结果(绿/拦+原因) | |
| degrade 黄色项已人工看过 | ☐ |
| 隔离区/KILL/静默失败是否出现 | |

### 5-4 五项观察

| 观察 | 结论 |
|------|------|
| ① 弹层自动化(未开弹层失败形态 / console 开弹层后结果 / 或「未决留阶段 2」) | |
| ② session 寿命(t0=G1 时刻 / t1=收尾 / t2=次日,t2 可后补) | |
| ③ 隐藏帖免登录可访问性(HTTP 状态/渲染/跳转;若可公开访问→记站点访问控制观察) | |
| ④ save 响应结构(code/msg/data.url 有无;已脱敏)+ ID→URL 模板验证 | |
| ⑤ 时间戳三元组(save 时刻/前台显示/转正后是否刷新) | |

### 5-5 热修记录(如有)

| 修了什么 | 当时代码 = 基线 commit + 未提交改动摘要 | 修后跑过的测试 |
|---------|----------------------------------------|---------------|
| **批准链路 tab 定位 bug**(2026-06-10 首飞中热修):`PendingTopicsView.tsx`/`BatchView.tsx` 用 side panel 的 `tabs.query({active:true})` 当批次目标 tab。根因(5-agent workflow 坐实):side panel/DevTools 抢焦点时 active tab 非授权域 → `runBatch` `resolveHost()`=null → line 75 `return null` 静默流产(后端零 POST /batches);叠加 MV3 SW 回收致 `sendMessage` 永久 pending → 侧栏「处理中…」卡死。修复=两组件改用 messaging.ts 既有正确实现 `resolveAdminTabId()`(按 host 全窗口定位发帖页)。**不碰闸门链/发布/消毒面**(仅换 tab 来源,复用已测函数)。待办:放大器 B(sendMessage 超时兜底)+ C(connect 长连接抗 SW 回收)留正式 PR。 | 基线 `ed306ab` + 未提交:`messaging.ts` 导出 `resolveAdminTabId`、`PendingTopicsView`/`BatchView` 改用之并删未用 `browser` import | `messaging.test` + sidepanel 组件 **51 passed**;扩展 `compile` 绿 |

---

## ◾ 附录 · 常见问题与排查

### Q1: 「字段全部未找到」

原因：发帖表单在 layuiAdmin 的内容区 **iframe** 内，而非顶层文档。
解法：`frame-resolve.ts` 自动处理，无需手动干预。
但若 iframe 未完全加载 → 先等后台页面完全稳定再触发填充。

### Q2: 标签全部 degrade（黄色）

1. 侧边栏「⚙ 设置 → 字段映射」确认 `tags` selector 是 `input[name="tags[]"]`，fieldType 是 `checkbox-multi`。
2. 标签系统有 ~3912 个标签，可在弹层搜索框输入关键词过滤。
3. AI 吐的英文标签（如「anime」「adult」）可能找不到对应中文选项 → 正常 degrade，记录词表。

### Q3: 后端启动失败 / fail-closed

报错内容指向哪个字段就修哪个：
- `Weak JWT_SECRET` → 换强密钥（≥32 字符，无占位词）。
- `Invalid JWT_ADMIN_PASSWORD_HASH` → 重新跑 `hash-password.mjs`。
- `LLM_ENDPOINT missing` → 填入真实端点 URL。

### Q4: 扩展填充后表单没变化

1. `chrome://extensions` → 51publisher → ↻ 重载扩展。
2. 回到后台页 → **刷新页面**（两步都要做）。
3. 重新点「添加」打开弹层，再触发填充。

### Q5: save 响应非 `code:0`

记入回填表 F 列，截图保留 Network 请求体 + 响应体（**入库前脱敏**），作为定位素材。
不要连续重试——先检查表单字段是否有必填项未填（cover_url / media_id 最常见）。
**timeout 的特殊性**:超时不等于失败——帖子可能实际已保存。**先去后台列表核对是否已存在**,再决定下一步;贸然重试可能产生重复帖。

### Q6: 首飞窗口落空（3 天内未完成）

按**首飞中止协议**(见 Part 1 之后的专节)执行:关回 ACGS51_ENABLED → 记录中止原因 → 在 Part 4 完成声明区写入带日期的改期承诺,同步到 `.ai-memory/project_51publisher.md`。U13 CORS 实测随首飞延期。

### Q7: 批准后条目状态一直不变

fill 失败 / grounding 拦截时存在已知的静默 no-op(状态机无效转移,error 不落档)。
**勿连点批准**——打开扩展的 service worker console(chrome://extensions → 51publisher →「服务工作进程」)看报错,按报错处理。

### Q8: 批准后选题从待审列表消失,批次也没建

批准是单向门:状态已改 approved 但批次创建失败时,列表(只显示 pending)就找不到它了。找回:
```bash
curl -X PATCH http://127.0.0.1:3001/api/v1/pending-topics/<id> \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"pending"}'
```

### Q9: 批量「点了没反应」(没有任何新批次)

疑似重入守卫:选题名与历史已发布主题(含 ID 121)重名时会被静默过滤、返回旧批次。
确认选题是**从未发布过的新作品**;确需同名重跑走「重跑生成」(bypassReentry)通道。

---

## ◾ 附录 · 扩展重载速查

每次修改 extension 代码后必须做两步，**缺任何一步填充不生效**：

1. `chrome://extensions` → 51publisher → ↻（重载按钮）。
2. 后台页 → **F5 刷新**（重新注入 content script）。
