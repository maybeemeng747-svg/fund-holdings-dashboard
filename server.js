import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import https from "node:https";
import { extractPortfolioFromScreenshot, validateImportPayload } from "./src/import-service.js";
import {
  buildDashboardPayload,
  getCurrentHoldings,
  writeConfirmedImport,
} from "./src/portfolio-store.js";
import { fetchAshareMarketSummary } from "./src/market-summary.js";
import { fetchStockRealtime } from "./src/stock-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3030);
const WATCHLIST_LIMIT = 10;

let _polysiliconCache = null;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
  } catch (error) {
    sendText(res, 404, "Not Found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/holdings") {
    const payload = await buildDashboardPayload();
    // Merge stock quotes into payload summary and add stocks array
    const rawHoldings = await getCurrentHoldings();
    const stockItems = rawHoldings.stocks || [];
    if (stockItems.length > 0) {
      const stockQuotes = await fetchStockRealtime(stockItems);

      const es = payload.summary;
      const estimateAsOf = es.estimate_as_of;
      const estimateAge = estimateAsOf ? Date.now() - new Date(estimateAsOf).getTime() : Infinity;
      const estimateFresh = es.realtime_coverage?.estimated_count > 0
        && estimateAsOf
        && estimateAge >= 0
        && estimateAge <= 300000;

      let fundMv;
      let fundHoldProfit;
      let fundDailyProfit;
      if (estimateFresh) {
        fundMv = es.estimated_total_market_value ?? es.confirmed_total_market_value ?? es.total_market_value ?? 0;
        fundHoldProfit = es.estimated_holding_profit ?? es.confirmed_holding_profit ?? es.holding_profit ?? 0;
        fundDailyProfit = es.estimated_today_profit ?? es.today_profit ?? 0;
      } else {
        // Compute from enriched holdings (confirmed values) for consistency with dashboard
        fundMv = payload.holdings.reduce((s, h) => s + (h.display_market_value || h.confirmed_baseline?.confirmed_market_value || h.current_market_value || 0), 0);
        fundHoldProfit = payload.holdings.reduce((s, h) => s + (h.display_holding_profit || h.confirmed_baseline?.confirmed_holding_profit || h.current_holding_profit || 0), 0);
        fundDailyProfit = es.estimated_today_profit ?? es.today_profit ?? 0;
      }

      const stockMv = stockQuotes.reduce((s, q) => s + (q.display_market_value || 0), 0);
      const stockDailyProfit = stockQuotes.reduce((s, q) => s + (q.display_daily_profit || 0), 0);
      const stockHoldProfit = stockQuotes.reduce((s, q) => s + (q.display_holding_profit || 0), 0);
      const combinedMv = fundMv + stockMv;
      const combinedHoldProfit = fundHoldProfit + stockHoldProfit;
      const combinedCost = combinedMv - combinedHoldProfit;
      const combinedHoldPct = combinedCost > 0 ? Number(((combinedHoldProfit / combinedCost) * 100).toFixed(2)) : null;
      // Recalculate portfolio weight to include stocks
      const updatedHoldings = payload.holdings.map(h => ({
        ...h,
        portfolio_weight_pct: combinedMv > 0 && h.current_market_value
          ? Number((((h.current_market_value || 0) / combinedMv) * 100).toFixed(2))
          : h.portfolio_weight_pct,
      }));
      const stocksWithWeight = stockQuotes.map(q => ({
        ...q,
        asset_type: "stock",
        portfolio_weight_pct: combinedMv > 0 ? Number(((q.display_market_value || 0) / combinedMv * 100).toFixed(2)) : null,
      }));
      payload.holdings = updatedHoldings;
      payload.stocks = stocksWithWeight;
      payload.summary = {
        ...payload.summary,
        combined_total_market_value: Number(combinedMv.toFixed(2)),
        combined_holding_profit: Number(combinedHoldProfit.toFixed(2)),
        combined_holding_profit_rate: combinedHoldPct,
        combined_today_profit: Number((fundDailyProfit + stockDailyProfit).toFixed(2)),
        fund_market_value: Number(fundMv.toFixed(2)),
        stock_market_value: Number(stockMv.toFixed(2)),
      };
      payload.data_source = {
        ...payload.data_source,
        fund_values_source: estimateFresh ? "estimated" : "confirmed",
      };
    }
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/realtime-snapshot") {
    try {
      // Trigger a fresh build so the snapshot is always up-to-date
      await buildDashboardPayload();
      const snapshotPath = path.join(__dirname, "portfolio", "realtime_snapshot.json");
      const raw = await fs.readFile(snapshotPath, "utf8");
      const snapshot = JSON.parse(raw);
      sendJson(res, 200, snapshot);
    } catch (error) {
      sendJson(res, 500, { error: "实时快照读取失败: " + error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stock-quotes") {
    try {
      const holdings = await getCurrentHoldings();
      const stockItems = holdings.stocks || (holdings.holdings || []).filter(h => h._is_stock || h.stock_code);
      const watchlistItems = (holdings.workspace_meta?.watchlist || holdings.watchlist || [])
        .filter(item => item?.code || item?.stock_code || item?.fund_code)
        .slice(0, WATCHLIST_LIMIT);
      const allQuotes = await fetchStockRealtime([...stockItems, ...watchlistItems]);
      const quotes = allQuotes.slice(0, stockItems.length);
      const watchlistQuotes = allQuotes.slice(stockItems.length);
      sendJson(res, 200, { quotes, watchlist_quotes: watchlistQuotes });
    } catch (error) {
      sendJson(res, 200, { quotes: [], watchlist_quotes: [] });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market-summary") {
    const summary = await fetchAshareMarketSummary();
    sendJson(res, 200, summary);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/polysilicon") {
    try {
      const cached = _polysiliconCache;
      if (cached && Date.now() - cached.fetchedAt < 60000) {
        sendJson(res, 200, cached.data);
        return;
      }
      // Fetch 通威股份 (600438) as polysilicon proxy via Sina
      const data = await new Promise((resolve, reject) => {
        const url = `https://hq.sinajs.cn/list=sh600438`;
        https.get(url, {
          headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            try {
              const text = new TextDecoder("gbk").decode(Buffer.concat(chunks));
              const match = text.match(/="([^"]+)"/);
              if (match) {
                const f = match[1].split(",");
                const name = f[0];
                const current = parseFloat(f[3]);
                const prevClose = parseFloat(f[2]);
                const pct = prevClose > 0 ? ((current - prevClose) / prevClose * 100) : 0;
                resolve({ name, code: "600438", price: current, prev_close: prevClose, change_pct: Math.round(pct * 100) / 100, status: "ok" });
              } else {
                resolve({ status: "error", message: "parse failed" });
              }
            } catch (e) { reject(e); }
          });
        }).on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 5000);
      });
      _polysiliconCache = { data, fetchedAt: Date.now() };
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 200, { status: "error", message: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/raw-holdings") {
    const payload = await getCurrentHoldings();
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/extract") {
    try {
      const body = await readJsonBody(req);
      const preview = await extractPortfolioFromScreenshot(body);
      sendJson(res, 200, preview);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "截图提取失败" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/confirm") {
    try {
      const body = await readJsonBody(req);
      validateImportPayload(body);
      const result = await writeConfirmedImport(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "写入失败" });
    }
    return;
  }

  sendJson(res, 404, { error: "API Not Found" });
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || "").startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器内部错误" });
  }
});

server.listen(port, () => {
  console.log(`Fund dashboard is running at http://localhost:${port}`);
});
