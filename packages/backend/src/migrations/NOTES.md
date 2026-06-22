# Migration Notes

## Numbering Gaps

- `001-initial.sql` — 初始 schema
- `008-add-domain.sql` — 添加 domain 字段

002–007 不存在。這些 migration 在開發過程中被 squash 或取代，編號跳空不影響運行（runner.ts 按文件名排序執行）。

## 如何新增 Migration

```sql
-- 命名慣例: XXX-description.sql (XXX = 數字，自動排序)
```
