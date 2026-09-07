import test from "node:test";
import assert from "node:assert/strict";

import { buildHoldingRealtime } from "../src/realtime-service.js";

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test("confirmed-day estimate computes daily profit from previous NAV", async () => {
  const result = await buildHoldingRealtime(
    {
      fund_code: "000001",
      fund_name: "示例基金",
      shares: 100,
      cost_nav: 0.9,
    },
    {
      fundcode: "000001",
      _source: "pingzhongdata",
      _prev_nav: 1,
      _confirmed_return: 10,
      jzrq: todayShanghai(),
    },
    {
      fund_code: "000001",
      fund_name: "示例基金",
      shares: 100,
      cost_nav: 0.9,
      confirmed_nav: 1.1,
      confirmed_nav_date: todayShanghai(),
      confirmed_market_value: 110,
      confirmed_holding_profit: 20,
      confirmed_holding_profit_rate: 22.22,
    },
    {
      fundCode: "000001",
      estimateFundNavFn: async () => ({
        estimated_nav: 1.1,
        estimated_change_pct: 10,
        holdings_used: 1,
        holdings_total: 1,
        coverage_pct: 60,
        as_of: new Date().toISOString(),
        report_date: "2026-06-30",
        in_trading_hours: true,
        details: [],
      }),
    },
  );

  assert.equal(result.display_market_value, 110);
  assert.equal(result.display_daily_profit, 10);
});
