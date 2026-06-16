# Dry-Run 策略文档

## 概述

Dry-run 模式允许在不触发真实发布的情况下，完整验证批量发布流程。此时填充表单和模拟发布动作，但不会实际提交到后台数据库。

## 触发时机

`saveDryRunReport` 在 `approveBatch` 执行完 dry-run 批准后调用:

1. 批次状态为 `awaiting-approval` 且 `safetyMode === 'dry-run'`
2. 所有 `awaiting-approval` 条目完成填充循环
3. 循环结束后构建 `DryRunReport` 对象并持久化

```ts
// lib/batch-orchestrator.ts:192-195
if (dryRunItems.length > 0 && saveDryRunReportFn) {
  const report: DryRunReport = { batchId: batch.id, ts: new Date().toISOString(), items: dryRunItems };
  saveDryRunReportFn(report).catch((e) => console.warn('[batch-orchestrator] saveDryRunReport 失败(best-effort)', e));
}
```

## 存储位置

- **Key**: `local:dryRunReport` (chrome.storage.local)
- **结构**:
  ```ts
  {
    batchId: string,
    ts: string,        // ISO timestamp
    items: DryRunItemResult[]
  }
  ```

## 持久化策略

- **Best-effort 写入**: 写入失败不会阻塞流程
- **失败处理**: 控制台警告日志，不抛出异常
- **原因**: Storage 操作不应成为关键路径瓶颈

## 清理策略

1. **自动覆盖**: 新批次 dry-run 批准时自动覆盖旧报告
2. **手动清除**: Side Panel 「清除报告」按钮 → `clearDryRunReport()`
3. **切换档位**: 从 `dry-run` 切换到 `authorized`/`off` 时，报告保留（下次 dry-run 覆盖）

## Side Panel 展示逻辑

`DryRunReport` 组件 (`entrypoints/sidepanel/DryRunReport.tsx`):

- 持续监听 `safetyMode === 'dry-run'` 时渲染
- 从 `getDryRunReport()` 读取最新报告
- 显示每个条目的填充统计:
  - ✓ 已填: 所有字段填充成功
  - ↷ 跳过: 选择器未找到
  - ⚠ 降级: innerHTML 降级填充（格式可能丢失）

## 与 authorized 模式的区别

| 场景         | dry-run  | authorized         |
| ------------ | -------- | ------------------ |
| 表单填充     | ✓ 执行   | ✓ 执行             |
| 发布动作     | ✓ 模拟   | ✓ 真实提交         |
| 轨迹记录     | ✗ 不写入 | ✓ 写入             |
| DryRunReport | ✓ 生成   | ✗ 不生成           |
| 选题去重     | ✗ 不记录 | ✓ 记录             |
| 手势确认     | ✗ 无需   | ✓ 需输入 `publish` |
