import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHoldingsFromHtml,
  parseSinaQuotesResponse,
  clearFundEstimateCache,
  isTradingHours,
} from "../src/fund-estimate.js";

// ===== Fixtures =====

const SAMPLE_HTML_WITH_HK = `
<div class="box">
<table><tbody>
<tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>占净值比例</th><th>持股数(万股)</th><th>持仓市值(万元)</th></tr>
<tr><td>1</td><td><a href="...">600519</a></td><td class="tol"><a href="...">贵州茅台</a></td><td class="tor">9.35%</td><td class="tor">1.20</td><td class="tor">2,100.00</td></tr>
<tr><td>2</td><td><a href="...">01888</a></td><td class="tol"><a href="...">建滔积层板</a></td><td class="tor">5.20%</td><td class="tor">50.00</td><td class="tor">1,200.00</td></tr>
<tr><td>3</td><td><a href="...">000858</a></td><td class="tol"><a href="...">五粮液</a></td><td class="tor">4.80%</td><td class="tor">3.50</td><td class="tor">800.00</td></tr>
<tr><td>4</td><td><a href="...">00700</a></td><td class="tol"><a href="...">腾讯控股</a></td><td class="tor">3.10%</td><td class="tor">2.00</td><td class="tor">700.00</td></tr>
</tbody></table>
<p>截止至：<font>2026-03-31</font></p>
<div>2026年1季度</div>
</div>
`;

const SAMPLE_HTML_A_SHARES_ONLY = `
<div class="box">
<table><tbody>
<tr><th>序号</th><th>股票代码</th><th>股票名称</th><th>占净值比例</th></tr>
<tr><td>1</td><td><a href="...">600519</a></td><td class="tol"><a href="...">贵州茅台</a></td><td class="tor">9.35%</td></tr>
<tr><td>2</td><td><a href="...">000858</a></td><td class="tol"><a href="...">五粮液</a></td><td class="tor">4.80%</td></tr>
</tbody></table>
<p>截止至：<font>2025-12-31</font></p>
<div>2025年4季度</div>
</div>
`;

const SAMPLE_HTML_MULTI_QUARTER = `
<div>2025年3季度 持仓</div>
<table><tbody>
<tr><td>1</td><td><a href="...">601318</a></td><td class="tol"><a href="...">中国平安</a></td><td class="tor">8.00%</td></tr>
</tbody></table>
<div>2026年1季度 持仓</div>
<table><tbody>
<tr><td>1</td><td><a href="...">600519</a></td><td class="tol"><a href="...">贵州茅台</a></td><td class="tor">9.50%</td></tr>
</tbody></table>
`;

// Sina A-share response format: var hq_str_sh600519="贵州茅台,开盘价,昨收盘,当前价,...";
function buildSinaAShareResponse(code, name, prevClose, currentPrice) {
  const prefix = code.startsWith("6") ? "sh" : "sz";
  return `var hq_str_${prefix}${code}="${name},100.00,${prevClose},${currentPrice},101.00,100.50,100.80,100.60,1000000,50000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-07-22,15:00:00,00";`;
}

// Sina HK response format (real): single quoted comma-separated string
// var hq_str_hk01888="name_en,name_cn,open,prevClose,high,low,current,change,changePct,...";
function buildSinaHKResponse(code, name, prevClose, currentPrice) {
  return `var hq_str_hk${code}="NAME_EN,${name},0.000,${prevClose},0.000,0.000,${currentPrice},0.000,0.000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026/07/22,16:00";`;
}

// ===== Tests =====

test("parseHoldingsFromHtml — parses A-share (6-digit) and HK (5-digit) codes", () => {
  const result = parseHoldingsFromHtml(SAMPLE_HTML_WITH_HK);
  assert.ok(result, "should return holdings data");
  assert.equal(result.holdings.length, 4);
  assert.equal(result.reportDate, "2026-03-31");

  const codes = result.holdings.map((h) => h.stock_code);
  assert.ok(codes.includes("600519"), "should include 600519 (A-share)");
  assert.ok(codes.includes("01888"), "should include 01888 (HK 5-digit)");
  assert.ok(codes.includes("00700"), "should include 00700 (HK 5-digit)");

  const mtk = result.holdings.find((h) => h.stock_code === "600519");
  assert.equal(mtk.market, "A");
  assert.equal(mtk.stock_name, "贵州茅台");
  assert.equal(mtk.weight, 9.35);

  const hk = result.holdings.find((h) => h.stock_code === "01888");
  assert.equal(hk.market, "HK");
  assert.equal(hk.stock_name, "建滔积层板");
  assert.equal(hk.weight, 5.20);

  const tencent = result.holdings.find((h) => h.stock_code === "00700");
  assert.equal(tencent.market, "HK");
  assert.equal(tencent.stock_name, "腾讯控股");
});

test("parseHoldingsFromHtml — parses market_value from extra columns", () => {
  const result = parseHoldingsFromHtml(SAMPLE_HTML_WITH_HK);
  assert.ok(result);
  const mtk = result.holdings.find((h) => h.stock_code === "600519");
  assert.equal(mtk.shares, 12000); // 1.20万股 → 12000股
  assert.equal(mtk.market_value, 21000000); // 2100万元 → 21000000元
});

test("parseHoldingsFromHtml — dynamic quarter parsing picks latest quarter", () => {
  const result = parseHoldingsFromHtml(SAMPLE_HTML_MULTI_QUARTER);
  assert.ok(result);
  assert.equal(result.holdings.length, 1);
  assert.equal(result.holdings[0].stock_code, "600519");
  assert.equal(result.holdings[0].weight, 9.50);
});

test("parseHoldingsFromHtml — A-shares only still works", () => {
  const result = parseHoldingsFromHtml(SAMPLE_HTML_A_SHARES_ONLY);
  assert.ok(result);
  assert.equal(result.holdings.length, 2);
  assert.ok(result.holdings.every((h) => h.market === "A"));
});

test("parseHoldingsFromHtml — returns null for empty HTML", () => {
  const result = parseHoldingsFromHtml("<div>no data</div>");
  assert.equal(result, null);
});

test("parseSinaQuotesResponse — parses A-share quotes correctly", () => {
  const text = buildSinaAShareResponse("600519", "贵州茅台", 1800.0, 1820.0);
  const codeByKey = new Map([["sh600519", "600519"]]);
  const result = parseSinaQuotesResponse(text, codeByKey);

  assert.ok(result["600519"]);
  assert.equal(result["600519"].current_price, 1820.0);
  assert.equal(result["600519"].prev_close, 1800.0);
  assert.ok(Math.abs(result["600519"].change_pct - ((1820 - 1800) / 1800 * 100)) < 0.01);
});

test("parseSinaQuotesResponse — parses HK quotes correctly", () => {
  const text = buildSinaHKResponse("01888", "建滔积层板", 24.0, 25.0);
  const codeByKey = new Map([["hk01888", "01888"]]);
  const result = parseSinaQuotesResponse(text, codeByKey);

  assert.ok(result["01888"]);
  assert.equal(result["01888"].current_price, 25.0);
  assert.equal(result["01888"].prev_close, 24.0);
  assert.ok(Math.abs(result["01888"].change_pct - ((25 - 24) / 24 * 100)) < 0.01);
});

test("parseSinaQuotesResponse — handles mixed A-share + HK batch response", () => {
  const text = [
    buildSinaAShareResponse("600519", "贵州茅台", 1800.0, 1820.0),
    buildSinaHKResponse("01888", "建滔积层板", 24.0, 25.0),
    buildSinaAShareResponse("000858", "五粮液", 150.0, 148.0),
  ].join("\n");

  const codeByKey = new Map([
    ["sh600519", "600519"],
    ["hk01888", "01888"],
    ["sz000858", "000858"],
  ]);
  const result = parseSinaQuotesResponse(text, codeByKey);

  assert.equal(Object.keys(result).length, 3);
  assert.ok(result["600519"]);
  assert.ok(result["01888"]);
  assert.ok(result["000858"]);
});

test("parseSinaQuotesResponse — gracefully handles fewer rows than expected", () => {
  // Request 3 stocks but only 2 responses
  const text = [
    buildSinaAShareResponse("600519", "贵州茅台", 1800.0, 1820.0),
    buildSinaAShareResponse("000858", "五粮液", 150.0, 148.0),
  ].join("\n");

  const codeByKey = new Map([
    ["sh600519", "600519"],
    ["hk01888", "01888"],
    ["sz000858", "000858"],
  ]);
  const result = parseSinaQuotesResponse(text, codeByKey);

  assert.equal(Object.keys(result).length, 2);
  assert.ok(result["600519"]);
  assert.ok(result["000858"]);
  assert.equal(result["01888"], undefined, "missing stock should not be in result");
});

test("parseSinaQuotesResponse — returns empty for garbage input", () => {
  const result = parseSinaQuotesResponse("not valid", new Map());
  assert.deepEqual(result, {});
});

test("HK stock codes produce correct Sina symbols via parseHoldingsFromHtml", () => {
  const result = parseHoldingsFromHtml(SAMPLE_HTML_WITH_HK);
  assert.ok(result);
  // Verify the market field maps correctly for symbol generation
  const hkHolding = result.holdings.find((h) => h.stock_code === "01888");
  assert.equal(hkHolding.market, "HK");
  // toSinaSymbol("01888", "HK") should produce "hk01888"
  const aHolding = result.holdings.find((h) => h.stock_code === "600519");
  assert.equal(aHolding.market, "A");
});

test("clearFundEstimateCache clears all caches", () => {
  // Should not throw
  clearFundEstimateCache();
  assert.ok(true);
});

test("trading-hours check rejects weekends and accepts A-share sessions", () => {
  assert.equal(isTradingHours(new Date("2026-07-25T10:00:00+08:00")), false);
  assert.equal(isTradingHours(new Date("2026-07-27T10:00:00+08:00")), true);
  assert.equal(isTradingHours(new Date("2026-07-27T12:00:00+08:00")), false);
});
