import test from "node:test";
import assert from "node:assert/strict";
import { stockSinaSymbol, parseSinaStockQuoteResponse } from "../src/stock-service.js";

test("direct stock symbols preserve HK leading zeros and A-share markets", () => {
  assert.equal(stockSinaSymbol("00700"), "hk00700");
  assert.equal(stockSinaSymbol("600000"), "sh600000");
  assert.equal(stockSinaSymbol("000001"), "sz000001");
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
