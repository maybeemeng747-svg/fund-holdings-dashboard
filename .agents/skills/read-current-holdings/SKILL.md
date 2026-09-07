---
title: Read Current Holdings
description: 读取当前持仓真源和板块映射
---

# Read Current Holdings

适用场景：当 investment-controller 或其他分析型 agent 在本项目中需要理解“当前持仓”时。

## Read Order

1. 先读取 `HOLDINGS_FILE` 指向的文件；未设置时读取 `portfolio/current_holdings.json`
2. 再读取 `portfolio/fund_sector_map.json`
3. 如需辅助回顾交易，可读取 `portfolio/transactions.json`
4. 如需确认最近一次更新来源与状态，可读取 `portfolio/update_log.json`
5. 如存在外部读取入口，优先接受 `/api/holdings`，但底层仍应与同一份 `HOLDINGS_FILE` 真源对齐

## Source Of Truth Rule

- `HOLDINGS_FILE` 指向的 JSON 是唯一当前持仓真源；未设置时默认为 `portfolio/current_holdings.json`
- 若与历史聊天、旧截图、旧笔记或记忆冲突，以 JSON 为准
- 不允许用聊天记忆覆盖 JSON 当前状态

## Confidence Rule

如果以下关键字段缺失，必须降低分析可信度并明确提示：

- `updated_at`
- `fund_name`
- `market_value`
- `shares`
- `cost_nav`
- `latest_nav`
- `holding_profit`

如果 `updated_at` 超过 7 天，必须提醒“持仓可能过旧，需要重新导入截图或更新真源”。

## Analysis Order

分析时按以下顺序展开：

1. 基于 `current_holdings.json` 计算总仓位、单基金权重、收益贡献
2. 基于 `fund_sector_map.json` 做风格 / 板块 / 仓位角色扩展
3. 区分：
   - core positions
   - tactical positions
   - auxiliary positions
4. 评估：
   - A-share market structure
   - volume and breadth
   - sector rotation
   - mapped fund style exposure

## Mapping Rule

- `fund_sector_map.json` 是市场结构分析代理映射，不是基金真实持仓完整重建
- 对主动混合基金，必须优先使用：
  - primary style
  - secondary style
  - confidence
- 不要把主动混合基金当成单一行业 ETF 来分析

## Output Rule

只有当条件清晰触发时才给动作建议，可选动作仅限：

- continue holding
- continue observing
- partial add
- partial reduce
- partial take-profit
- clear exit
