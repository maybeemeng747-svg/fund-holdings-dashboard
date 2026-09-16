import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptDashboardPortfolioToWorkspace,
  adaptWorkspacePortfolioToDashboard,
  buildDashboardPayload,
} from "../src/portfolio-store.js";
import { buildDiff, extractPortfolioFromScreenshot, validateImportPayload } from "../src/import-service.js";
import { buildImportAdvisories } from "../src/import-quality.js";
import { mergeFundHoldings } from "../src/portfolio-merge.js";
import { normalizeStockQuote, parseSinaStockQuoteResponse } from "../src/stock-service.js";

test("dashboard payload contains summary and holdings", async () => {
  const payload = await buildDashboardPayload({ includeRealtime: false });
  assert.equal(typeof payload.summary.total_market_value, "number");
  assert.equal(typeof payload.summary.portfolio_daily_change_pct, "number");
  assert.ok(payload.holdings.length >= 1);
  assert.ok(payload.holdings.every((item) => item.fund_name));
  assert.ok(payload.holdings.some((item) => item.position_role));
  assert.ok(payload.holdings.some((item) => item.current_nav_date || item.current_nav));
  assert.ok(["manual_template", "screenshot_import"].includes(payload.data_source.source_type));
  assert.match(payload.data_source.source_file, /current_holdings\.json$/);
  assert.ok("latest_confirmed_nav_date" in payload.data_source);
});

test("workspace holdings schema maps to dashboard holdings schema", () => {
  const payload = adaptWorkspacePortfolioToDashboard({
    updated: "2026-07-14",
    snapshot_time: "18:53",
    updated_by: "manual_screenshot_update",
    account: {
      total_assets: 2000,
      total_market_value: 1500,
      available_cash: 500,
      position_pct: 75,
      daily_pnl: 12.3,
      daily_change_pct: 0.82,
      total_pnl: -45.6,
    },
    holdings: {
      stocks: [
        {
          code: "600000",
          name: "示例股份",
          type: "stock",
          shares: 10,
          available_shares: 10,
          cost_price: 12,
          current_price: 11,
          market_value: 110,
          profit: -10,
          profit_pct: -8.33,
          daily_profit: 2,
          daily_change_pct: 1.85,
        },
      ],
      funds: [
        {
          code: "000001",
          name: "示例基金C",
          type: "fund",
          shares: 100,
          cost_nav: 1.1,
          latest_nav: 1.2,
          nav_date: "2026-07-13",
          market_value: 120,
          profit: 10,
          profit_pct: 9.09,
          daily_profit: -1,
          daily_change_pct: -0.8,
        },
      ],
    },
  });

  assert.equal(payload.updated_at, "2026-07-14T18:53:00+08:00");
  assert.equal(payload.summary.total_market_value, 1500);
  assert.equal(payload.summary.available_cash, 500);
  assert.equal(payload.summary.position_pct, 75);
  assert.deepEqual(payload.stocks[0], {
    stock_code: "600000",
    stock_name: "示例股份",
    shares: 10,
    available_shares: 10,
    cost_price: 12,
    current_price: 11,
    market_value: 110,
    profit: -10,
    profit_pct: -8.33,
    daily_profit: 2,
    daily_change_pct: 1.85,
    asset_type: "stock",
  });
  assert.equal(payload.holdings[0].fund_code, "000001");
  assert.equal(payload.holdings[0].fund_name, "示例基金C");
  assert.equal(payload.holdings[0].holding_profit, 10);
  assert.equal(payload.holdings[0].holding_profit_rate, 9.09);
  assert.equal(payload.holdings[0].yesterday_profit, -1);
});

test("dashboard import schema maps back to workspace holdings schema and recalculates account", () => {
  const payload = adaptDashboardPortfolioToWorkspace(
    {
      account: {
        total_assets: 2000,
        total_market_value: 1500,
        available_cash: 500,
      },
      holdings: {
        stocks: [
          {
            code: "600000",
            name: "示例股份",
            type: "stock",
            shares: 10,
            available_shares: 10,
            cost_price: 12,
            current_price: 11,
            market_value: 110,
            profit: -10,
            profit_pct: -8.33,
            daily_profit: 2,
            daily_change_pct: 1.85,
          },
        ],
        funds: [],
        indexes: [{ code: "000300", name: "沪深300" }],
      },
    },
    [
      {
        fund_code: "000001",
        fund_name: "示例基金C",
        shares: 100,
        cost_nav: 1.1,
        latest_nav: 1.2,
        nav_date: "2026-07-13",
        market_value: 120,
        holding_profit: 10,
        holding_profit_rate: 9.09,
        yesterday_profit: -1,
        daily_change_pct: -0.8,
      },
    ],
    {
      now: new Date("2026-07-14T10:11:12+08:00"),
      updated_by: "dashboard_confirmed_import",
    },
  );

  assert.equal(payload.updated, "2026-07-14");
  assert.equal(payload.updated_by, "dashboard_confirmed_import");
  assert.equal(payload.holdings.stocks.length, 1);
  assert.equal(payload.holdings.indexes.length, 1);
  assert.equal(payload.holdings.funds[0].code, "000001");
  assert.equal(payload.holdings.funds[0].profit, 10);
  assert.equal(payload.holdings.funds[0].daily_profit, -1);
  assert.equal(payload.account.total_market_value, 230);
  assert.equal(payload.account.total_assets, 730);
  assert.equal(payload.account.position_pct, 31.51);
  assert.equal(payload.account.daily_pnl, 1);
  assert.equal(payload.account.total_pnl, 0);
});

test("dashboard holdings updates preserve the existing watchlist", () => {
  const watchlist = [
    { code: "603629", name: "利通电子" },
    { code: "603823", name: "百合花" },
  ];
  const payload = adaptDashboardPortfolioToWorkspace(
    { holdings: { stocks: [], funds: [] }, watchlist },
    [{ fund_code: "000001", fund_name: "示例基金", market_value: 100 }],
  );

  assert.deepEqual(payload.watchlist, watchlist);
});

test("confirm payload validation rejects unconfirmed writes", () => {
  assert.throws(() => validateImportPayload({ confirmed: false, holdings: [] }), /必须经过用户确认/);
});

test("partial fund import preserves unrelated holdings", () => {
  const merged = mergeFundHoldings(
    [
      { fund_code: "000001", fund_name: "示例基金A", market_value: 100 },
      { fund_code: "000002", fund_name: "示例基金B", market_value: 200 },
    ],
    [{ fund_code: "000001", fund_name: "示例基金A", market_value: 125 }],
  );

  assert.deepEqual(merged, [
    { fund_code: "000001", fund_name: "示例基金A", market_value: 125 },
    { fund_code: "000002", fund_name: "示例基金B", market_value: 200 },
  ]);
});

test("partial import requires a fund identity", () => {
  assert.throws(
    () => validateImportPayload({
      confirmed: true,
      import_scope: "partial",
      holdings: [{ market_value: 100 }],
    }),
    /基金代码或基金名称/,
  );
});

test("extract flow rejects empty upload", async () => {
  await assert.rejects(() => extractPortfolioFromScreenshot({ imageDataUrl: "" }), /请先上传截图/);
});

test("diff ignores tiny OCR numeric drift by tolerance", () => {
  const diff = buildDiff(
    {
      holdings: [
        {
          fund_name: "示例基金",
          fund_code: "000001",
          market_value: 1000,
          cost_nav: 1.1234,
          latest_nav: 1.2345,
          daily_change_pct: 0.56,
        },
      ],
    },
    [
      {
        fund_name: "示例基金",
        fund_code: "000001",
        market_value: 1000.3,
        cost_nav: 1.1237,
        latest_nav: 1.2348,
        daily_change_pct: 0.565,
      },
    ],
  );
  assert.equal(diff.changed.length, 0);
});

test("high priority missing fields degrade advisory confidence", () => {
  const advisory = buildImportAdvisories([
    {
      fund_name: "示例基金",
      missing_fields: ["shares", "cost_nav"],
      suspicious_fields: ["action_confidence_degraded"],
    },
  ]);
  assert.equal(advisory.confidence_level, "degraded");
  assert.match(advisory.warnings.join(" "), /动作建议可信度下降/);
});

test("stock quote fallback preserves local holding display fields", () => {
  const stock = normalizeStockQuote({
    stock_code: "600000",
    stock_name: "示例股份",
    shares: 100,
    available_shares: 100,
    cost_price: 12,
    current_price: 10,
    market_value: 1000,
    profit: -200,
    profit_pct: -16.67,
  });

  assert.equal(stock.stock_code, "600000");
  assert.equal(stock.display_name, "示例股份");
  assert.equal(stock.display_market_value, 1000);
  assert.equal(stock.display_holding_profit, -200);
  assert.equal(stock.display_holding_profit_rate, -16.67);
  assert.equal(stock.quote_status, "local_fallback");
});

test("stock quote fallback preserves local daily profit", () => {
  const stock = normalizeStockQuote({
    stock_code: "600000",
    stock_name: "示例股份",
    shares: 100,
    current_price: 10,
    market_value: 1000,
    daily_profit: 25,
  });

  assert.equal(stock.display_daily_profit, 25);
  assert.equal(stock.quote_status, "local_fallback");
});

test("zero-valued Sina stock quote is rejected", () => {
  const response = `var hq_str_sh600000="示例股份,10,10,0,10,9,0,0,100,1000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-07-30,09:25:00,00";`;
  const quote = parseSinaStockQuoteResponse(
    { stock_code: "600000", stock_name: "示例股份", shares: 100 },
    response,
  );

  assert.equal(quote, null);
});

test("realtime stock quote overrides local price without dropping holding data", () => {
  const stock = normalizeStockQuote(
    {
      stock_code: "000002",
      stock_name: "示例科技",
      shares: 100,
      cost_price: 20,
      current_price: 15,
      market_value: 1500,
      profit: -500,
      profit_pct: -25,
    },
    {
      stock_name: "示例科技",
      display_name: "示例科技",
      current_price: 14,
      prev_close: 13.8,
      display_market_value: 1400,
      display_daily_change_pct: 1.4493,
      display_daily_profit: 20,
      display_holding_profit: -600,
      display_holding_profit_rate: -30,
    },
  );

  assert.equal(stock.current_price, 14);
  assert.equal(stock.display_market_value, 1400);
  assert.equal(stock.display_daily_profit, 20);
  assert.equal(stock.display_holding_profit, -600);
  assert.equal(stock.quote_status, "realtime");
});

test("invalid realtime numbers fall back to local stock holding values", () => {
  const stock = normalizeStockQuote(
    {
      stock_code: "600001",
      stock_name: "示例能源",
      shares: 100,
      current_price: 16,
      market_value: 1600,
      profit: -400,
      profit_pct: -20,
    },
    {
      stock_name: "示例能源",
      current_price: Number.NaN,
      display_market_value: Number.NaN,
      display_holding_profit: Number.NaN,
    },
  );

  assert.equal(stock.current_price, 16);
  assert.equal(stock.display_market_value, 1600);
  assert.equal(stock.display_holding_profit, -400);
});
