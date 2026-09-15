import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStockQuote,
  calculateTushareMovingAverages,
  parseTushareTable,
  parseSinaMovingAverages,
  stockSinaSymbol,
  stockTushareCode,
  parseSinaStockQuoteResponse,
} from "../src/stock-service.js";

test("direct stock symbols preserve HK leading zeros and A-share markets", () => {
  assert.equal(stockSinaSymbol("00700"), "hk00700");
  assert.equal(stockSinaSymbol("600000"), "sh600000");
  assert.equal(stockSinaSymbol("000001"), "sz000001");
});

test("Tushare symbols cover Shanghai, Shenzhen and Beijing stocks", () => {
  assert.equal(stockTushareCode("603629"), "603629.SH");
  assert.equal(stockTushareCode("000001"), "000001.SZ");
  assert.equal(stockTushareCode("430047"), "430047.BJ");
  assert.equal(stockTushareCode("00700"), null);
});

test("Tushare table and daily bars provide previous close, MA5 and MA20", () => {
  const table = parseTushareTable({
    code: 0,
    data: { fields: ["ts_code", "close"], items: [["603629.SH", 21]] },
  });
  assert.deepEqual(table, [{ ts_code: "603629.SH", close: 21 }]);

  const rows = Array.from({ length: 20 }, (_, index) => ({
    trade_date: `202608${String(index + 10).padStart(2, "0")}`,
    close: index + 1,
  }));
  const result = calculateTushareMovingAverages(rows, 21, "2026-09-01 15:00:00");
  assert.deepEqual(result, {
    prev_close: 20,
    ma5: 19,
    ma20: 11.5,
    ma_as_of: "2026-09-01",
  });
});

test("HK stock response uses HK field positions", () => {
  const stock = { stock_code: "00700", shares: 100, cost_price: 80 };
  const response = 'var hq_str_hk00700="EXAMPLE,Example,99,100,110,98,105,5,5,104,105,105000,1000,0,0,120,70,2026/09/07,16:08";';
  const quote = parseSinaStockQuoteResponse(stock, response);
  assert.equal(quote.current_price, 105);
  assert.equal(quote.prev_close, 100);
  assert.equal(quote.open, 99);
  assert.equal(quote.volume, 1000);
  assert.equal(quote.amount, 105000);
  assert.equal(quote.display_daily_profit, 500);
  assert.equal(quote.display_daily_change_pct, 5);
  assert.equal(parseSinaStockQuoteResponse(stock, 'var hq_str_hk00700="";'), null);
});

test("watchlist-style code and name fields are normalized for quotes", () => {
  const quote = normalizeStockQuote({ code: "000001", name: "平安银行", current_price: 12.34 });
  assert.equal(quote.stock_code, "000001");
  assert.equal(quote.stock_name, "平安银行");
  assert.equal(quote.current_price, 12.34);
});

test("Sina daily bars calculate MA5 and MA20", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    close: String(index + 1),
  }));
  const result = parseSinaMovingAverages(`var data=(${JSON.stringify(rows)})`);
  assert.deepEqual(result, { ma5: 18, ma20: 10.5, ma_as_of: "2026-09-20" });
  assert.equal(parseSinaMovingAverages("bad response"), null);
});
