import { readFile } from "node:fs/promises";
import https from "node:https";
import { homedir } from "node:os";

const movingAverageCache = new Map();
const MOVING_AVERAGE_CACHE_MS = 45000;
const tushareDailyCache = new Map();
const TUSHARE_DAILY_CACHE_MS = 6 * 60 * 60 * 1000;
let tushareTokenPromise;

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function stockCode(stock) {
  return stock.stock_code || stock.fund_code || stock.code || "";
}

function stockName(stock) {
  return stock.stock_name || stock.fund_name || stock.name || "";
}

export function normalizeStockQuote(stock, quote = null) {
  const code = stockCode(stock);
  const name = stockName(stock);
  const shares = safeNumber(stock.shares) ?? safeNumber(stock.volume) ?? 0;
  const costPrice = safeNumber(stock.cost_price) ?? safeNumber(stock.cost_nav) ?? 0;
  const currentPrice = safeNumber(quote?.current_price) ?? safeNumber(stock.current_price) ?? 0;
  const prevClose = safeNumber(quote?.prev_close) ?? safeNumber(stock.prev_close) ?? currentPrice;
  const marketValue =
    safeNumber(quote?.display_market_value) ??
    safeNumber(stock.market_value) ??
    (currentPrice > 0 && shares > 0 ? currentPrice * shares : 0);
  const dailyChangePct =
    safeNumber(quote?.display_daily_change_pct) ??
    safeNumber(stock.daily_change_pct) ??
    (prevClose > 0 && currentPrice > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0);
  const dailyProfit =
    safeNumber(quote?.display_daily_profit) ??
    safeNumber(stock.daily_profit) ??
    safeNumber(stock.today_profit) ??
    safeNumber(stock.yesterday_profit) ??
    (prevClose > 0 && currentPrice > 0 && shares > 0 ? (currentPrice - prevClose) * shares : 0);
  const holdingProfit =
    safeNumber(quote?.display_holding_profit) ??
    safeNumber(stock.profit) ??
    safeNumber(stock.holding_profit) ??
    (costPrice > 0 && currentPrice > 0 && shares > 0 ? (currentPrice - costPrice) * shares : 0);
  const holdingProfitRate =
    safeNumber(quote?.display_holding_profit_rate) ??
    safeNumber(stock.profit_pct) ??
    safeNumber(stock.holding_profit_rate) ??
    (costPrice > 0 && currentPrice > 0 ? ((currentPrice - costPrice) / costPrice) * 100 : 0);

  return {
    stock_code: code,
    stock_name: quote?.stock_name || name,
    display_name: quote?.display_name || quote?.stock_name || name,
    current_price: currentPrice,
    prev_close: prevClose,
    open: safeNumber(quote?.open),
    high: safeNumber(quote?.high),
    low: safeNumber(quote?.low),
    volume: safeNumber(quote?.volume),
    amount: safeNumber(quote?.amount),
    shares,
    available_shares: safeNumber(stock.available_shares) ?? null,
    cost_price: costPrice,
    display_market_value: Number(marketValue.toFixed(2)),
    display_daily_change_pct: Number(dailyChangePct.toFixed(4)),
    display_daily_profit: Number(dailyProfit.toFixed(2)),
    display_holding_profit: Number(holdingProfit.toFixed(2)),
    display_holding_profit_rate: Number(holdingProfitRate.toFixed(2)),
    quote_status: quote ? "realtime" : "local_fallback",
  };
}

export function stockSinaSymbol(code) {
  const value = String(code || "");
  return (/^\d{5}$/.test(value) ? "hk" : value.startsWith("6") ? "sh" : "sz") + value;
}

export function stockTushareCode(code) {
  const value = String(code || "");
  if (!/^\d{6}$/.test(value)) return null;
  if (/^[4689]/.test(value)) return `${value}.${value.startsWith("6") ? "SH" : "BJ"}`;
  return `${value}.SZ`;
}

export function parseTushareTable(payload) {
  if (!payload || payload.code !== 0) {
    throw new Error(payload?.msg || "Tushare request failed");
  }

  const fields = payload.data?.fields;
  const items = payload.data?.items;
  if (!Array.isArray(fields) || !Array.isArray(items)) return [];
  return items
    .filter(Array.isArray)
    .map((item) => Object.fromEntries(fields.map((field, index) => [field, item[index]])));
}

export function calculateTushareMovingAverages(dailyRows, currentPrice, quoteTime) {
  const rows = (dailyRows || [])
    .map((row) => ({ trade_date: String(row?.trade_date || ""), close: safeNumber(row?.close) }))
    .filter((row) => /^\d{8}$/.test(row.trade_date) && row.close > 0)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const quoteDate = String(quoteTime || "").slice(0, 10).replaceAll("-", "");
  const price = safeNumber(currentPrice);
  const previousRow = quoteDate ? rows.filter((row) => row.trade_date < quoteDate).at(-1) : rows.at(-1);

  if (price > 0 && /^\d{8}$/.test(quoteDate)) {
    const todayRow = rows.find((row) => row.trade_date === quoteDate);
    if (todayRow) todayRow.close = price;
    else rows.push({ trade_date: quoteDate, close: price });
    rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  }

  if (rows.length < 20) return null;
  const average = (count) => {
    const values = rows.slice(-count).map((row) => row.close);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const asOf = rows.at(-1).trade_date;
  return {
    prev_close: previousRow?.close ?? null,
    ma5: Number(average(5).toFixed(3)),
    ma20: Number(average(20).toFixed(3)),
    ma_as_of: `${asOf.slice(0, 4)}-${asOf.slice(4, 6)}-${asOf.slice(6, 8)}`,
  };
}

export function parseSinaMovingAverages(responseText) {
  const match = String(responseText || "").match(/=\((\[.*\])\)/s);
  if (!match) return null;

  try {
    const rows = JSON.parse(match[1]);
    const validRows = rows.filter((row) => Number.isFinite(Number(row?.close)) && Number(row.close) > 0);
    if (validRows.length < 20) return null;
    const closes = validRows.map((row) => Number(row.close));
    const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      ma5: Number(average(closes.slice(-5)).toFixed(3)),
      ma20: Number(average(closes.slice(-20)).toFixed(3)),
      ma_as_of: validRows.at(-1)?.day || null,
    };
  } catch {
    return null;
  }
}

export function parseSinaStockQuoteResponse(stock, responseText) {
  const match = String(responseText || "").match(/="([^"]+)"/);
  if (!match) return null;

  const fields = match[1].split(",");
  const isHK = stockSinaSymbol(stockCode(stock)).startsWith("hk");
  if (fields.length < (isHK ? 19 : 33)) return null;

  const name = fields[isHK ? 1 : 0];
  const open = parseFloat(fields[isHK ? 2 : 1]);
  const prevClose = parseFloat(fields[isHK ? 3 : 2]);
  const current = parseFloat(fields[isHK ? 6 : 3]);
  const high = parseFloat(fields[4]);
  const low = parseFloat(fields[5]);
  const volume = parseFloat(fields[isHK ? 12 : 8]);
  const amount = parseFloat(fields[isHK ? 11 : 9]);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(prevClose) || prevClose <= 0) {
    return null;
  }

  const shares = safeNumber(stock.shares) ?? safeNumber(stock.volume) ?? 0;
  const costPrice = safeNumber(stock.cost_price) ?? safeNumber(stock.cost_nav) ?? 0;
  const dailyChangePct = ((current - prevClose) / prevClose) * 100;

  return {
    stock_code: stockCode(stock),
    stock_name: name || stockName(stock),
    display_name: name || stockName(stock),
    current_price: current,
    prev_close: prevClose,
    open,
    high,
    low,
    volume,
    amount,
    shares,
    display_market_value: current * shares,
    display_daily_change_pct: dailyChangePct,
    display_daily_profit: (current - prevClose) * shares,
    display_holding_profit: costPrice > 0 ? (current - costPrice) * shares : 0,
    display_holding_profit_rate: costPrice > 0 ? ((current - costPrice) / costPrice) * 100 : 0,
  };
}

async function fetchSinaQuote(stock) {
  const code = stockCode(stock);
  const symbol = stockSinaSymbol(code);
  const quote = await new Promise((resolve, reject) => {
    const url = `https://hq.sinajs.cn/list=${symbol}`;
    const req = https.get(
      url,
      {
        headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const decoder = new TextDecoder("gbk");
            resolve(decoder.decode(Buffer.concat(chunks)));
          } catch {
            resolve(Buffer.concat(chunks).toString("utf8"));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error("timeout"));
    });
  });

  return parseSinaStockQuoteResponse(stock, quote);
}

async function fetchSinaMovingAverages(stock) {
  const code = stockCode(stock);
  if (!/^\d{6}$/.test(code)) return null;

  const cached = movingAverageCache.get(code);
  if (cached && Date.now() - cached.fetchedAt < MOVING_AVERAGE_CACHE_MS) return cached.value;

  const symbol = stockSinaSymbol(code);
  const responseText = await new Promise((resolve, reject) => {
    const url = `https://quotes.sina.cn/cn/api/jsonp.php/var%20_KKE_Symbols_=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=21`;
    const req = https.get(
      url,
      { headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });

  const value = parseSinaMovingAverages(responseText);
  movingAverageCache.set(code, { value, fetchedAt: Date.now() });
  return value;
}

async function readTushareToken() {
  const directToken = process.env.TUSHARE_TOKEN?.trim();
  if (directToken) return directToken;

  const envFile = process.env.TUSHARE_ENV_FILE || `${homedir()}/TradingAgents-AShare/.env`;
  const content = await readFile(envFile, "utf8");
  const match = content.match(/^\s*(?:export\s+)?TUSHARE_TOKEN\s*=\s*(.+?)\s*$/m);
  if (!match) return null;
  const rawValue = match[1].trim();
  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    return rawValue.slice(1, -1).trim() || null;
  }
  return rawValue.split(/\s+#/)[0].trim() || null;
}

async function getTushareToken() {
  tushareTokenPromise ||= readTushareToken().catch(() => null);
  return tushareTokenPromise;
}

async function callTushare(apiName, params, fields) {
  const token = await getTushareToken();
  if (!token) throw new Error("Tushare token unavailable");
  const body = JSON.stringify({ api_name: apiName, token, params, fields: fields.join(",") });

  const responseText = await new Promise((resolve, reject) => {
    const req = https.request(
      "https://api.tushare.pro",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "investment-controller/1.0",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`Tushare HTTP ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(6000, () => req.destroy(new Error("timeout")));
    req.end(body);
  });

  return parseTushareTable(JSON.parse(responseText));
}

function compactDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

async function fetchTushareDaily(tsCode) {
  const cached = tushareDailyCache.get(tsCode);
  if (cached && Date.now() - cached.fetchedAt < TUSHARE_DAILY_CACHE_MS) return cached.value;

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  const rows = await callTushare(
    "daily",
    { ts_code: tsCode, start_date: compactDate(start), end_date: compactDate(end) },
    ["ts_code", "trade_date", "close"],
  );
  tushareDailyCache.set(tsCode, { value: rows, fetchedAt: Date.now() });
  return rows;
}

async function fetchTushareRealtime(stockItems) {
  const stocksByTsCode = new Map(
    (stockItems || [])
      .map((stock) => [stockTushareCode(stockCode(stock)), stock])
      .filter(([tsCode]) => tsCode),
  );
  if (stocksByTsCode.size === 0) return new Map();

  const rows = await callTushare(
    "rt_min",
    { ts_code: [...stocksByTsCode.keys()].join(","), freq: "1MIN" },
    ["ts_code", "time", "open", "close", "high", "low", "vol", "amount"],
  );
  const results = new Map();
  await Promise.all(rows.map(async (row) => {
    const stock = stocksByTsCode.get(row.ts_code);
    const currentPrice = safeNumber(row.close);
    if (!stock || !currentPrice || currentPrice <= 0) return;

    let movingAverages = null;
    try {
      const dailyRows = await fetchTushareDaily(row.ts_code);
      movingAverages = calculateTushareMovingAverages(dailyRows, currentPrice, row.time);
    } catch (error) {
      console.error(`Tushare daily failed for ${stockCode(stock)}:`, error.message);
    }
    if (!movingAverages?.prev_close) return;
    results.set(stockCode(stock), {
      quote: {
        stock_code: stockCode(stock),
        stock_name: stockName(stock),
        current_price: currentPrice,
        prev_close: movingAverages?.prev_close,
        open: safeNumber(row.open),
        high: safeNumber(row.high),
        low: safeNumber(row.low),
        volume: safeNumber(row.vol),
        amount: safeNumber(row.amount),
      },
      movingAverages,
    });
  }));
  return results;
}

export async function fetchStockRealtime(stockItems) {
  const items = stockItems || [];
  const tushareResults = await fetchTushareRealtime(items).catch((error) => {
    console.error("Tushare realtime unavailable, using Sina fallback:", error.message);
    return new Map();
  });

  return Promise.all(items.map(async (stock) => {
    const code = stockCode(stock);
    const tushareResult = tushareResults.get(code);
    if (tushareResult) {
      const movingAverages = tushareResult.movingAverages || await fetchSinaMovingAverages(stock).catch(() => null);
      return {
        ...normalizeStockQuote(stock, tushareResult.quote),
        ...(movingAverages || {}),
        quote_source: "tushare_rt_min",
        ma_source: tushareResult.movingAverages ? "tushare_daily" : "sina_kline",
      };
    }

    const [quote, movingAverages] = await Promise.all([
      fetchSinaQuote(stock).catch((err) => {
        console.error(`Stock quote failed for ${code}:`, err.message);
        return null;
      }),
      fetchSinaMovingAverages(stock).catch((err) => {
        console.error(`Stock moving averages failed for ${code}:`, err.message);
        return null;
      }),
    ]);
    return {
      ...normalizeStockQuote(stock, quote),
      ...(movingAverages || {}),
      quote_source: quote ? "sina" : "local",
      ma_source: movingAverages ? "sina_kline" : null,
    };
  }));
}
