import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboardPayload } from "../src/portfolio-store.js";
import { buildDiff, extractPortfolioFromScreenshot, validateImportPayload } from "../src/import-service.js";
import { buildImportAdvisories } from "../src/import-quality.js";

test("dashboard payload contains summary and holdings", async () => {
  const payload = await buildDashboardPayload({ includeRealtime: false });
  assert.equal(typeof payload.summary.total_market_value, "number");
  assert.equal(typeof payload.summary.portfolio_daily_change_pct, "number");
  assert.ok(payload.holdings.length >= 1);
  assert.ok(payload.holdings.every((item) => item.fund_name));
  assert.ok(payload.holdings.some((item) => item.position_role));
  assert.ok(payload.holdings.some((item) => item.current_nav_date || item.current_nav));
  assert.equal(payload.data_source.source_type, "screenshot_import");
  assert.match(payload.data_source.source_status_message, /confirmed_nav_snapshot/);
  assert.ok("latest_confirmed_nav_date" in payload.data_source);
});

test("confirm payload validation rejects unconfirmed writes", () => {
  assert.throws(() => validateImportPayload({ confirmed: false, holdings: [] }), /必须经过用户确认/);
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
