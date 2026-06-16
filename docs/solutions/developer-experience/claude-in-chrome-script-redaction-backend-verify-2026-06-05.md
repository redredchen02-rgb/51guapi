---
title: '用 claude-in-chrome 核验后台契约时,脚本字面值被打码——改用结构+行为间接确认'
date: 2026-06-05
category: docs/solutions/developer-experience
module: stage-0 backend contract verification (R0/R2)
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - 用 claude-in-chrome 的 javascript_tool / read 工具勘查页面脚本或网络
  - 需要从压缩(minified)或内联 JS 里提取端点 URL、字段绑定等字面值
  - 对第三方/自家后台做只读契约核验(提交端点、字段集、提交方式)
tags: [claude-in-chrome, browser-automation, redaction, backend-contract, javascript-tool, layui, verification]
---

# 用 claude-in-chrome 核验后台契约时,脚本字面值被打码——改用结构+行为间接确认

## Context

阶段 0 的 R0 要在写任何发布代码前,只读核验 `dx-999-adm.ympxbys.xyz` 后台契约是否漂移:
保存端点(`POST /admin/webarticle/save`)、提交方式、字段集、Quill 编辑器是否还在。
做法是用 `mcp__claude-in-chrome__javascript_tool` 在已登录的后台页里跑只读 JS,
读 inline 脚本 + fetch 同源 JS 去 grep `webarticle/save`,以确认保存端点与提交方式。

## Guidance

**claude-in-chrome 的工具会对返回内容做敏感数据打码**:压缩/内联 JS、含 cookie 或长 base64 的字符串
会被替换成 `[BLOCKED: Cookie/query string data]` 或 `[BLOCKED: Base64 encoded data]`。
所以**直接从脚本体里抠端点 URL 字面值会拿到一片打码**,即使该 URL 本身并不敏感。

不要硬刚去读字面值。改为**用页面结构 + 运行时行为信号间接确认契约**:

- **字段集**:打开表单(layui 是 `[lay-event="add"]` 触发的 layer,只开 modal、不提交),
  枚举 `form.querySelectorAll('input,select,textarea')` 的 `name` —— 字段名不会被打码。
- **提交方式**:不真提交,改在脚本里做**布尔检测**而非取字面值:
  `/\$\.post|type\s*:\s*['"]post['"]/i.test(saveCtxSnippet)` → 返回 `true/false`,不触发打码。
- **端点存在性**:用 `inline.indexOf('webarticle/save') >= 0` 这种**存在性判断**(返回 index/布尔),
  而不是把含该串的片段整段返回(整段会被打码)。
- **选项/枚举**:`status` 草稿态、`type` 分类等 `<option>` 的 `value:text` 也可直接读,不打码。
- **清理**:勘查完 `layui.layer.closeAll()` 关掉打开的 modal;**全程不要真提交**(真建帖=不可逆写,
  且会留垃圾——本项目已有 110/111/112 三条遗留测试帖的前车之鉴)。

最终对"编码是否 urlencoded""save 是否真成功"这类**只有真提交才能 100% 确认**的点,
明确标注为"待真发时确认"(留给 R2 首飞),而不是为了凑确定性去真提交。

## Why This Matters

- 直觉做法(grep 脚本拿 URL)在这套工具下**必然失败**,会浪费几轮 tool call 撞打码。
- 间接确认法用一次只读 JS 就能拿全契约结论(字段全在、走 `$.post`、Quill 在、草稿态在),
  且**零写入、零副作用**——符合"只读勘查、不替用户做不可逆操作"的安全边界。
- 把"只有真提交能确认的点"诚实降级为待验证,避免为虚假的完整性去真发帖。

## When to Apply

- 每次后台可能改版、需重核契约时(R0),或类似的第三方页面契约勘查
- 任何"想从压缩 JS / 含敏感串的脚本里读字面值"的 claude-in-chrome 场景

## Examples

**踩坑(字面值被打码):**

```js
// 想直接拿端点片段 → 整段被打码,读不出 URL
const i = inline.search(/webarticle\/save/i);
inline.slice(
  i - 120,
  i + 80,
)(
  // → "[BLOCKED: Cookie/query string data]"

  inline.match(/admin\/webarticle\/[a-z_]+/gi) || [],
);
// → ["[BLOCKED: Base64 encoded data]", ...]   ← 路径数组也被整体打码
```

**绕法(返回结构与布尔,不返回敏感字面):**

```js
const saveCtx = (() => {
  const i = inline.search(/webarticle\/save/i);
  return i < 0 ? '' : inline.slice(i - 200, i + 40);
})();
const out = {
  endpointPresent: inline.indexOf('webarticle/save') >= 0, // 布尔,不打码
  saveUsesPost: /\$\.post|type\s*:\s*['"]post['"]/i.test(saveCtx), // 布尔,不打码
  fields: [...form.querySelectorAll('[name]')].map((e) => e.name), // 字段名,不打码
  statusOptions: [...form.querySelectorAll('[name=status] option')].map((o) => `${o.value}:${o.textContent.trim()}`), // 0:隐藏/1:显示
};
// → { endpointPresent:true, saveUsesPost:true, fields:[media_id,title,...], ... }
```

实战结论(2026-06-05):契约基本一致;附带发现 3 处 drift —— 新增 `cover_url`(hidden)字段、
`tags[]` 增至 3912 个、后台品牌名显示「海角社区」(但用户确认内容口吻仍是「51娘」)。

## Related

- 阶段 0 数据表(R0 结果):`docs/stage0-baseline-worksheet.md`
- 阶段 0 计划 Unit 1:`docs/plans/2026-06-05-001-feat-stage0-premise-baseline-plan.md`
- 需求文档(R0/R2 背景):`docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md`
- 项目记忆:`content-quality-gated-baseline`、`repo-ops-gotchas`
