import test from "node:test";
import assert from "node:assert/strict";

import {
  clearMarketSummaryCache,
  parseSinaMarketSummary,
  updateTurnoverHistory,
} from "../src/market-summary.js";

const SAMPLE_RESPONSE = [
  'var hq_str_s_sh000001="上证指数,3858.2450,44.0472,1.15,5048794,103131214";',
  'var hq_str_s_sz399001="深证成指,14148.73,374.055,2.72,571360929,104530833";',
].join("\n");

test("market summary adds Shanghai and Shenzhen turnover", () => {
  const summary = parseSinaMarketSummary(SAMPLE_RESPONSE);

  assert.ok(summary);
  assert.equal(summary.shanghai_amount_yuan, 1031312140000);
  assert.equal(summary.shenzhen_amount_yuan, 1045308330000);
  assert.equal(summary.total_amount_yuan, 2076620470000);
});

test("market summary rejects incomplete exchange data", () => {
  const summary = parseSinaMarketSummary(SAMPLE_RESPONSE.split("\n")[0]);
  assert.equal(summary, null);
});

test("market summary rejects invalid amount values", () => {
  const summary = parseSinaMarketSummary(
    SAMPLE_RESPONSE.replace("103131214", "--"),
  );
  assert.equal(summary, null);
});

test("market summary cache reset is safe", () => {
  clearMarketSummaryCache();
  assert.ok(true);
});

test("turnover history retains previous day after repeated same-day writes", () => {
  const first = updateTurnoverHistory(
    { date: "2026-07-29", total_amount_yuan: 2000000000000 },
    "2026-07-30",
    2300000000000,
    true,
  );
  const second = updateTurnoverHistory(
    first.history,
    "2026-07-30",
    2340000000000,
    true,
  );

  assert.equal(first.previousAmount, 2000000000000);
  assert.equal(second.previousAmount, 2000000000000);
  assert.deepEqual(second.history, {
    current: { date: "2026-07-30", total_amount_yuan: 2340000000000 },
    previous: { date: "2026-07-29", total_amount_yuan: 2000000000000 },
  });
});
