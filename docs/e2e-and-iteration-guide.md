# e2e 与迭代指南

> 给维护者(你 + AI 协作)的一页纸:这套 e2e 测什么、不测什么、后台改版怎么修、漂移靠什么兜。

## 5 分钟速览

- **测什么**:一条本地 fixture(真实 Quill 2.0.2 + 真表单结构)上的**核心填充路径**——字段填对、正文进 Quill(过消毒+规范化)、**零提交**;外加一条 `window.Quill` 不可用时的**降级路径**。
- **不测什么**:① Side Panel UI 的端到端(由 `entrypoints/sidepanel/*.test.tsx` 组件测试覆盖);② 真后台的自动化登录/回归(只人工冒烟);③ 真正的跨世界(ISOLATED↔MAIN)隔离——e2e 在单个 jsdom realm 跑桥的 round-trip,**不**复现世界隔离/序列化/跨世界时序。
- **漂移靠什么兜**:**被动发现**。contract 测试只在「人工重抓 fixture 后」才会因选择器消失变红;真后台改版本身**不会**自动触发任何红灯。要等填充失效被察觉 → 重抓 → contract 红 → 修。这是设计上接受的边界,不是主动预警。
- **零提交的真边界**:fixture 是惰性静态 DOM,没有真后台的动态提交 handler(按键/blur/layui 自动提交)。e2e 的 `submit=0` 只证明「填充逻辑本身不提交」;真后台动态 handler 不自动提交,只能靠**人工冒烟**确认。

## 快循环(平时改代码)

```
改 lib / entrypoints
  → pnpm test        # 单测(jsdom,mock)
  → pnpm test:e2e    # fixture 核心填充路径 + 降级 + contract(真 Quill)
  → pnpm compile     # tsc 类型检查
  → 全绿才提交
```

`pnpm test` 与 `pnpm test:e2e` 用两份 vitest 配置:主配置排除 `tests/e2e`(保持单测轻快),e2e 配置加载真 Quill。

## 慢循环(后台改版时)

```
怀疑/确认后台改版(填充失效)
  → 重抓快照(见下「重抓步骤」,含强制脱敏)
  → 看 contract 测试哪个选择器红了(pnpm test:e2e)
  → 改字段映射 lib/field-mapping.ts 或填充器 lib/fillers.ts
       (参 docs/field-mapping-guide.md 的 Tier 分级:A 改 config / B 改 fillers / C 改架构)
  → 人工冒烟一次(见下「人工冒烟清单」)
  → 回 docs/field-mapping-guide.md 更新选择器记录
```

## 重抓快照步骤(R8 + R14 脱敏)

> ⚠️ 这一步会接触**真后台登录态**。脱敏不是可选项,是硬要求。

1. 登录真后台,打开 `/admin/webarticle/index` 的「添加」弹层。
2. **存到仓库外的 scratch 路径**(如 `/tmp` 或 gitignore 目录)。**不要**把 DevTools「另存整页」/ HAR / 截图直接拖进仓库。
3. 在 scratch 副本上**脱敏**(见下「脱敏清单」)。
4. `pnpm check:fixtures` 必须绿。
5. 才覆盖 `tests/e2e/fixtures/webarticle-add.html`,更新文件顶部注释的抓取日期。
6. **删掉 scratch 产物**(原始 dump、HAR、截图)。

### 脱敏清单(allowlist 思路:只留该留的)

- [ ] 剥掉所有 `type="hidden"` 字段的 `value`(CSRF token、nonce、签名等)。
- [ ] 清掉内联 cookie / `Set-Cookie` / `Authorization` / `Bearer` 片段。
- [ ] 内部 / 管理域 API、上传地址 → 换占位(只在测试需要时保留结构)。
- [ ] 真实用户名 / 作品 id / 文章内容 → 换合成值。
- [ ] 抓取副产物(截图 / HAR / scratch dump)**不进仓库、不喂 AI / 聊天**。

### 脱敏闸门(`pnpm check:fixtures`)

- 主规则:`type="hidden"` 字段不得带非空 `value`(检测与属性顺序无关,`value` 在前也拦)。
- 次规则(tripwire):扫 token / cookie / JWT / 长 hex 等常见机密形态。
- **自检**:闸门每次先用**运行时生成**的投毒样本验证自己能检出;检不出就判定闸门 no-op 并大声失败(防 fail-open)。投毒样本不落仓库,免得假机密触发外部 secret 扫描器。
- **强制**:已配 git pre-commit hook(`scripts/git-hooks/pre-commit`),fixture 变更不过闸门则挡提交。
  - 一次性启用:`git config core.hooksPath scripts/git-hooks`
- **诚实局限**:shell 闸门无法完整解析 HTML、挡不住所有未知字段名的机密。它是「合成 fixture + 人工脱敏 + 人工复核」之上的一道自动兜底,**不是唯一防线**。首次 commit 的 fixture 因合成而结构安全;此后每次真后台重抓都重新引入风险,全靠这道闸门 + 人工脱敏把守——这条不对称要记牢,别误读成「风险已彻底解决」。

## 人工冒烟清单(R10:改版 / 重抓后)

> 这是兜「真后台动态行为」与「真后台没漂移」的唯一手段,e2e 兜不到。

- [ ] 打开真后台「添加」表单。
- [ ] 用插件填一遍(side panel → 生成 → 填充到当前页)。
- [ ] 肉眼核对每个字段填对了(标题/副标题/分类/标签/描述/状态/时间/作品 id)。
- [ ] 确认正文在 Quill 里显示正常、格式没乱;若显示「需手动 / 降级」,核对「复制正文」出口可用。
- [ ] **确认全程没有任何一步触发提交或自动发布。**
- [ ] 若本次涉及重抓 fixture:确认已脱敏(allowlist 剥洗)且 `pnpm check:fixtures` 绿,才提交 fixture。

## fixture 路线的已知局限(R11)

- fixture 是**某一时刻**真后台的快照;e2e 全绿只证明「对那一刻的结构」填充正确。
- 对方后台漂移**只能事后被动发现**(填充失效 → 重抓 → contract 红),不是主动预警。
- fixture 已脱敏,**并非生产 HTML 的逐字副本**。
- 静态 fixture **无法复现**真后台的动态提交 handler;零提交的最终保证靠人工冒烟。
- e2e 在单 jsdom realm 跑桥往返,**不覆盖**真正的跨世界隔离;那部分无任何自动测试。
