---
date: 2026-06-15
topic: publish-action-robustness
---

# 发布动作健壮性:退役死路径 + 诚实硬化

> **实施状态(2026-06-15):✅ 已实施。** R1–R3(退役单条死路径:`handlePublish`/`requestPublish`/`PUBLISH_PAGE`/`publishMarker` + shared 类型 `PublishPageResponse`)+ R4(`asPublishResult` 判别式收紧,杜绝 `{ok:true,error}` 假确认)+ R5(`GateDecision.reason`:off/dry-run/authorized/not-authorized/host-unreachable,经 `isGateBlocked` 接入批量循环)全部落地。共用物件 `orchestratePublish`/`asPublishResult`/`evaluateGate`/`GateDecision` 温存。1017 单测 + 37 e2e + 三包 compile 全绿。grounding Phase 2 R9 已据此更新为「单条路径退役」。

## Problem Frame

本项目核心价值:AI 生成 → 人审阅 → 安全填充,绝不自动提交、绝不发布幻觉内容。grounding 系列守「发出去的**内容**对不对」(grounding **双求值闸** = snapshot ✓ **且** 最终 draft ✓,见 grounding Phase 1 / PR #23)。本次守正交的另一条线——「**发布这个动作本身**稳不稳、诚不诚实」。

全库扫描 + 真实代码核对后,实况偏向减法——**大部分已经做好,真正要动的是减法**:

- 批量发布路径崩溃恢复**已实现**:`publish-dispatched` 无回执 → `recoverBatch` → `needs-human-verification` 隔离 + 启动扫描 + 通知(`storage.ts:190`、`batch.ts:26-27`、`background.ts` 的 `runStartupTombstoneScan`)。
- 漂移前置攔截**已有**:审批前 `checkSelectorDrift` 软门 + `publish.ts:99` 拒发空帖。
- **单条手动发布路径(`handlePublish` / PUBLISH_PAGE / `requestPublish`)是死代码**:发送端 `requestPublish` 全 UI 零调用(coverage `FNDA:0`);实际发布全走批量审批路径(APPROVE_BATCH / APPROVE_SINGLE_ITEM)。它带着无启动恢复的 `publishMarker:tabId`、和一个**不过 grounding 双求值闸的 `authorized` 出口**——批量改版前的遗留。
- `asPublishResult`(`background.ts:117`)只校验 `ok`/`dryRun` 是 boolean,不校验互斥。**注意**:当前 content/`executePublish` 实际只产出 `{ok:true,dryRun:false,url?}`(成功)或 `{ok:false,dryRun:false,error}`(失败),**畸形 `{ok:true,error}` 今天产不出来**——R4 因此是**防御未来 content 回归**的 fail-closed,不是修一个现行 live bug。
- `GateDecision.allowed` 是裸 boolean → 「host 不在名单」与「tab 关/取不到 url」塌缩成同一个 `blocked`,操作者无法诊断。

受影响者:防幻觉/零裸奔铁律(从「批量被守、单条裸奔」收敛为「唯一发布路径被守」);操作者(被阻时能看懂原因;不再有假确认污染发布记录)。维护者(少一条死路径与一份重复发布机制)。

### Threat Model(plan 级,本次防的三件事)
1. **最可能**:未来贡献者再加一个绕过 grounding 闸的 PUBLISH_GRANT 发送端(如 Scope Boundaries 提到的「立即发当前页」按钮),悄悄重开本次关闭的裸奔出口。缓解 = 「唯一发送端」守护测试(见 Success Criteria)。
2. **影响最大**:被改坏/受污染的 content 回包伪造 `publish-confirmed`,污染已发布台账与去重集 → 误触重发。缓解 = R4 完整(含 dryRun 一致性规则)。
3. **最隐蔽**:content 端 `handlePublishGrant` 监听器**不校验 sender/host**(PUBLISH_GRANT 是无 payload 的裸触发),其安全完全依赖 ① content script 的 `matches` 仅注册在授权 host ② **manifest 无 `externally_connectable` / `web_accessible_resources` / `onMessageExternal` 外部消息面**(已核实三者皆无)③「content 绝不自我授权」。把「无外部消息面」纳入既有「注入面=闸门面」不变量,作为发布授权攻击面的一部分守护。

## 当前 vs 改动后:authorized 发布出口

```
当前(两个 authorized 出口,一守一裸;PUBLISH_GRANT 有 2 个发送端):
  批量审批  approveBatch ──→ orchestratePublish ──→ sendGrant ─→ [grounding 双求值闸 ✓] [崩溃恢复→NHV ✓]   ← 活路径,已守
  单条手动  handlePublish ─→ orchestratePublish ──→ sendGrant ─→ [无 grounding 闸 ✗]  [publishMarker 无启动恢复 ✗]   ← 死路径(UI 零调用),裸奔出口

改动后(单一守好的出口;PUBLISH_GRANT 仅剩 1 个发送端):
  批量审批  approveBatch ──→ orchestratePublish ──→ sendGrant ─→ [grounding 双求值闸 ✓] [崩溃恢复→NHV ✓]
  单条手动  ✘ 已删除(消除裸奔出口;orchestratePublish/asPublishResult/evaluateGate/canSubmit 仍由批量路径共用,保留)
  content 端 handlePublishGrant 监听器**保留**(批量路径需要它);其安全靠「唯一发送端 + matches 限定 + 无外部消息面」三重保证
```

## Requirements

**退役单条手动发布路径**
- R1. 删除单条手动发布入口的完整闭包,删后无悬挂引用、`pnpm -r compile` 绿。完整删除面(planning 删前再核一次):
  - extension:`handlePublish`(`background.ts:183`)及 `createHandlers` 返回对象里的 `handlePublish,` 项(`:472`)、`PUBLISH_PAGE` 监听臂(`:613-614`)、文件头 PUBLISH_PAGE 路由注释(`:62`)、`markerKey` 与 `publishMarker:${tabId}` 读写(`:132`)、`requestPublish`(`messaging.ts:117`)与 `PUBLISH_PAGE` timeout 项(`messaging.ts:21`)。
  - shared(需随后 `pnpm --filter @51publisher/shared build` 重生 dist,再 `-r compile`):`PublishPageResponse`(`types.ts:235`)、`RuntimeMessage` 联合里的 `PUBLISH_PAGE` 臂(`types.ts:144`)、`index.ts:53` 的 re-export。
  - ⚠️ `TodayBatchView.tsx:195` 有一个**同名但无关的 live** `handlePublish`(走批量 `approveSingleItem`)——勿被 grep 误删。
- R2. 保护共享物件:`orchestratePublish`、`asPublishResult`、`evaluateGate`、`canSubmit` 仍被活的批量路径使用(`batch-orchestrator.ts:387`、`background.ts:294`、`:146` 等),**不得删除**;清理其针对单条路径的注释(如 `publish-orchestrator.ts:45`「U4 单条隔离」)以反映新现实。
- R3. 衔接 grounding Phase 2(**整篇 reconcile,非只改一行**):退役决定与 grounding Phase 2 文档在 **7 处**耦合,其中 Key Decision 当前写的是**相反**的话。需一并改:
  - Problem Frame(line 15「单条发布路径 handlePublish 零闸」)、R9(line 43)、Success Criteria(line 52「单条…均经同一双求值闸」)、**Key Decision(line 67「单条路径下沉闸而非废弃:保留单条发布能力」→ 翻转为「单条路径退役」)**、Dependencies(line 72「能从页面回读 draft」→ 失效)、Outstanding Questions(lines 82/84 反向回读 draft → 关闭/作废)。
  - R12「全发布字段审计」不受影响(它针对批量路径的字段,仍存活)。
  - 责任归属(本工作 planning 一并改 vs Phase 2 自身 planning 改)见 Outstanding Questions。

**诚实硬化(作用于活的批量路径)**
- R4. 收紧 `asPublishResult` 为判别式形状(**fail-closed 防御未来 content 回归**,非修现行 bug):合法形状仅 = 成功 `{ok:true,dryRun:false,url?}` / 失败 `{ok:false,dryRun:false,error}`;其余一律降级为 `content-response-invalid`。规则含:`ok:true` ⇒ 无 `error`;`ok:false` ⇒ 须有可读 `error`;**authorized 授权发布回包出现 `dryRun:true` 视为非法(dry-run 由 orchestrator 上游合成,绝不经 content 回包)→ 降级**。必须仍接受现行真实成功形状(planning 加一条「真实 `executePublish` 成功形状仍过 `asPublishResult`」回归测试)。
- R5. `GateDecision` 增加**可读 `reason`**(`authorized`/`not-authorized`/`host-unreachable`/`off`/`dry-run`)——它是 `evaluateGate` 现有 `{mode, host, allowed}` 的**纯投影**:无新增 gate 分支、无新类型子系统、无新存储、无新 UI 组件。**关键 plumbing**:`GateDecision` 不跨消息边界到 side panel——批量路径的 host 阻断实际由 `orchestratePublish` 的 blocked 分支产 `error:"blocked"`、再经 `markPublishFailed(...,"blocked")` 落地。故 `reason` 必须**穿进那个 blocked 分支的 error 串**(如 `blocked:not-authorized` / `blocked:host-unreachable`)→ `markPublishFailed` + trajectory 呈现,否则「操作者能看出为什么被阻」的成功标准对活路径**不成立**。复用既有 side-panel gate-failed 文案位与 trajectory 结构。

## Success Criteria
- **唯一发布出口(可测)**:生产代码(排除测试)grep PUBLISH_GRANT **发送端恰好 1 处**(批量审批路径 `buildApproveDeps.sendGrant`)、**监听器恰好 1 处**(content `handlePublishGrant`)。建议固化为架构/守护测试,使「再加第二个发送端」会让 CI 红。
- **全 authorized 出口皆经闸(需证明,非断言)**:planning 枚举所有抵达 `orchestratePublish.sendGrant` 的调用点(`handleApproveBatch`、`handleApproveSingleItem`、`iterate`/`bypassReentry` 通道),逐一确认在 `mode==='authorized'` 时受 `checkGrounding` 守护;据此证明「不再有未过 grounding 双求值闸的 authorized 发布出口」,或把该判据收窄为「唯一已知裸奔出口 handlePublish 已删,其余 authorized 出口均经 checkGrounding-wired 批量 deps」。
- 批量路径不会因畸形 `{ok:true,error}` 或 `{ok:true,dryRun:true}` 记下假 `publish-confirmed`;现行真实成功形状仍正常确认。
- 发布被阻时操作者经 side panel/trajectory 看出**原因**(`not-authorized` vs `host-unreachable`),`host-unreachable` 给「请确认 tab 停在后台发帖页」可操作提示。
- 删除后 `pnpm -r test` + e2e 全绿;直接测 `orchestratePublish` 的既有套件(`publish-orchestrator.test.ts`、e2e `publish-gate.test.ts`)与批量套件不回归(它们不依赖被删的 `handlePublish`;`background.test.ts` 无 `handlePublish` 用例)。
- grounding Phase 2 文档 7 处耦合已 reconcile,两文档不脱节、无相反决策残留。

## Scope Boundaries
- 不为单条路径补齐崩溃恢复或 grounding 闸(选择**退役**而非补齐)。
- 不改批量崩溃恢复机制(tombstone→NHV)——已实现且健全。
- 不新增漂移检测能力。
- 不改 grounding 闸的判定逻辑本身(grounding Phase 1/2 范围)。
- 不引入新发布能力。**若**将来需要「一键发当前页」,须**重建**带启动恢复的逐 tab 派发/隔离脚手架(死路径正缺此恢复,故不是「un-delete」就够),且仍须经 grounding 闸——而非复活裸奔出口。

## Key Decisions
- **退役而非补齐单条路径**:它 UI 零调用、缺批量路径的安全。退役一刀拿下「消除裸奔 authorized 出口(安全)+ 删死代码(简洁)+ 塌缩 grounding Phase 2 R9 整个『从页面反向回读 draft + 建快照来源』子工程(省一大改)」。
- **诚实校正:这是「删掉一种能力」,不是「已被覆盖」**。`APPROVE_SINGLE_ITEM` 覆盖的是「发布一条**经批量生成 + grounding 的** item」(需 `awaiting-approval` 且有 `item.draft`);死路径的能力是「发布**当前页表单里任意内容、无批次无 grounding**」——二者**不等价**。被删的正是那个**未经 grounding 的裸奔能力**,这恰恰**强化**退役理由(我们本就想去掉它),而非「反正已覆盖」。
- **诚实校正:回退成本**。重建一键发当前页 = 重新推导逐 tab 派发/恢复脚手架(且要补上死路径所缺的启动恢复),比「un-delete」更重——死代码是个**不完整的模式**,不值得复活。
- **诚实硬化与退役解耦但同批做**:R4/R5 作用于活路径,价值独立于 R1–R3。
- **R4 用判别式降级而非抛错**(fail-closed,不让异常破坏批量循环)。注意 `asPublishResult` 跑在 sendGrant **之后**(content 可能已 POST `/admin/webarticle/save`),故「降级为失败」并非纯 fail-closed——见 Outstanding Questions 的 NHV 取舍。

## Dependencies / Assumptions
- 「`requestPublish` 无运行时调用方」**仅对已提交源码成立**(grep 仅命中其自身定义;entrypoints 仅 background/content/quill-bridge/sidepanel,无 popup/command/contextmenu 源);`.output/chrome-mv3-dev` 里的 `chrome.commands.onCommand` 是 **WXT dev-HMR 注入**,非应用代码(留记,免未来误判)。planning 删前仍应再核一次(含 `RuntimeMessage` 联合与 `background.test.ts`)。
- R3 需与 grounding Phase 2 协调:若 Phase 2 未进入实施,本次直接 reconcile 其 7 处;若已在实施,需通报避免重复建单条闸。
- R5 的 `reason` 为固定 enum;它若呈现 host 字串,该 host 即操作者自有授权域(side panel `BatchReviewPanel.tsx:188` 已字面显示 `authorizedHost`)——无新增敏感数据进 trajectory,既有快照脱敏范围不受影响。

## Outstanding Questions

### Deferred to Planning
- [Affects R4][Technical] 畸形/歧义 grant 回包(`content-response-invalid`)应记为 `error` 还是 `needs-human-verification`?因 `asPublishResult` 在 POST 之后跑,若 content 实际已发成功但回包被新校验拒,记 `error` 会污染去重集 → 操作者重试 → **重复发帖**。倾向 NHV 隔离(让人工确认),需 planning 定。
- [Affects R4][Technical] `asPublishResult` 当前**丢弃 `urlSource`** 字段,而 `published-posts-client.ts` 消费 `publishUrlSource`——R4 正好重写此函数,planning 决定是否在同一处保留 `urlSource`(确认丢弃是有意,或顺手修)。
- [Affects R5][Technical] `reason` 穿进 blocked error 串的具体编码(`blocked:<reason>` vs 结构化字段)与 trajectory `gateReason?` 落点;补 `off`/`dry-run` reason 的 `evaluateGate` 测试(现仅测 authorized/not-authorized/tab-closed)。
- [Affects R1][Security] 删除后断言 content `handlePublishGrant` 的**唯一可能发送端 = 批量路径**:用「唯一发送端守护测试」+ 复核 manifest 无 `externally_connectable`/`web_accessible_resources`/`onMessageExternal`(作为已核不变量写入,非假设)。
- [Affects R3][Process] grounding Phase 2 7 处 reconcile 的责任归属(本工作 planning 一并改,抑或 Phase 2 自身 planning),择一并记录,避免两处脱节。

## Next Steps
→ /ce:plan for structured implementation planning
