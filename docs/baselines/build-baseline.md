# Build Performance Baseline

紀錄日期: 2026-06-16
Node: 20.x
pnpm: 9.x

## 測量結果

```bash
# pnpm --filter publisher-backend build   (冷快取)
# pnpm --filter publisher-fill-assistant build   (冷快取)
# pnpm --filter @51publisher/shared build        (冷快取)
```

> ⚠️ 基線值為一次性測量，啟動 CI 後應更新為實際 CI 環境數據。
>
> 建議用 `hyperfine --warmup 1` 在開發機上測三次取中位數。

## 目標閾值

| 構建目標 | 當前時間 | CI 目標 | 優化觸發線 |
|----------|----------|---------|-----------|
| `@51publisher/shared` | TBD | < 5s | > 10s |
| `publisher-backend` | TBD | < 15s | > 30s |
| `publisher-fill-assistant` | TBD | < 30s | > 60s |

## CI 構建時間歷史

| Commit | 日期 | Backend | Extension | Shared | 總和 |
|--------|------|---------|-----------|--------|------|
| 初次基線 | 2026-06-16 | TBD | TBD | TBD | TBD |

## 優化歷史

| 日期 | 變更 | 效果 |
|------|------|------|
| - | 基線 | - |