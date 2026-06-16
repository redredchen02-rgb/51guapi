# 51publisher 发帖页字段映射指南

> U0 现场勘查结果(2026-06-03,只读探查,未提交任何内容)。
> 勘查对象:文章(webarticle)添加表单。

## 勘查环境

- 后台域名:`dx-999-adm.ympxbys.xyz`(管理系统标题「51漫画管理系统 / 海角社区」)。
  - ⚠️ 子域含 `dx-999` 模式,疑似可能轮换;`host_permissions` 可能需要 `*://*.ympxbys.xyz/*` 而非写死单一子域(实现时确认)。
- 内容类型:**文章 webarticle**。列表页 `/admin/webarticle/index`。
- 发帖表单**不是独立页面**:`/admin/webarticle/add` 直接 GET 返回 JSON 错误(`{"status":0,"msg":"系统错误","crypt":true}`)。表单是点列表页工具栏「添加」按钮(`[lay-event="add"]`)由 JS 打开的 **layui 弹层(`.layui-layer-content` 内联,非 iframe)**。
  - 含义:**勘查当下**表单 DOM 在主文档顶层(同一 document);但表单是动态插入的,填充前需等弹层出现(或由操作员先点开「添加」,插件再填)。
  - ⚠️ **2026-06-10 再勘查已推翻上述「顶层」结论**(见 `docs/plans/2026-06-10-002`):发帖表单实际落在 layuiAdmin **同源子 iframe** 内,顶层 `document.querySelector` **必然落空**。这正是 `lib/frame-resolve.ts` 被引入的原因。
  - 现状(**frame-agnostic,勿再假设「一定在顶层」**):`content.ts` 与 `lib/body-responder.ts` 经 `lib/frame-resolve.ts` 解析表单所在 frame——**顶层优先,找不到则下钻同源 iframe**(跨源 iframe 无法访问,跳过)。字段「未找到」时,先确认弹层已打开,再看是否落在未被解析到的 frame。

## 正文编辑器(关键)

- **Quill,版本 `2.0.2`,主题 `ql-snow`,原生 vanilla(非 react-quill)。**
- **`window.Quill` = `function`(全局可用)** ✅ —— 所以 `Quill.find()` 可用。
- 编辑器容器:`#editor`(`.ql-container.ql-snow`),可编辑区 `.ql-editor[contenteditable=true]`。
- 实例可取回:`Quill.find(document.querySelector('#editor'))` 返回实例,且 `instance.clipboard.dangerouslyPasteHTML` 存在。
- **填充策略(确定):** 在**主世界**执行
  `Quill.find(document.querySelector('#editor')).clipboard.dangerouslyPasteHTML(已消毒HTML)`。
  - 因 `window.Quill` 在页面主世界,content script 隔离世界拿不到,仍需主世界桥(U5)。
  - **vanilla Quill 无 React 受控回写问题**——原计划的「react-quill re-render 覆盖」风险**不适用**。
  - **降级链的虚构 tier ② 不需要了**:tier ① 直接可用;兜底档基本用不上(仍保留作极端情形)。

## 字段映射(稳定选择器,均为 `name` 属性)

| 草稿字段      | 后台标签 | 选择器                                                         | 类型                             | 填充策略                                                                                                                                                                                                     |
| ------------- | -------- | -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| title         | 標題     | `input[name="title"]`                                          | text                             | set value + dispatch input/change                                                                                                                                                                            |
| subtitle      | 副標題   | `input[name="subtitle"]`                                       | text                             | 同上                                                                                                                                                                                                         |
| category      | 類型     | `select[name="type"]`                                          | **原生 `<select>`**              | set value + dispatch change。选项:`2`=漫畫文章,`4`=動漫文章(仅 2 项)                                                                                                                                         |
| body          | 文章内容 | `#editor`(Quill)                                               | quill                            | 见上「正文编辑器」                                                                                                                                                                                           |
| tags          | 標籤     | `input[name="tags[]"]`(checkbox 组,在 `div.tags-container` 内) | **checkbox 多选**(非 tag-input!) | 按标签名匹配对应 checkbox 并 `.click()`/勾选 + dispatch change。每项 `id="tag_<标签id>"`,`value=标签id`;label 文本在相邻节点。共约 3912 个标签,弹层内有搜索框 `input[placeholder="输入关键字自动筛选"]` 过滤 |
| coverImageUrl | 封面圖   | `input[type="file"][name="file"]`(旁有「上传」按钮)            | **file 上传**                    | **MVP 不填**,人工上传(与计划一致)                                                                                                                                                                            |

### 勘查中发现的额外字段(原 brainstorm 未列)

| 后台字段 | 选择器                         | 类型                                   | 备注              |
| -------- | ------------------------------ | -------------------------------------- | ----------------- |
| 作品 id  | `input[name="media_id"]`       | text                                   | 关联作品 id       |
| 狀態     | `select[name="status"]`        | select                                 | `0`=隐藏,`1`=显示 |
| 描述     | `textarea[name="description"]` | textarea                               | 文章描述/摘要     |
| 發佈時間 | `input[name="published_at"]`   | date(layui `x-date-time`,`yyyy-MM-dd`) | 日期选择器        |

> 这些字段是否纳入插件填充范围,是一个待你拍板的范围决策(见计划 Open Questions)。

## 零提交硬约束的现场结论(P0)

- **表单存在 `<form>`(`formsInLayer: 1`,title 有 form 祖先)** —— 所以理论上文本框里按回车可能触发原生提交。
- 但实际填充动作里:
  - 分类是 `<select>`(无回车提交风险);
  - **标签是 checkbox 勾选(`.click()`),不是「输入+回车」** —— 原计划担心的「tag-input 回车原生提交」**对本表单不适用**;
  - 标题/副标题只 set value + dispatch input/change,不 dispatch 回车。
- 结论:只要填充器**绝不 dispatch Enter/keydown 回车、绝不 `.click()` 提交/保存按钮**,本表单不会被填充动作触发提交。零提交断言(守 `submit` 事件=0 + 无导航)作为廉价保险继续保留。

## 后续实现注意

- 表单经 layui 弹层动态插入,且响应有 `crypt:true`(请求/响应可能加密)——插件**只做前端填充**,不碰其提交通道,所以加密不影响填充。
- 标签 label 与 checkbox 的精确 DOM 关联(相邻 `<label>` 还是 `label[for]`)实现时用 devtools 再确认一次(策略不变:按 label 文本匹配勾选)。
- 填充前确保「添加」弹层已打开(可由操作员先点开,或插件检测 `.layui-layer-content` 存在)。

## 如何按你的后台填写字段映射

字段映射在「设置 → 字段映射(JSON)」编辑,形如:

```json
{
  "title": { "selector": "input[name=\"title\"]", "fieldType": "text" },
  "category": { "selector": "select[name=\"type\"]", "fieldType": "native-select" },
  "tags": { "selector": "input[name=\"tags[]\"]", "fieldType": "checkbox-multi" },
  "body": { "selector": "#editor", "fieldType": "quill" }
}
```

找选择器的步骤:

1. 打开发帖表单,在目标字段上右键 →「检查」。
2. **优先用稳定属性**:`name` > `id` > `data-*` > `aria-label`;**避免**易变的 class 链。
3. 把选择器填进对应字段,`fieldType` 选下表之一。

| fieldType           | 适用                | 填充方式                                   |
| ------------------- | ------------------- | ------------------------------------------ |
| `text` / `textarea` | 普通输入框 / 多行框 | set value + input/change                   |
| `native-select`     | 原生 `<select>`     | 按 value 或选项文本匹配                    |
| `checkbox-multi`    | 一组 checkbox(标签) | 按标签文本匹配勾选                         |
| `date`              | 日期输入框          | set value + change                         |
| `quill`             | Quill 富文本        | 主世界 `Quill.find().dangerouslyPasteHTML` |

> 改完点「保存」会做 JSON + schema 校验;填错会给出可读报错,可点「恢复默认」回到现场勘查的版本。

## 后台改版时的可吸收范围(Tier 分级)

字段映射不是万能的。改版能不能"只改一处"取决于改了什么:

- **Tier-A —— 改 config 即可**:只是选择器变了(字段还在、形态没变,比如 `name` 改了)。在设置页改对应 selector,保存即可。
- **Tier-B —— 需改 `lib/fillers.ts` + config**:交互形态变了。例如分类从原生 `<select>` 变成自定义 combobox、标签从 checkbox 变成「输入+回车」的 tag-input。需要为新形态加/改填充器分支。
- **Tier-C —— 需改架构**:正文编辑器更换(Quill → TipTap/Slate 等)、字段进了 closed shadow DOM、字段动态/异步出现、表单变多步向导。这类要改 `quill-paste.ts` / `body-bridge.ts` 或填充时序,不是改配置能解决的。

遇到填充失效,先看 side panel「填充结果」面板:**跳过(未找到)**通常是 Tier-A(选择器失效),**需手动/降级**可能是 Tier-B/C。

> 改版修复闭环:改完字段映射(`lib/field-mapping.ts`,e2e 的 contract 会校验它)或填充器后,跑 `pnpm test:e2e` 看 contract 是否转绿,再按 [`docs/e2e-and-iteration-guide.md`](e2e-and-iteration-guide.md) 的「人工冒烟清单」在真后台核对一遍,最后回本指南更新选择器记录。
