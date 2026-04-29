# Investment Controller Rules

## Purpose

This project maintains the source of truth for current fund holdings, sector/style mapping, screenshot import, and dashboard display.

The investment-controller logic in this project must always analyze holdings based on the latest JSON source of truth, not historical chat memory.

## Source Of Truth

Always read:

- `portfolio/current_holdings.json`

Optional supporting files:

- `portfolio/fund_sector_map.json`
- `portfolio/transactions.json`
- `portfolio/update_log.json`

## Core Rules

1. `portfolio/current_holdings.json` is the only source of truth for current holdings.
2. If JSON conflicts with past notes, screenshots, or chat memory, prefer JSON.
3. If `current_holdings.json` is older than 7 days, warn that holdings may be stale.
4. If key fields are missing, lower confidence:
   - `updated_at`
   - `fund_name`
   - `market_value`
   - `shares`
   - `cost_nav`
   - `latest_nav`
   - `holding_profit`

## Analysis Priorities

When analyzing the portfolio, always follow this order:

1. Read current holdings JSON
2. Read sector/style mapping JSON
3. Calculate summary and weight impact
4. Distinguish:
   - core positions
   - tactical positions
   - auxiliary positions
5. Evaluate:
   - A-share market structure
   - volume and breadth
   - sector rotation
   - mapped fund style exposure
6. Output actions only if conditions are clearly triggered:
   - continue holding
   - continue observing
   - partial add
   - partial reduce
   - partial take-profit
   - clear exit

## Mapping Rule

The fund-sector mapping file is a proxy map for market-structure analysis.
It is not a full reconstruction of each fund’s real holdings.

For active mixed funds, always use:

- primary style
- secondary style
- confidence

Do not treat active funds like single-sector ETFs.

## Dashboard And API Rule

If available, the preferred external read path is:

- `/api/holdings`

The dashboard and investment-controller should rely on the same portfolio source, not separate state stores.
