# 自动批量生成指南

## 概述

自动批量生成功能可以从待审选题池中自动提取事实、搜索富化、生成草稿，减少人工干预。

## API

### POST /api/v1/scraper/auto-generate

自动从待审选题池生成草稿。

**请求体**:
```json
{
  "minConfidence": 0.5,
  "maxItems": 5,
  "enableEnrichment": true
}
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| minConfidence | number | 0.5 | 最低置信度阈值 |
| maxItems | number | 5 | 单次最多生成数 |
| enableEnrichment | boolean | true | 是否启用 Web 搜索富化 |

**响应**:
```json
{
  "ok": true,
  "generated": 3,
  "skipped": 1,
  "errors": 0,
  "drafts": [
    {
      "topicId": "scrape_xxx",
      "title": "作品标题",
      "facts": { "作品名": "...", "制作": "..." },
      "enrichment": "【网络参考资料】..."
    }
  ]
}
```

## 质量门禁

生成的草稿会经过质量评估，检查维度：

| 检查项 | 通过条件 | 说明 |
|--------|----------|------|
| body_length | ≥ 150 字 | 正文纯文本长度 |
| facts_completeness | ≥ 50% | 核心字段填充率 |
| title_quality | 无【待补】 | 标题完整性 |
| community_tone | ≥ 2 个社区词汇 | 口语化程度 |
| tags_accuracy | 2-10 个标签 | 标签数量 |

## 质量监控

### GET /api/v1/healthz

健康检查响应中包含质量统计：

```json
{
  "ok": true,
  "quality": {
    "avgScore": 0.75,
    "passRate": 0.85,
    "totalGenerations": 120,
    "recentScores": [0.8, 0.7, 0.9, ...]
  }
}
```

## 配置

在 `.env` 中配置：

```bash
# 启用/禁用 Web 搜索富化
ENRICHMENT_ENABLED=true

# 每个作品最多搜索次数（1-10）
ENRICHMENT_MAX_QUERIES=3
```

## 使用示例

```bash
# 1. 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}' | jq -r '.token')

# 2. 触发自动批量生成
curl -s -X POST http://localhost:3001/api/v1/scraper/auto-generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"minConfidence": 0.5, "maxItems": 5}' | jq .

# 3. 查看质量统计
curl -s http://localhost:3001/api/v1/healthz | jq .quality
```
