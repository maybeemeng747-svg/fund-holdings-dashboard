import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { paths } from "./config.js";
import { estimateFundNav } from "./fund-estimate.js";

const FUND_GZ_ENDPOINT = "https://fundgz.1234567.com.cn/js";
const CACHE_TTL_MS = 45 * 1000;
const QDII_PROXY_CONFIG = {
  "019449": {
    proxy_symbol: "1306.T",
    proxy_name: "TOPIX ETF",
    weight: 0.9,
    market: "JP",
  },
};

let quoteCache = new Map();
const execFileAsync = promisify(execFile);

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function roundNumber(value, digits = 2) {
  const numeric = safeNumber(value);
  if (numeric === null) return null;
  return Number(numeric.toFixed(digits));
}

function nowIso() {
  return new Date().toISOString();
}

function todayLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function timestampToCSTDate(ts) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseJsonp(body) {
  const trimmed = String(body || "").trim();
  const match = trimmed.match(/^jsonpgz\((.*)\);?$/);
  if (!match || !match[1] || match[1] === "") return null;
  return JSON.parse(match[1]);
}

function isInvalidFundGzQuote(quote) {
  if (!quote || !quote.fundcode) return true;
  const estimatedNav = safeNumber(quote.gsz);
  const estimateTime = String(quote.gztime || "");
  return estimatedNav === 0 || estimateTime.startsWith("0001-01-01");
}

async function fetchFundEstimate(fundCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${FUND_GZ_ENDPOINT}/${fundCode}.js`, {
      headers: {
        Accept: "text/javascript, application/javascript, */*;q=0.8",
        Referer: "https://fund.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 FundDashboard/1.0",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    return parseJsonp(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchConfirmedNavFromPingzhong(fundCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://fund.eastmoney.com/pingzhongdata/${fundCode}.js`, {
      headers: {
        Accept: "text/javascript, application/javascript, */*;q=0.8",
        Referer: "https://fund.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 FundDashboard/1.0",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const match = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (!match) return null;
    const trend = JSON.parse(match[1]);
    if (!Array.isArray(trend) || trend.length === 0) return null;
    const latest = trend[trend.length - 1];
    const prev = trend.length > 1 ? trend[trend.length - 2] : null;
    const latestNav = safeNumber(latest?.y);
    const latestDate = timestampToCSTDate(latest?.x);
    if (latestNav === null) return null;
    return {
      fundcode: fundCode,
      dwjz: latestNav,
      jzrq: latestDate,
      gsz: null,
      gszzl: null,
      gztime: null,
      _source: "pingzhongdata",
      _confirmed_return: safeNumber(latest?.equityReturn),
      _prev_nav: prev ? safeNumber(prev?.y) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getCachedFundEstimate(fundCode) {
  const current = quoteCache.get(fundCode);
  if (current && Date.now() - current.fetchedAt < CACHE_TTL_MS) {
    return current.quote;
  }

  let rawQuote = await fetchFundEstimate(fundCode);
  if (isInvalidFundGzQuote(rawQuote)) {
    rawQuote = await fetchConfirmedNavFromPingzhong(fundCode);
  }
  const quote = isInvalidFundGzQuote(rawQuote) ? null : rawQuote;
  quoteCache.set(fundCode, { quote, fetchedAt: Date.now() });
  return quote;
}

async function fetchYahooChartMeta(symbol) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 FundDashboard/1.0",
      },
      signal: controller.signal,
    });
    const payload = await response.json();
    return payload?.chart?.result?.[0]?.meta || null;
  } catch {
    try {
      const script = [
        "import json, sys, urllib.request",
        "symbol = sys.argv[1]",
        "url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'",
        "req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0', 'Accept':'application/json'})",
        "with urllib.request.urlopen(req, timeout=5) as resp:",
        "    data = json.load(resp)",
        "meta = (((data.get('chart') or {}).get('result') or [None])[0] or {}).get('meta')",
        "print(json.dumps(meta or {}))",
      ].join("\n");
      const { stdout } = await execFileAsync("python3", ["-c", script, symbol], { timeout: 7000 });
      return JSON.parse(stdout || "{}");
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function getQdiiProxyQuote(fundCode) {
  const config = QDII_PROXY_CONFIG[fundCode];
  if (!config) return null;

  const cacheKey = `qdii:${fundCode}`;
  const current = quoteCache.get(cacheKey);
  if (current && Date.now() - current.fetchedAt < CACHE_TTL_MS) {
    return current.quote;
  }

  const meta = await fetchYahooChartMeta(config.proxy_symbol);
  const regularMarketPrice = safeNumber(meta?.regularMarketPrice);
  const previousClose = safeNumber(meta?.previousClose ?? meta?.chartPreviousClose);
  if (regularMarketPrice === null || previousClose === null || previousClose === 0) {
    quoteCache.set(cacheKey, { quote: null, fetchedAt: Date.now() });
    return null;
  }

  const rawPct = ((regularMarketPrice - previousClose) / previousClose) * 100;
  const adjustedPct = rawPct * config.weight;
  const quote = {
    fundcode: fundCode,
    gsz: null,
    gszzl: roundNumber(adjustedPct, 2),
    gztime: meta?.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null,
    proxy_symbol: config.proxy_symbol,
    proxy_name: config.proxy_name,
    proxy_weight: config.weight,
    market: config.market,
    source: "yahoo_chart_proxy",
  };
  quoteCache.set(cacheKey, { quote, fetchedAt: Date.now() });
  return quote;
}

function holdingKey(holding) {
  return holding.fund_code || holding.fund_name || null;
}

function normalizeFundName(name) {
  return String(name || "").trim();
}

function buildBaselineRecord(holding, overrides = {}) {
  const shares = safeNumber(holding.shares);
  const costNav = safeNumber(holding.cost_nav);
  const confirmedNav = safeNumber(overrides.confirmed_nav ?? holding.latest_nav);
  const confirmedMarketValue =
    shares !== null && confirmedNav !== null ? roundNumber(shares * confirmedNav, 2) : safeNumber(holding.market_value);
  const holdingCost = shares !== null && costNav !== null ? roundNumber(shares * costNav, 2) : null;
  const confirmedHoldingProfit =
    confirmedMarketValue !== null && holdingCost !== null
      ? roundNumber(confirmedMarketValue - holdingCost, 2)
      : safeNumber(holding.holding_profit);
  const confirmedHoldingProfitRate =
    confirmedHoldingProfit !== null && holdingCost
      ? roundNumber((confirmedHoldingProfit / holdingCost) * 100, 2)
      : safeNumber(holding.holding_profit_rate);

  return {
    fund_code: holding.fund_code || null,
    fund_name: holding.fund_name || null,
    shares,
    cost_nav: costNav,
    confirmed_nav: confirmedNav,
    confirmed_nav_date: overrides.confirmed_nav_date || null,
    confirmed_market_value: confirmedMarketValue,
    confirmed_holding_profit: confirmedHoldingProfit,
    confirmed_holding_profit_rate: confirmedHoldingProfitRate,
    previous_confirmed_nav: safeNumber(overrides.previous_confirmed_nav),
    previous_confirmed_nav_date: overrides.previous_confirmed_nav_date || null,
    previous_confirmed_market_value: safeNumber(overrides.previous_confirmed_market_value),
    baseline_source: overrides.baseline_source || "current_holdings_snapshot",
    last_synced_at: overrides.last_synced_at || nowIso(),
  };
}

async function loadConfirmedSnapshot() {
  return readJsonIfExists(paths.confirmedNavSnapshotFile, {
    schema_version: "v1",
    generated_at: null,
    source: "bootstrap_from_current_holdings",
    holdings: [],
  });
}

export async function getConfirmedNavSnapshot() {
  return loadConfirmedSnapshot();
}

async function saveConfirmedSnapshot(payload) {
  await writeJson(paths.confirmedNavSnapshotFile, payload);
}

async function bootstrapConfirmedSnapshot(holdings) {
  const snapshot = {
    schema_version: "v1",
    generated_at: nowIso(),
    source: "bootstrap_from_current_holdings",
    holdings: holdings.map((holding) => buildBaselineRecord(holding)),
  };
  await saveConfirmedSnapshot(snapshot);
  return snapshot;
}

async function loadOrInitializeConfirmedSnapshot(holdings) {
  const current = await loadConfirmedSnapshot();
  if (Array.isArray(current.holdings) && current.holdings.length > 0) {
    return current;
  }
  return bootstrapConfirmedSnapshot(holdings);
}

function buildBaselineIndexes(snapshot) {
  const byKey = new Map();
  const byName = new Map();
  (snapshot.holdings || []).forEach((entry) => {
    const key = entry.fund_code || entry.fund_name;
    const name = normalizeFundName(entry.fund_name);
    if (key) byKey.set(key, entry);
    if (name) byName.set(name, entry);
  });
  return { byKey, byName };
}

function isEstimateFresh(estimatedSummary) {
  if (!estimatedSummary) return false;
  const asOf = estimatedSummary.estimate_as_of;
  if (!asOf) return false;
  const age = Date.now() - new Date(asOf).getTime();
  return age >= 0 && age <= 300000;
}

async function persistRealtimeSnapshot(payload, estimatedSummary = null) {
  const snapshot = {
    schema_version: "v1",
    generated_at: nowIso(),
    ...payload,
    estimated_summary: estimatedSummary ? {
      total_market_value: estimatedSummary.total_market_value,
      today_profit: estimatedSummary.today_profit,
      portfolio_daily_change_pct: estimatedSummary.portfolio_daily_change_pct,
      holding_profit: estimatedSummary.holding_profit,
      holding_profit_rate: estimatedSummary.holding_profit_rate,
      estimate_as_of: estimatedSummary.estimate_as_of || null,
    } : null,
    estimate_fresh: isEstimateFresh(estimatedSummary),
  };
  await writeJson(paths.realtimeSnapshotFile, snapshot);
}

function isNewerConfirmedDate(nextDate, currentDate) {
  if (!nextDate) return false;
  if (!currentDate) return true;
  return String(nextDate) > String(currentDate);
}

function mergeConfirmedBaseline(holding, baselineEntries, quote) {
  const key = holdingKey(holding);
  const name = normalizeFundName(holding.fund_name);
  const current = (key ? baselineEntries.byKey.get(key) : null) || (name ? baselineEntries.byName.get(name) : null);
  const previousBaseline = current ? { ...current } : null;
  let next = current ? { ...current } : buildBaselineRecord(holding);
  let changed = !current;
  let confirmedUpdated = false;

  const quoteConfirmedNav = safeNumber(quote?.dwjz);
  const quoteConfirmedDate = quote?.jzrq || null;
  if (quoteConfirmedNav !== null && isNewerConfirmedDate(quoteConfirmedDate, next.confirmed_nav_date)) {
    next = buildBaselineRecord(holding, {
      confirmed_nav: quoteConfirmedNav,
      confirmed_nav_date: quoteConfirmedDate,
      previous_confirmed_nav: next.confirmed_nav,
      previous_confirmed_nav_date: next.confirmed_nav_date,
      previous_confirmed_market_value: next.confirmed_market_value,
      baseline_source: "fundgz_confirmed_nav",
      last_synced_at: nowIso(),
    });
    changed = true;
    confirmedUpdated = true;
  } else {
    const shares = safeNumber(holding.shares);
    const costNav = safeNumber(holding.cost_nav);
    if (shares !== next.shares || costNav !== next.cost_nav) {
      next = buildBaselineRecord(
        { ...holding, latest_nav: next.confirmed_nav ?? holding.latest_nav },
        {
          confirmed_nav: next.confirmed_nav,
          confirmed_nav_date: next.confirmed_nav_date,
          previous_confirmed_nav: next.previous_confirmed_nav,
          previous_confirmed_nav_date: next.previous_confirmed_nav_date,
          previous_confirmed_market_value: next.previous_confirmed_market_value,
          baseline_source: next.baseline_source || "current_holdings_roll_forward",
          last_synced_at: nowIso(),
        },
      );
      changed = true;
    }
  }

  const nextKey = next.fund_code || next.fund_name;
  const nextName = normalizeFundName(next.fund_name);
  if (nextKey) baselineEntries.byKey.set(nextKey, next);
  if (nextName) baselineEntries.byName.set(nextName, next);
  return { baseline: next, changed, previousBaseline, confirmedUpdated };
}

function hasPersistentConfirmedUpdate(baseline, quote) {
  const quoteConfirmedNav = safeNumber(quote?.dwjz);
  const quoteConfirmedDate = quote?.jzrq || null;
  const baselineConfirmedNav = safeNumber(baseline?.confirmed_nav);
  const baselineConfirmedDate = baseline?.confirmed_nav_date || null;
  const previousConfirmedDate = baseline?.previous_confirmed_nav_date || null;
  const previousConfirmedNav = safeNumber(baseline?.previous_confirmed_nav);
  const previousConfirmedMarketValue = safeNumber(baseline?.previous_confirmed_market_value);

  if (quoteConfirmedNav === null || !quoteConfirmedDate) return false;
  if (baselineConfirmedNav === null || !baselineConfirmedDate) return false;
  if (baselineConfirmedDate !== quoteConfirmedDate) return false;
  if (baselineConfirmedDate !== todayLocalDate()) return false;
  if (Math.abs(baselineConfirmedNav - quoteConfirmedNav) > 0.0001) return false;
  if (!previousConfirmedDate || previousConfirmedNav === null || previousConfirmedMarketValue === null) return false;
  return String(previousConfirmedDate) < String(baselineConfirmedDate);
}

function resolveRealtimeFundCode(holding, baseline) {
  return holding.fund_code || baseline?.fund_code || null;
}

export async function buildHoldingRealtime(holding, quote, baseline, options = {}) {
  const {
    previousBaseline = null,
    confirmedUpdated = false,
    fundCode = null,
    estimateFundNavFn = estimateFundNav,
  } = options;
  const shares = safeNumber(holding.shares);
  const costNav = safeNumber(holding.cost_nav);
  const fallbackHoldingCost = shares !== null && costNav !== null ? shares * costNav : null;
  const confirmedMarketValue = safeNumber(baseline?.confirmed_market_value ?? holding.market_value);
  const confirmedNav = safeNumber(baseline?.confirmed_nav ?? holding.latest_nav);
  const confirmedHoldingProfit = safeNumber(baseline?.confirmed_holding_profit ?? holding.holding_profit);
  const confirmedHoldingProfitRate = safeNumber(
    baseline?.confirmed_holding_profit_rate ?? holding.holding_profit_rate,
  );
  const isQdiiProxy = quote?.source === "yahoo_chart_proxy";
  const persistentConfirmedUpdate = hasPersistentConfirmedUpdate(baseline, quote);
  const isTodayConfirmedDate =
    (baseline?.confirmed_nav_date || quote?.jzrq || null) === todayLocalDate();

  if (!quote || !quote.fundcode) {
    const fallbackDate = baseline?.confirmed_nav_date || null;
    const isToday = fallbackDate === todayLocalDate();
    return {
      ...holding,
      latest_nav: confirmedNav ?? holding.latest_nav,
      display_daily_change_pct: isToday ? safeNumber(holding.daily_change_pct) : null,
      display_daily_profit: isToday ? safeNumber(holding.yesterday_profit) : null,
      display_market_value: confirmedMarketValue,
      display_holding_profit: confirmedHoldingProfit,
      display_holding_profit_rate: confirmedHoldingProfitRate,
      confirmed_baseline: baseline || null,
      realtime: {
        status: "fallback_snapshot",
        source: "confirmed_nav_snapshot",
        as_of: fallbackDate,
        coverage: isToday ? "stale" : "confirmed_stale_no_estimate",
        estimated_nav: null,
        estimated_change_pct: null,
        estimated_market_value: null,
        estimated_daily_profit: null,
        estimated_holding_profit: null,
        estimated_holding_profit_rate: null,
        confirmed_nav: confirmedNav,
        confirmed_nav_date: fallbackDate,
        pending_nav: !isToday,
      },
    };
  }

  // pingzhongdata fallback: confirmed NAV available, try self-built estimate
  if (quote?._source === "pingzhongdata") {
    const confirmedReturn = safeNumber(quote._confirmed_return);
    const prevNav = safeNumber(quote._prev_nav);
    const confirmedDate = baseline?.confirmed_nav_date || quote.jzrq || null;
    const isToday = confirmedDate === todayLocalDate();
    const displayDailyPct = isToday ? (confirmedReturn ?? null) : null;
    const displayDailyProfit = isToday
      ? (shares !== null && prevNav !== null && confirmedNav !== null
          ? roundNumber(shares * (confirmedNav - prevNav), 2)
          : safeNumber(holding.yesterday_profit))
      : null;

    // Self-built intraday estimate using holdings × real-time stock quotes
    const estimateBaseline = isToday ? prevNav : confirmedNav;
    let selfEstimate = null;
    if (estimateBaseline && fundCode) {
      selfEstimate = await estimateFundNavFn(fundCode, estimateBaseline);
    }

    if (selfEstimate && selfEstimate.holdings_used > 0) {
      const estNav = selfEstimate.estimated_nav;
      const estMv = shares !== null ? roundNumber(shares * estNav, 2) : confirmedMarketValue;
      const dailyBaselineMarketValue = isToday && shares !== null && prevNav !== null
        ? roundNumber(shares * prevNav, 2)
        : confirmedMarketValue;
      const estDailyProfit = estMv !== null && dailyBaselineMarketValue !== null
        ? roundNumber(estMv - dailyBaselineMarketValue, 2)
        : null;
      const estHoldingProfit = estMv !== null && fallbackHoldingCost !== null
        ? roundNumber(estMv - fallbackHoldingCost, 2)
        : confirmedHoldingProfit;
      const estHoldingRate = estHoldingProfit !== null && fallbackHoldingCost
        ? roundNumber((estHoldingProfit / fallbackHoldingCost) * 100, 2)
        : confirmedHoldingProfitRate;

      return {
        ...holding,
        latest_nav: estNav,
        display_daily_change_pct: selfEstimate.estimated_change_pct,
        display_daily_profit: estDailyProfit,
        display_market_value: estMv,
        display_holding_profit: estHoldingProfit,
        display_holding_profit_rate: estHoldingRate,
        confirmed_baseline: baseline || null,
        realtime: {
          status: "estimated",
          source: "holdings_weighted_estimate",
          as_of: selfEstimate.as_of,
          coverage: "live",
          estimated_nav: estNav,
          estimated_change_pct: selfEstimate.estimated_change_pct,
          estimated_market_value: estMv,
          estimated_daily_profit: estDailyProfit,
          estimated_holding_profit: estHoldingProfit,
          estimated_holding_profit_rate: estHoldingRate,
          confirmed_nav: confirmedNav,
          confirmed_nav_date: confirmedDate,
          confirmed_market_value: confirmedMarketValue,
          estimate_coverage_pct: selfEstimate.coverage_pct,
          estimate_holdings_used: selfEstimate.holdings_used,
          estimate_holdings_total: selfEstimate.holdings_total,
          estimate_report_date: selfEstimate.report_date,
          estimate_in_trading: selfEstimate.in_trading_hours,
          estimate_details: selfEstimate.details,
          pending_nav: !isToday,
        },
      };
    }

    // Estimate failed, fall back to confirmed-only display
    return {
      ...holding,
      latest_nav: confirmedNav ?? holding.latest_nav,
      display_daily_change_pct: displayDailyPct,
      display_daily_profit: displayDailyProfit,
      display_market_value: confirmedMarketValue,
      display_holding_profit: confirmedHoldingProfit,
      display_holding_profit_rate: confirmedHoldingProfitRate,
      confirmed_baseline: baseline || null,
      realtime: {
        status: "confirmed_only",
        source: "pingzhongdata_confirmed_nav",
        as_of: confirmedDate,
        coverage: isToday ? "confirmed_no_estimate" : "confirmed_stale_no_estimate",
        estimated_nav: null,
        estimated_change_pct: null,
        estimated_market_value: null,
        estimated_daily_profit: null,
        estimated_holding_profit: null,
        estimated_holding_profit_rate: null,
        confirmed_nav: confirmedNav,
        confirmed_nav_date: confirmedDate,
        confirmed_market_value: confirmedMarketValue,
        pending_nav: !isToday,
      },
    };
  }

  const estimatedNav = safeNumber(quote.gsz);
  const estimatedChangePct = safeNumber(quote.gszzl);
  const proxyEstimatedNav =
    isQdiiProxy && confirmedNav !== null && estimatedChangePct !== null
      ? roundNumber(confirmedNav * (1 + estimatedChangePct / 100), 4)
      : null;
  const estimatedMarketValue =
    shares !== null && (estimatedNav ?? proxyEstimatedNav) !== null
      ? roundNumber(shares * (estimatedNav ?? proxyEstimatedNav), 2)
      : confirmedMarketValue;
  const estimatedHoldingProfit =
    estimatedMarketValue !== null && fallbackHoldingCost !== null
      ? roundNumber(estimatedMarketValue - fallbackHoldingCost, 2)
      : confirmedHoldingProfit;
  const estimatedHoldingProfitRate =
    estimatedHoldingProfit !== null && fallbackHoldingCost
      ? roundNumber((estimatedHoldingProfit / fallbackHoldingCost) * 100, 2)
      : confirmedHoldingProfitRate;
  const estimatedDailyProfit =
    estimatedMarketValue !== null && confirmedMarketValue !== null
      ? roundNumber(estimatedMarketValue - confirmedMarketValue, 2)
      : safeNumber(holding.yesterday_profit);

  if (
    (confirmedUpdated || persistentConfirmedUpdate) &&
    isTodayConfirmedDate &&
    safeNumber((confirmedUpdated ? previousBaseline?.confirmed_nav : baseline?.previous_confirmed_nav)) !== null &&
    safeNumber(
      confirmedUpdated ? previousBaseline?.confirmed_market_value : baseline?.previous_confirmed_market_value,
    ) !== null &&
    baseline?.confirmed_nav !== null &&
    baseline?.confirmed_market_value !== null
  ) {
    const previousConfirmedNav = safeNumber(
      confirmedUpdated ? previousBaseline?.confirmed_nav : baseline?.previous_confirmed_nav,
    );
    const previousConfirmedMarketValue = safeNumber(
      confirmedUpdated ? previousBaseline?.confirmed_market_value : baseline?.previous_confirmed_market_value,
    );
    const confirmedDailyChangePct =
      previousConfirmedNav && baseline.confirmed_nav !== null
        ? roundNumber(((baseline.confirmed_nav - previousConfirmedNav) / previousConfirmedNav) * 100, 2)
        : estimatedChangePct;
    const confirmedDailyProfit =
      previousConfirmedMarketValue !== null && confirmedMarketValue !== null
        ? roundNumber(confirmedMarketValue - previousConfirmedMarketValue, 2)
        : estimatedDailyProfit;

    return {
      ...holding,
      latest_nav: confirmedNav ?? holding.latest_nav,
      display_daily_change_pct: confirmedDailyChangePct,
      display_daily_profit: confirmedDailyProfit,
      display_market_value: confirmedMarketValue,
      display_holding_profit: confirmedHoldingProfit,
      display_holding_profit_rate: confirmedHoldingProfitRate,
      confirmed_baseline: baseline || null,
      realtime: {
        status: "confirmed_updated",
        source: "fund_confirmed_nav",
        as_of: quote?.gztime || null,
        coverage: "confirmed",
        estimated_nav: confirmedNav,
        estimated_change_pct: confirmedDailyChangePct,
        estimated_market_value: confirmedMarketValue,
        estimated_daily_profit: confirmedDailyProfit,
        estimated_holding_profit: confirmedHoldingProfit,
        estimated_holding_profit_rate: confirmedHoldingProfitRate,
        confirmed_nav: confirmedNav,
        confirmed_nav_date: baseline?.confirmed_nav_date || quote?.jzrq || null,
        confirmed_market_value: confirmedMarketValue,
        last_confirmed_nav: safeNumber(quote?.dwjz),
        last_confirmed_date: quote?.jzrq || null,
        was_rolled_forward: Boolean(confirmedUpdated),
      },
    };
  }

  return {
    ...holding,
    latest_nav: estimatedNav ?? proxyEstimatedNav ?? confirmedNav ?? holding.latest_nav,
    display_daily_change_pct: estimatedChangePct ?? safeNumber(holding.daily_change_pct),
    display_daily_profit: estimatedDailyProfit,
    display_market_value: estimatedMarketValue,
    display_holding_profit: estimatedHoldingProfit,
    display_holding_profit_rate: estimatedHoldingProfitRate,
    confirmed_baseline: baseline || null,
    realtime: {
      status: "estimated",
      source: isQdiiProxy ? "qdii_topix_proxy" : "eastmoney_fundgz",
      as_of: quote.gztime || null,
      coverage: isQdiiProxy ? "proxy" : "live",
      estimated_nav: estimatedNav ?? proxyEstimatedNav,
      estimated_change_pct: estimatedChangePct,
      estimated_market_value: estimatedMarketValue,
      estimated_daily_profit: estimatedDailyProfit,
      estimated_holding_profit: estimatedHoldingProfit,
      estimated_holding_profit_rate: estimatedHoldingProfitRate,
      confirmed_nav: confirmedNav,
      confirmed_nav_date: baseline?.confirmed_nav_date || quote.jzrq || null,
      confirmed_market_value: confirmedMarketValue,
      last_confirmed_nav: safeNumber(quote.dwjz),
      last_confirmed_date: quote.jzrq || null,
      proxy_symbol: quote.proxy_symbol || null,
      proxy_name: quote.proxy_name || null,
      proxy_weight: quote.proxy_weight || null,
    },
  };
}

function calculateRealtimeSummary(holdings) {
  const totalMarketValue = holdings.reduce((sum, item) => sum + (safeNumber(item.display_market_value) || 0), 0);
  const totalDailyProfit = holdings.reduce((sum, item) => sum + (safeNumber(item.display_daily_profit) || 0), 0);
  const totalHoldingProfit = holdings.reduce((sum, item) => sum + (safeNumber(item.display_holding_profit) || 0), 0);
  const weightedDailyChange = holdings.reduce((sum, item) => {
    const marketValue = safeNumber(item.display_market_value) || 0;
    const dailyChangePct = safeNumber(item.display_daily_change_pct) || 0;
    return sum + marketValue * dailyChangePct;
  }, 0);
  const estimatedCost = totalMarketValue - totalHoldingProfit;
  const totalHoldingProfitRate =
    estimatedCost > 0 ? roundNumber((totalHoldingProfit / estimatedCost) * 100, 2) : null;
  const portfolioDailyChangePct =
    totalMarketValue > 0 ? roundNumber(weightedDailyChange / totalMarketValue, 2) : null;

  const estimatedCount = holdings.filter((item) => item.realtime?.status === "estimated").length;
  const fallbackCount = holdings.filter((item) => item.realtime?.status !== "estimated").length;
  const baselineDates = holdings
    .map((item) => item.confirmed_baseline?.confirmed_nav_date)
    .filter(Boolean)
    .sort();
  const estimateTimestamps = holdings
    .map((item) => item.realtime?.as_of)
    .filter(Boolean)
    .sort();
  const latestEstimateAsOf = estimateTimestamps.at(-1) || null;

  return {
    total_market_value: roundNumber(totalMarketValue, 2),
    today_profit: roundNumber(totalDailyProfit, 2),
    portfolio_daily_change_pct: portfolioDailyChangePct,
    holding_profit: roundNumber(totalHoldingProfit, 2),
    holding_profit_rate: totalHoldingProfitRate,
    estimate_as_of: latestEstimateAsOf,
    realtime_coverage: {
      estimated_count: estimatedCount,
      fallback_count: fallbackCount,
      total_count: holdings.length,
      status: fallbackCount === 0 ? "full" : estimatedCount > 0 ? "partial" : "none",
      latest_confirmed_nav_date: baselineDates.at(-1) || null,
      oldest_confirmed_nav_date: baselineDates[0] || null,
    },
  };
}

export async function initializeConfirmedSnapshotFromHoldings(holdings, source = "manual_import") {
  const snapshot = {
    schema_version: "v1",
    generated_at: nowIso(),
    source,
    holdings: holdings.map((holding) => buildBaselineRecord(holding)),
  };
  await saveConfirmedSnapshot(snapshot);
  return snapshot;
}

export async function buildRealtimeOverlay(holdings) {
  const confirmedSnapshot = await loadOrInitializeConfirmedSnapshot(holdings);
  const baselineEntries = buildBaselineIndexes(confirmedSnapshot);

  let baselineChanged = false;
  const realtimeHoldings = await Promise.all(
    holdings.map(async (holding) => {
      const lookupKey = holdingKey(holding);
      const lookupName = normalizeFundName(holding.fund_name);
      const matchedBaseline =
        (lookupKey ? baselineEntries.byKey.get(lookupKey) : null) ||
        (lookupName ? baselineEntries.byName.get(lookupName) : null) ||
        null;
      const effectiveFundCode = resolveRealtimeFundCode(holding, matchedBaseline);
      let quote = effectiveFundCode ? await getCachedFundEstimate(effectiveFundCode) : null;
      if ((!quote || !quote.fundcode) && effectiveFundCode && QDII_PROXY_CONFIG[effectiveFundCode]) {
        quote = await getQdiiProxyQuote(effectiveFundCode);
      }
      const { baseline, changed, previousBaseline, confirmedUpdated } = mergeConfirmedBaseline(
        holding,
        baselineEntries,
        quote,
      );
      baselineChanged ||= changed;
      return await buildHoldingRealtime(
        effectiveFundCode && !holding.fund_code ? { ...holding, fund_code: effectiveFundCode } : holding,
        quote,
        baseline,
        { previousBaseline, confirmedUpdated, fundCode: effectiveFundCode },
      );
    }),
  );

  const nextConfirmedSnapshot = {
    schema_version: "v1",
    generated_at: nowIso(),
    source: baselineChanged ? "fundgz_confirmed_nav_roll_forward" : confirmedSnapshot.source,
    holdings: [...baselineEntries.byKey.values()],
  };

  if (baselineChanged) {
    await saveConfirmedSnapshot(nextConfirmedSnapshot);
  }

  const summary = calculateRealtimeSummary(realtimeHoldings);
  await persistRealtimeSnapshot({
    source: "api_holdings_realtime_overlay",
    summary,
    holdings: realtimeHoldings.map((holding) => ({
      fund_code: holding.fund_code || null,
      fund_name: holding.fund_name || null,
      display_daily_change_pct: holding.display_daily_change_pct,
      display_daily_profit: holding.display_daily_profit,
      display_market_value: holding.display_market_value,
      display_holding_profit: holding.display_holding_profit,
      display_holding_profit_rate: holding.display_holding_profit_rate,
      realtime: holding.realtime,
      confirmed_baseline: holding.confirmed_baseline,
    })),
  }, summary);

  return {
    holdings: realtimeHoldings,
    summary,
    confirmedSnapshot: nextConfirmedSnapshot,
  };
}

export function clearRealtimeCache() {
  quoteCache = new Map();
}
