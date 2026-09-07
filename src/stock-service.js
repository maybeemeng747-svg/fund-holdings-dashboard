import https from "node:https";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function normalizeStockQuote(stock, quote = null) {
  const code = stock.stock_code || stock.fund_code || "";
  const stockName = stock.stock_name || stock.fund_name || "";
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
    stock_name: quote?.stock_name || stockName,
    display_name: quote?.display_name || quote?.stock_name || stockName,
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

export function parseSinaStockQuoteResponse(stock, responseText) {
  const match = String(responseText || "").match(/="([^"]+)"/);
  if (!match) return null;

  const fields = match[1].split(",");
  const isHK = stockSinaSymbol(stock.stock_code || stock.fund_code).startsWith("hk");
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
    stock_code: stock.stock_code || stock.fund_code || "",
    stock_name: name || stock.stock_name || stock.fund_name || "",
    display_name: name || stock.stock_name || "",
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
  const code = stock.stock_code || stock.fund_code || "";
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

export async function fetchStockRealtime(stockItems) {
  return Promise.all((stockItems || []).map(async (stock) => {
    const code = stock.stock_code || stock.fund_code || "";
    try {
      const quote = await fetchSinaQuote(stock);
      return normalizeStockQuote(stock, quote);
    } catch (err) {
      console.error(`Stock quote failed for ${code}:`, err.message);
      return normalizeStockQuote(stock);
    }
  }));
}
