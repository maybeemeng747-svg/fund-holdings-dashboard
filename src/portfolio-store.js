import path from "node:path";
import { promises as fs } from "node:fs";

import { paths, staleDaysThreshold } from "./config.js";
import { buildImportAdvisories } from "./import-quality.js";
import {
  buildRealtimeOverlay,
  getConfirmedNavSnapshot,
  initializeConfirmedSnapshotFromHoldings,
} from "./realtime-service.js";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function formatNowLocal() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hh = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const mm = String(absMinutes % 60).padStart(2, "0");
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}${sign}${hh}:${mm}`;
}

function formatSnapshotFileName(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}.json`;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function calculateSummary(holdings) {
  const totalMarketValue = holdings.reduce((sum, item) => sum + (safeNumber(item.market_value) || 0), 0);
  const totalYesterdayProfit = holdings.reduce((sum, item) => sum + (safeNumber(item.yesterday_profit) || 0), 0);
  const totalHoldingProfit = holdings.reduce((sum, item) => sum + (safeNumber(item.holding_profit) || 0), 0);
  const weightedDailyChange = holdings.reduce((sum, item) => {
    const marketValue = safeNumber(item.market_value) || 0;
    const dailyChangePct = safeNumber(item.daily_change_pct) || 0;
    return sum + marketValue * dailyChangePct;
  }, 0);
  const estimatedCost = totalMarketValue - totalHoldingProfit;
  const totalHoldingProfitRate =
    estimatedCost > 0 ? Number(((totalHoldingProfit / estimatedCost) * 100).toFixed(2)) : null;
  const portfolioDailyChangePct =
    totalMarketValue > 0 ? Number((weightedDailyChange / totalMarketValue).toFixed(2)) : null;

  return {
    total_market_value: Number(totalMarketValue.toFixed(2)),
    today_profit: Number(totalYesterdayProfit.toFixed(2)),
    portfolio_daily_change_pct: portfolioDailyChangePct,
    holding_profit: Number(totalHoldingProfit.toFixed(2)),
    holding_profit_rate: totalHoldingProfitRate,
  };
}

function staleCheck(updatedAt) {
  if (!updatedAt) {
    return { is_stale: true, age_days: null };
  }

  const updatedTime = new Date(updatedAt);
  const diffMs = Date.now() - updatedTime.getTime();
  const ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return {
    is_stale: ageDays >= staleDaysThreshold,
    age_days: ageDays,
  };
}

function mergeMetadata(holding, mapEntries) {
  const keyCandidates = [holding.fund_code, holding.fund_name].filter(Boolean);
  const match = keyCandidates.map((key) => mapEntries[key]).find(Boolean) || {};
  return {
    ...holding,
    position_role: match.position_role || "未配置",
    style_tags: match.style_tags || [],
    holding_intent: match.holding_intent || "待补充",
    sector_tags: match.sector_tags || [],
  };
}

function calculateConfirmedSummary(holdings) {
  const totalMarketValue = holdings.reduce((sum, item) => sum + (safeNumber(item.current_market_value) || 0), 0);
  const totalHoldingProfit = holdings.reduce((sum, item) => sum + (safeNumber(item.current_holding_profit) || 0), 0);
  const estimatedCost = totalMarketValue - totalHoldingProfit;
  const totalHoldingProfitRate =
    estimatedCost > 0 ? Number(((totalHoldingProfit / estimatedCost) * 100).toFixed(2)) : null;

  return {
    total_market_value: Number(totalMarketValue.toFixed(2)),
    holding_profit: Number(totalHoldingProfit.toFixed(2)),
    holding_profit_rate: totalHoldingProfitRate,
  };
}

export async function getCurrentHoldings() {
  return readJson(paths.currentHoldingsFile);
}

export async function getFundSectorMap() {
  return readJson(paths.fundSectorMapFile);
}

export async function buildDashboardPayload(options = {}) {
  const { includeRealtime = true } = options;
  const currentHoldings = await getCurrentHoldings();
  const confirmedSnapshot = await getConfirmedNavSnapshot();
  const fundSectorMap = await getFundSectorMap();
  const holdings = currentHoldings.holdings || [];
  const computedImportSummary = calculateSummary(holdings);

  const confirmedMap = new Map(
    (confirmedSnapshot.holdings || []).map((item) => [item.fund_code || item.fund_name, item]),
  );

  let enrichedHoldings = holdings.map((item) => {
    const confirmed = confirmedMap.get(item.fund_code || item.fund_name) || null;
    return mergeMetadata(
      {
        ...item,
        current_market_value: confirmed?.confirmed_market_value ?? safeNumber(item.market_value),
        current_holding_profit: confirmed?.confirmed_holding_profit ?? safeNumber(item.holding_profit),
        current_holding_profit_rate:
          confirmed?.confirmed_holding_profit_rate ?? safeNumber(item.holding_profit_rate),
        current_nav: confirmed?.confirmed_nav ?? safeNumber(item.latest_nav),
        current_nav_date: confirmed?.confirmed_nav_date || null,
      },
      fundSectorMap.mappings || {},
    );
  });

  const confirmedSummary = calculateConfirmedSummary(enrichedHoldings);
  let summary = {
    ...(currentHoldings.summary || {}),
    ...computedImportSummary,
    ...confirmedSummary,
    confirmed_total_market_value: confirmedSummary.total_market_value,
    confirmed_holding_profit: confirmedSummary.holding_profit,
    confirmed_holding_profit_rate: confirmedSummary.holding_profit_rate,
  };

  if (includeRealtime) {
    const realtimeOverlay = await buildRealtimeOverlay(enrichedHoldings);
    summary = {
      ...summary,
      estimated_today_profit: realtimeOverlay.summary.today_profit,
      estimated_portfolio_daily_change_pct: realtimeOverlay.summary.portfolio_daily_change_pct,
      estimated_total_market_value: realtimeOverlay.summary.total_market_value,
      estimated_holding_profit: realtimeOverlay.summary.holding_profit,
      estimated_holding_profit_rate: realtimeOverlay.summary.holding_profit_rate,
      realtime_coverage: realtimeOverlay.summary.realtime_coverage,
    };
    enrichedHoldings = realtimeOverlay.holdings;
  }

  const totalMarketValue = summary.confirmed_total_market_value || summary.total_market_value || 0;

  const withWeights = enrichedHoldings.map((item) => ({
    ...item,
    portfolio_weight_pct:
      totalMarketValue > 0 && safeNumber(item.current_market_value) !== null
        ? Number((((Number(item.current_market_value) || 0) / totalMarketValue) * 100).toFixed(2))
        : null,
  }));

  return {
    ...currentHoldings,
    summary,
    holdings: withWeights,
    data_source: {
      source_file: "portfolio/current_holdings.json",
      updated_at: currentHoldings.updated_at,
      confirmed_snapshot_generated_at: confirmedSnapshot.generated_at || null,
      latest_confirmed_nav_date:
        summary.realtime_coverage?.latest_confirmed_nav_date ||
        confirmedSnapshot.holdings
          ?.map((item) => item.confirmed_nav_date)
          .filter(Boolean)
          .sort()
          .at(-1) ||
        null,
      source_type: currentHoldings.source?.type || null,
      is_screenshot_import: Boolean(currentHoldings.source?.is_screenshot_import),
      source_status_message:
        currentHoldings.source?.type === "manual_template"
          ? "当前为示例数据，尚未导入真实持仓"
          : "当前页面以 confirmed_nav_snapshot.json 作为真实仓位基线，并叠加当日盘中估算。",
      stale_status: staleCheck(currentHoldings.updated_at),
      realtime_status: includeRealtime ? summary.realtime_coverage || null : null,
      confirmed_nav_snapshot_file: "portfolio/confirmed_nav_snapshot.json",
      realtime_snapshot_file: includeRealtime ? "portfolio/realtime_snapshot.json" : null,
      analysis_preferred_source: "portfolio/confirmed_nav_snapshot.json",
    },
  };
}

export async function writeConfirmedImport(payload) {
  const now = new Date();
  const updatedAt = formatNowLocal();
  const currentHoldings = await getCurrentHoldings();
  const nextHoldings = payload.holdings.map((item) => ({
    fund_name: item.fund_name || null,
    fund_code: item.fund_code || null,
    market_value: safeNumber(item.market_value),
    shares: safeNumber(item.shares),
    cost_nav: safeNumber(item.cost_nav),
    latest_nav: safeNumber(item.latest_nav),
    daily_change_pct: safeNumber(item.daily_change_pct),
    yesterday_profit: safeNumber(item.yesterday_profit),
    holding_profit: safeNumber(item.holding_profit),
    holding_profit_rate: safeNumber(item.holding_profit_rate),
    notes: item.notes || "",
  }));
  const advisory = buildImportAdvisories(
    nextHoldings.map((item) => ({
      ...item,
      missing_fields: [
        ...(item.shares === null ? ["shares"] : []),
        ...(item.cost_nav === null ? ["cost_nav"] : []),
        ...(item.latest_nav === null ? ["latest_nav"] : []),
      ],
      suspicious_fields: [],
    })),
  );

  const nextPortfolio = {
    schema_version: "v1",
    portfolio_name: currentHoldings.portfolio_name || "我的基金组合",
    base_currency: "CNY",
    updated_at: updatedAt,
    source: {
      type: payload.source?.type || "screenshot_import",
      is_screenshot_import: true,
      image_name: payload.source?.image_name || "uploaded-screenshot",
      imported_via: payload.source?.imported_via || "dashboard_confirmed_import",
      confirmed_at: updatedAt,
      note: payload.note || "用户在网页预览中确认写入",
    },
    import_quality: {
      confidence_level: advisory.confidence_level,
      warnings: payload.warnings || advisory.warnings,
      degraded_funds: advisory.degraded_funds,
      message:
        advisory.confidence_level === "degraded"
          ? "动作建议可信度下降，请尽快补齐高优先级字段并复核截图。"
          : "关键字段较完整，可作为当前持仓真源使用。",
    },
    summary: calculateSummary(nextHoldings),
    holdings: nextHoldings,
  };

  const snapshotFileName = formatSnapshotFileName(now);
  const snapshotRelativePath = path.posix.join("portfolio", "snapshots", snapshotFileName);
  const snapshotFilePath = path.join(paths.snapshotsDir, snapshotFileName);
  await writeJson(paths.currentHoldingsFile, nextPortfolio);
  await writeJson(snapshotFilePath, nextPortfolio);
  await initializeConfirmedSnapshotFromHoldings(nextHoldings, "screenshot_confirmed_import");

  const updateLog = await readJson(paths.updateLogFile);
  const nextEntry = {
    id: `update-${now.getTime()}`,
    timestamp: updatedAt,
    source_type: nextPortfolio.source.type,
    image_name: nextPortfolio.source.image_name,
    status: "confirmed_and_written",
    snapshot_file: snapshotRelativePath,
    holdings_count: nextHoldings.length,
    warning_count: Array.isArray(payload.warnings) ? payload.warnings.length : 0,
    warnings: payload.warnings || [],
  };
  updateLog.entries = Array.isArray(updateLog.entries) ? [nextEntry, ...updateLog.entries] : [nextEntry];
  updateLog.last_updated_at = updatedAt;
  await writeJson(paths.updateLogFile, updateLog);

  return {
    ok: true,
    updated_at: updatedAt,
    snapshot_file: snapshotRelativePath,
    summary: nextPortfolio.summary,
    import_quality: nextPortfolio.import_quality,
  };
}
