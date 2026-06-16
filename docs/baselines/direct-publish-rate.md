# 直发率基准规则

建立时间：2026-06-11  
数据来源：`TrajectoryRecord.hasManualEdit`（`mode === 'authorized'` 时写入）

## 定义

**直发率** = `authorized` 档位下，`hasManualEdit === false` 的已发布条目数 / 总已发布条目数

## 计算方式

```
records = trajectory.filter(r => r.mode === 'authorized' && r.status === 'publish-confirmed')
directPublishRate = records.filter(r => !r.hasManualEdit).length / records.length
```

`hasManualEdit` 为 `undefined`（旧记录未迁移）时，视为 `false`（直发）处理。

## 基准阶段（尚无历史数据）

首批 `authorized` 记录落档后开始采集。基准值以前 7 天滚动窗口计算。

预期目标：≥ 70%（草稿无需手动修改即可直接发布）。  
告警阈值：连续 3 条均为 `hasManualEdit === true` → 提示操作者检查 LLM prompt 质量。

## 字段附加信息

| 字段 | 类型 | 说明 |
|---|---|---|
| `hasManualEdit` | `boolean \| undefined` | 仅 `authorized` 档位写入；`undefined` = 旧记录 |
| `llmCostTokens` | `{ prompt, completion, estimated? }` | `estimated: true` 表示字符数估算 |
| `generationDurationMs` | `number` | 单条生成耗时（毫秒） |

## 使用场景

- 评估 LLM 生成质量：直发率下降 → 草稿质量变差 → 调整 prompt template
- 成本分析：`llmCostTokens` 对账每批次 token 消耗
- 性能监控：`generationDurationMs` 追踪生成延迟趋势
