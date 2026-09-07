# 盘中/盘后分析结果写入规范

> Agent（investment-controller / macro / sentinel）产出的分析结论写入项目时的格式、路径和校验规则。

---

## 1. 写入路径

```
portfolio/
├── analysis/
│   ├── pre-market/          # 盘前分析（每个交易日一个文件）
│   │   └── YYYY-MM-DD.json
│   ├── intraday/            # 盘中检查
│   │   └── YYYY-MM-DD-HHmm.json
│   └── post-market/         # 盘后复盘
│       └── YYYY-MM-DD.json
```

## 2. 文件格式（JSON Schema）

```json
{
  "schema_version": "v1",
  "type": "pre-market | intraday | post-market",
  "date": "YYYY-MM-DD",
  "generated_at": "ISO-8601 timestamp",
  "generated_by": "agent-name",
  "market_snapshot": {
    "shanghai_index": { "value": 0, "change_pct": 0 },
    "shenzhen_index": { "value": 0, "change_pct": 0 },
    "chinext_index": { "value": 0, "change_pct": 0 },
    "total_volume_billion": 0,
    "volume_change_pct": 0
  },
  "portfolio_impact": [
    {
      "fund_code": "000000",
      "fund_name": "基金名称",
      "daily_change_pct": 0,
      "profit_impact": 0,
      "weight_pct": 0,
      "contribution_pct": 0,
      "trigger_hit": false,
      "trigger_type": null,
      "action_suggestion": "continue_holding | continue_observing | partial_add | partial_reduce | partial_take_profit | clear_exit",
      "confidence": "low | medium | medium_high | high"
    }
  ],
  "stock_impact": [
    {
      "stock_code": "000000",
      "stock_name": "股票名称",
      "daily_change_pct": 0,
      "profit_impact": 0,
      "trigger_hit": false,
      "action_suggestion": "continue_holding | continue_observing",
      "confidence": "medium"
    }
  ],
  "combined_summary": {
    "total_market_value": 0,
    "combined_daily_change_pct": 0,
    "combined_daily_profit": 0,
    "combined_holding_profit": 0
  },
  "risk_flags": [
    {
      "level": "info | warning | critical",
      "source": "fund_code or market",
      "message": "描述",
      "requires_action": false
    }
  ],
  "conclusion": {
    "action_required": false,
    "action_type": null,
    "action_targets": [],
    "reasoning": "简要说明",
    "confidence": "medium | medium_high"
  }
}
```

## 3. 写入规则

### 必须
- 文件名严格按日期/时间格式命名，不可覆盖已有文件
- `generated_by` 必须是 agent 注册名（investment-controller / macro / sentinel）
- `portfolio_impact` 必须覆盖当时 `current_holdings.json` 中的所有基金
- `stock_impact` 如果有股票持仓必须覆盖
- `trigger_hit` 为 true 时必须同时填 `trigger_type` 和 `action_suggestion`
- `conclusion.confidence` 不轻易给 "high"，默认 "medium" 或 "medium_high"

### 禁止
- ❌ 不可修改 `current_holdings.json`、`transactions.json`、`fund_sector_map.json`
- ❌ 不可删除已有的分析文件
- ❌ 不可在分析文件中伪造行情数据
- ❌ 不可把测试数据写入 `portfolio/analysis/`

### 可选
- `market_snapshot` 盘中检查时可以省略
- `stock_impact` 如果分析时段股票市场未开盘可以省略

## 4. Agent 调用方（OpenClaw 主控终审时）

主控终审整合后，将最终结论写入 `portfolio/analysis/post-market/YYYY-MM-DD.json`，格式同上，`generated_by` 为 `main-controller`。

## 5. 读取规则

- Agent 每次分析前先读取 `portfolio/analysis/` 下最新的文件，获取上一轮结论
- 如果 `current_holdings.json` 的 `updated_at` 比上次分析时变化了，必须重新基于新持仓做分析
- 历史分析文件仅供回溯，不作为当前决策的依据

## 6. 清理规则

- 分析文件保留最近 30 个交易日
- 超过 30 天的可在 heartbeat 中清理（移到 `portfolio/analysis/archive/`）
