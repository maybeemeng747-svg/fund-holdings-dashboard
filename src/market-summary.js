import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREV_TURNOVER_FILE = path.resolve(__dirname, "../portfolio/prev_turnover.json");

const SINA_MARKET_SUMMARY_URL =
  "https://hq.sinajs.cn/list=s_sh000001,s_sz399001";
const CACHE_TTL_MS = 45 * 1000;
const AMOUNT_UNIT_YUAN = 10000;

let cachedSummary = null;
let fetchedAt = 0;

export function updateTurnoverHistory(stored, today, totalAmountYuan, shouldPersist) {
  const legacyCurrent = stored?.date
    ? { date: stored.date, total_amount_yuan: stored.total_amount_yuan }
    : null;
  const history = {
    current: stored?.current || legacyCurrent,
    previous: stored?.previous || null,
  };

  const previousAmount = history.current?.date === today
    ? history.previous?.total_amount_yuan ?? null
    : history.current?.total_amount_yuan ?? null;

  if (!shouldPersist) {
    return { history, previousAmount, changed: false };
  }

  if (history.current?.date === today) {
    const changed = history.current.total_amount_yuan !== totalAmountYuan;
    history.current = { date: today, total_amount_yuan: totalAmountYuan };
    return { history, previousAmount, changed };
  }

  history.previous = history.current;
  history.current = { date: today, total_amount_yuan: totalAmountYuan };
  return { history, previousAmount, changed: true };
}

function persistPrevTurnover(totalAmountYuan) {
  const now = new Date();
  const cstHour = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }));
  const cstMinute = parseInt(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai", minute: "2-digit" }));
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

  let stored = null;
  try {
    stored = JSON.parse(fs.readFileSync(PREV_TURNOVER_FILE, "utf8"));
  } catch { /* file may not exist yet */ }

  const shouldPersist = cstHour > 15 || (cstHour === 15 && cstMinute >= 5);
  const { history, previousAmount, changed } = updateTurnoverHistory(
    stored,
    today,
    totalAmountYuan,
    shouldPersist,
  );
  if (changed) {
    try {
      fs.writeFileSync(PREV_TURNOVER_FILE, `${JSON.stringify(history, null, 2)}\n`);
    } catch { /* best-effort */ }
  }
  return previousAmount;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseSinaMarketSummary(text) {
  const exchanges = {};

  for (const line of String(text || "").split("\n")) {
    const match = line.match(/hq_str_s_(sh000001|sz399001)="([^"]+)"/);
    if (!match) continue;

    const [, symbol, payload] = match;
    const fields = payload.split(",");
    const amount = safeNumber(fields[5]);
    if (amount === null || amount < 0) continue;

    const exchange = symbol.startsWith("sh") ? "shanghai" : "shenzhen";
    exchanges[exchange] = {
      name: fields[0] || (exchange === "shanghai" ? "沪市" : "深市"),
      amount_yuan: Math.round(amount * AMOUNT_UNIT_YUAN),
    };
  }

  if (!exchanges.shanghai || !exchanges.shenzhen) return null;

  return {
    status: "ok",
    source: "sina_market_indices",
    as_of: new Date().toISOString(),
    shanghai_amount_yuan: exchanges.shanghai.amount_yuan,
    shenzhen_amount_yuan: exchanges.shenzhen.amount_yuan,
    total_amount_yuan:
      exchanges.shanghai.amount_yuan + exchanges.shenzhen.amount_yuan,
  };
}

function requestMarketSummary() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      SINA_MARKET_SUMMARY_URL,
      {
        headers: {
          Referer: "https://finance.sina.com.cn/",
          "User-Agent": "Mozilla/5.0 FundDashboard/1.0",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = new TextDecoder("gbk").decode(Buffer.concat(chunks));
          const summary = parseSinaMarketSummary(text);
          if (!summary) {
            reject(new Error("market summary parse failed"));
            return;
          }
          resolve(summary);
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("market summary timeout")));
  });
}

export async function fetchAshareMarketSummary() {
  if (cachedSummary && Date.now() - fetchedAt < CACHE_TTL_MS) {
    return cachedSummary;
  }

  try {
    const summary = await requestMarketSummary();

    // Attach previous trading day turnover for comparison
    const prevAmount = persistPrevTurnover(summary.total_amount_yuan);
    if (prevAmount && Number.isFinite(prevAmount) && prevAmount > 0) {
      summary.prev_total_amount_yuan = prevAmount;
      const pct = ((summary.total_amount_yuan - prevAmount) / prevAmount) * 100;
      summary.turnover_yoy_pct = Math.round(pct * 100) / 100;
    }

    cachedSummary = summary;
    fetchedAt = Date.now();
    return summary;
  } catch (error) {
    if (cachedSummary) {
      return {
        ...cachedSummary,
        status: "stale",
        message: error.message,
      };
    }
    return {
      status: "error",
      message: error.message,
    };
  }
}

export function clearMarketSummaryCache() {
  cachedSummary = null;
  fetchedAt = 0;
}
