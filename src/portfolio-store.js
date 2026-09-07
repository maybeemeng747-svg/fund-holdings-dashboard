import path from "node:path";
import { promises as fs } from "node:fs";

import { paths, staleDaysThreshold } from "./config.js";
import { buildImportAdvisories } from "./import-quality.js";
import { mergeFundHoldings } from "./portfolio-merge.js";
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

function roundNumber(value, digits = 2) {
  const numeric = safeNumber(value);
  if (numeric === null) return null;
  return Number(numeric.toFixed(digits));
}

function localDateParts(date = new Date()) {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function formatLocalDate(date = new Date()) {
  const parts = localDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatLocalTime(date = new Date()) {
  const parts = localDateParts(date);
  return `${parts.hour}:${parts.minute}`;
}

function normalizeWorkspaceUpdatedAt(portfolio) {
  if (portfolio.updated_at) return portfolio.updated_at;
  if (!portfolio.updated) return null;
  const time = portfolio.snapshot_time || "00:00";
  return `${portfolio.updated}T${time}:00+08:00`;
}

function isWorkspaceHoldingsSchema(portfolio) {
  return Boolean(
    portfolio &&
      portfolio.holdings &&
      !Array.isArray(portfolio.holdings) &&
      (Array.isArray(portfolio.holdings.stocks) || Array.isArray(portfolio.holdings.funds)),
  );
}

function mapWorkspaceStockToDashboard(stock) {
  return {
    stock_code: stock.code || stock.stock_code || null,
    stock_name: stock.name || stock.stock_name || null,
    shares: safeNumber(stock.shares),
    available_shares: safeNumber(stock.available_shares),
    cost_price: safeNumber(stock.cost_price),
    current_price: safeNumber(stock.current_price),
    market_value: safeNumber(stock.market_value),
    profit: safeNumber(stock.profit),
    profit_pct: safeNumber(stock.profit_pct),
    daily_profit: safeNumber(stock.daily_profit),
    daily_change_pct: safeNumber(stock.daily_change_pct),
    asset_type: stock.type || "stock",
  };
}

function mapWorkspaceFundToDashboard(fund) {
  return {
    fund_code: fund.code || fund.fund_code || null,
    fund_name: fund.name || fund.fund_name || null,
    market_value: safeNumber(fund.market_value),
    shares: safeNumber(fund.shares),
    cost_nav: safeNumber(fund.cost_nav),
    latest_nav: safeNumber(fund.latest_nav),
    daily_change_pct: safeNumber(fund.daily_change_pct),
    yesterday_profit: safeNumber(fund.daily_profit ?? fund.yesterday_profit),
    holding_profit: safeNumber(fund.profit ?? fund.holding_profit),
    holding_profit_rate: safeNumber(fund.profit_pct ?? fund.holding_profit_rate),
    nav_date: fund.nav_date || null,
  };
}

function mapDashboardStockToWorkspace(stock) {
  return {
    code: stock.stock_code || stock.code || null,
    name: stock.stock_name || stock.name || null,
    type: stock.asset_type || stock.type || "stock",
    shares: safeNumber(stock.shares),
    available_shares: safeNumber(stock.available_shares),
    cost_price: safeNumber(stock.cost_price),
    current_price: safeNumber(stock.current_price),
    market_value: safeNumber(stock.market_value ?? stock.display_market_value),
    profit: safeNumber(stock.profit ?? stock.display_holding_profit),
    profit_pct: safeNumber(stock.profit_pct ?? stock.display_holding_profit_rate),
    daily_profit: safeNumber(stock.daily_profit ?? stock.display_daily_profit),
    daily_change_pct: safeNumber(stock.daily_change_pct ?? stock.display_daily_change_pct),
  };
}

function mapDashboardFundToWorkspace(fund) {
  return {
    code: fund.fund_code || fund.code || null,
    name: fund.fund_name || fund.name || null,
    type: fund.type || "fund",
    shares: safeNumber(fund.shares),
    cost_nav: safeNumber(fund.cost_nav),
    latest_nav: safeNumber(fund.latest_nav),
    nav_date: fund.nav_date || fund.current_nav_date || null,
    market_value: safeNumber(fund.market_value),
    profit: safeNumber(fund.holding_profit ?? fund.profit),
    profit_pct: safeNumber(fund.holding_profit_rate ?? fund.profit_pct),
    daily_profit: safeNumber(fund.yesterday_profit ?? fund.daily_profit),
    daily_change_pct: safeNumber(fund.daily_change_pct),
  };
}

function calculateFundSummary(holdings) {
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
    estimatedCost > 0 ? roundNumber((totalHoldingProfit / estimatedCost) * 100, 2) : null;
  const portfolioDailyChangePct =
    totalMarketValue > 0 ? roundNumber(weightedDailyChange / totalMarketValue, 2) : null;

  return {
    total_market_value: roundNumber(totalMarketValue, 2) || 0,
    today_profit: roundNumber(totalYesterdayProfit, 2) || 0,
    portfolio_daily_change_pct: portfolioDailyChangePct,
    holding_profit: roundNumber(totalHoldingProfit, 2) || 0,
    holding_profit_rate: totalHoldingProfitRate,
  };
}

export function calculateSummary(holdings = [], stocks = [], account = {}) {
  const fundSummary = calculateFundSummary(holdings);
  const stockMarketValue = stocks.reduce((sum, item) => sum + (safeNumber(item.market_value) || 0), 0);
  const stockDailyProfit = stocks.reduce((sum, item) => sum + (safeNumber(item.daily_profit) || 0), 0);
  const stockHoldingProfit = stocks.reduce((sum, item) => sum + (safeNumber(item.profit) || 0), 0);
  const stockWeightedDailyChange = stocks.reduce((sum, item) => {
    const marketValue = safeNumber(item.market_value) || 0;
    const dailyChangePct = safeNumber(item.daily_change_pct) || 0;
    return sum + marketValue * dailyChangePct;
  }, 0);
  const fundWeightedDailyChange = holdings.reduce((sum, item) => {
    const marketValue = safeNumber(item.market_value) || 0;
    const dailyChangePct = safeNumber(item.daily_change_pct) || 0;
    return sum + marketValue * dailyChangePct;
  }, 0);
  const totalMarketValue = safeNumber(account.total_market_value) ?? fundSummary.total_market_value + stockMarketValue;
  const totalHoldingProfit = safeNumber(account.total_pnl) ?? fundSummary.holding_profit + stockHoldingProfit;
  const todayProfit = safeNumber(account.daily_pnl) ?? fundSummary.today_profit + stockDailyProfit;
  const totalCost = totalMarketValue - totalHoldingProfit;
  const portfolioDailyChangePct =
    safeNumber(account.daily_change_pct) ??
    (totalMarketValue > 0 ? roundNumber((fundWeightedDailyChange + stockWeightedDailyChange) / totalMarketValue, 2) : null);

  return {
    total_market_value: roundNumber(totalMarketValue, 2) || 0,
    total_assets: safeNumber(account.total_assets),
    available_cash: safeNumber(account.available_cash),
    position_pct: safeNumber(account.position_pct),
    today_profit: roundNumber(todayProfit, 2) || 0,
    portfolio_daily_change_pct: portfolioDailyChangePct,
    holding_profit: roundNumber(totalHoldingProfit, 2) || 0,
    holding_profit_rate: totalCost > 0 ? roundNumber((totalHoldingProfit / totalCost) * 100, 2) : null,
    fund_market_value: fundSummary.total_market_value,
    fund_today_profit: fundSummary.today_profit,
    fund_holding_profit: fundSummary.holding_profit,
    stock_market_value: roundNumber(stockMarketValue, 2) || 0,
    stock_today_profit: roundNumber(stockDailyProfit, 2) || 0,
    stock_holding_profit: roundNumber(stockHoldingProfit, 2) || 0,
  };
}

export function adaptWorkspacePortfolioToDashboard(portfolio) {
  if (!isWorkspaceHoldingsSchema(portfolio)) {
    return portfolio;
  }

  const stocks = (portfolio.holdings.stocks || []).map(mapWorkspaceStockToDashboard);
  const holdings = (portfolio.holdings.funds || []).map(mapWorkspaceFundToDashboard);
  const summary = calculateSummary(holdings, stocks, portfolio.account || {});
  const updatedAt = normalizeWorkspaceUpdatedAt(portfolio);

  return {
    schema_version: "v1",
    portfolio_name: portfolio.portfolio_name || "我的持仓组合",
    base_currency: portfolio.base_currency || "CNY",
    updated_at: updatedAt,
    source: {
      type: portfolio.updated_by === "manual_screenshot_update" ? "screenshot_import" : portfolio.updated_by || "workspace_holdings",
      is_screenshot_import: portfolio.updated_by === "manual_screenshot_update",
      confirmed_at: updatedAt,
      note: portfolio.account?.note || "读取 OpenClaw workspace/portfolio/holdings.json",
    },
    import_quality: portfolio.import_quality || {
      confidence_level: "normal",
      warnings: [],
      degraded_funds: [],
      message: "当前持仓读取自 OpenClaw workspace 真源。",
    },
    summary,
    stocks,
    holdings,
    workspace_account: portfolio.account || {},
    workspace_meta: {
      updated: portfolio.updated || null,
      snapshot_time: portfolio.snapshot_time || null,
      updated_by: portfolio.updated_by || null,
      changes_since_last: portfolio.changes_since_last || null,
      indexes: portfolio.holdings.indexes || [],
      watchlist: portfolio.watchlist || [],
    },
  };
}

export function adaptDashboardPortfolioToWorkspace(currentPortfolio, nextFunds, options = {}) {
  const currentRaw = isWorkspaceHoldingsSchema(currentPortfolio) ? currentPortfolio : {};
  const currentDashboard = adaptWorkspacePortfolioToDashboard(currentPortfolio);
  const stocks = Array.isArray(currentRaw.holdings?.stocks)
    ? currentRaw.holdings.stocks
    : (currentDashboard.stocks || []).map(mapDashboardStockToWorkspace);
  const funds = nextFunds.map(mapDashboardFundToWorkspace);
  const dashboardStocks = stocks.map(mapWorkspaceStockToDashboard);
  const dashboardFunds = funds.map(mapWorkspaceFundToDashboard);
  const summary = calculateSummary(dashboardFunds, dashboardStocks, {
    available_cash: currentRaw.account?.available_cash ?? currentDashboard.summary?.available_cash,
  });
  const availableCash = summary.available_cash ?? safeNumber(currentRaw.account?.available_cash) ?? 0;
  const totalAssets = roundNumber(summary.total_market_value + availableCash, 2);
  const now = options.now || new Date();

  return {
    ...currentRaw,
    account: {
      ...(currentRaw.account || {}),
      total_assets: totalAssets,
      total_market_value: summary.total_market_value,
      available_cash: availableCash,
      position_pct: totalAssets > 0 ? roundNumber((summary.total_market_value / totalAssets) * 100, 2) : null,
      daily_pnl: summary.today_profit,
      daily_change_pct: summary.portfolio_daily_change_pct,
      total_pnl: summary.holding_profit,
    },
    holdings: {
      ...(currentRaw.holdings || {}),
      stocks,
      funds,
    },
    updated: formatLocalDate(now),
    snapshot_time: formatLocalTime(now),
    updated_by: options.updated_by || "dashboard_confirmed_import",
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
  const raw = await readJson(paths.currentHoldingsFile);
  return adaptWorkspacePortfolioToDashboard(raw);
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
  const stocks = currentHoldings.stocks || [];
  const computedPortfolioSummary = calculateSummary(holdings, stocks, currentHoldings.summary || {});
  const computedFundSummary = calculateFundSummary(holdings);

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
    ...computedPortfolioSummary,
    combined_total_market_value: computedPortfolioSummary.total_market_value,
    combined_today_profit: computedPortfolioSummary.today_profit,
    combined_holding_profit: computedPortfolioSummary.holding_profit,
    combined_holding_profit_rate: computedPortfolioSummary.holding_profit_rate,
    fund_market_value: computedFundSummary.total_market_value,
    stock_market_value: computedPortfolioSummary.stock_market_value,
    total_market_value: confirmedSummary.total_market_value,
    today_profit: computedFundSummary.today_profit,
    portfolio_daily_change_pct: computedFundSummary.portfolio_daily_change_pct,
    holding_profit: confirmedSummary.holding_profit,
    holding_profit_rate: confirmedSummary.holding_profit_rate,
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
      estimate_as_of: realtimeOverlay.summary.estimate_as_of || null,
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
      source_file: paths.currentHoldingsFile,
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
  const currentRawHoldings = await readJson(paths.currentHoldingsFile);
  const currentHoldings = adaptWorkspacePortfolioToDashboard(currentRawHoldings);
  const importedHoldings = payload.holdings.map((item) => ({
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
  const nextHoldings = payload.import_scope === "partial"
    ? mergeFundHoldings(currentHoldings.holdings || [], importedHoldings)
    : importedHoldings;
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

  const nextDashboardPortfolio = {
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
    summary: calculateSummary(nextHoldings, currentHoldings.stocks || [], currentHoldings.summary || {}),
    stocks: currentHoldings.stocks || [],
    holdings: nextHoldings,
  };
  const nextPortfolio = adaptDashboardPortfolioToWorkspace(currentRawHoldings, nextHoldings, {
    now,
    updated_by: nextDashboardPortfolio.source.imported_via,
  });

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
    source_type: nextDashboardPortfolio.source.type,
    image_name: nextDashboardPortfolio.source.image_name,
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
    summary: nextDashboardPortfolio.summary,
    import_quality: nextDashboardPortfolio.import_quality,
  };
}
