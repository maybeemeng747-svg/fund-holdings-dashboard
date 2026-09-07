import https from "node:https";

/**
 * 自建基金盘中估值模块
 *
 * 原理：基金季报披露的前十持仓权重 × 持仓股实时涨跌幅 → 加权估算
 *
 * 数据链路：
 *   持仓权重：fundf10 FundArchivesDatas.aspx（季报数据，有滞后）
 *   实时行情：Sina hq.sinajs.cn（实时）
 *
 * 局限：
 *   - 只覆盖前十持仓（通常 50-70% 净值），未持仓部分假设零涨跌
 *   - 季报有 15-45 天滞后，实际持仓可能已变动
 *   - 不适用于 QDII（海外交易时段不同）
 */

const FUND_HOLDER_API = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 持仓数据缓存 6 小时（季报数据，不需频繁刷新）
const QUOTES_CACHE_TTL_MS = 45 * 1000; // Sina 批量行情缓存 45 秒

const holdingsCache = new Map();
let cachedQuotesMap = new Map();

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundNumber(value, digits = 4) {
  const num = safeNumber(value);
  if (num === null) return null;
  return Number(num.toFixed(digits));
}

function todayLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * 判断股票市场：5位数字→港股(HK)，6位数字→A股(A)
 */
function detectMarket(code) {
  if (/^\d{5}$/.test(code)) return "HK";
  if (/^\d{6}$/.test(code)) return "A";
  return null;
}

/**
 * 将股票代码转为 Sina 行情符号
 * A股: 6开头→sh，其他→sz
 * 港股: hk + 5位代码
 */
function toSinaSymbol(code, market) {
  if (market === "HK") return "hk" + code;
  return code.startsWith("6") ? "sh" + code : "sz" + code;
}

export function isTradingHours(now = new Date()) {
  const cst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const day = cst.getDay();
  if (day === 0 || day === 6) return false;
  const hourMin = cst.getHours() * 100 + cst.getMinutes();
  return (hourMin >= 930 && hourMin <= 1130) || (hourMin >= 1300 && hourMin <= 1500);
}

/**
 * 从天天基金 fundf10 接口获取基金前十持仓
 * @param {string} fundCode 基金代码
 * @returns {Promise<{holdings: Array, reportDate: string, totalWeight: number} | null>}
 */
/**
 * 解析 fundf10 HTML 中的持仓数据（可单独测试）
 * @param {string} html 原始 HTML 响应
 * @returns {{holdings: Array, reportDate: string|null, totalWeight: number}|null}
 */
export function parseHoldingsFromHtml(html) {
  const text = html;

  // 动态解析最新季度标签（如 2026年1季度、2025-Q4 等）
  const quarterPattern = /(\d{4})年(\d)季度|(\d{4})-Q(\d)/g;
  let latestQuarter = null;
  let latestQuarterIdx = -1;
  let qm;
  while ((qm = quarterPattern.exec(text)) !== null) {
    const year = parseInt(qm[1] || qm[3], 10);
    const quarter = parseInt(qm[2] || qm[4], 10);
    const idx = year * 10 + quarter;
    if (idx > latestQuarterIdx) {
      latestQuarterIdx = idx;
      latestQuarter = qm[0];
    }
  }

  // 找到最新季度对应的 table 区块
  // 策略：找到最新季度标签的位置，然后找其后面的 </tbody></table>
  let firstTableSection;
  if (latestQuarter) {
    const quarterPos = text.indexOf(latestQuarter);
    if (quarterPos !== -1) {
      const afterQuarter = text.substring(quarterPos);
      const tableEnd = afterQuarter.indexOf('</tbody></table>');
      if (tableEnd !== -1) {
        firstTableSection = afterQuarter.substring(0, tableEnd + '</tbody></table>'.length);
      }
    }
  }
  // 降级：取第一个 <tbody> 块
  if (!firstTableSection) {
    const tbodyStart = text.indexOf('<tbody>');
    const firstTableEnd = text.indexOf('</tbody></table>');
    firstTableSection = (tbodyStart !== -1 && firstTableEnd !== -1 && firstTableEnd > tbodyStart)
      ? text.substring(tbodyStart, firstTableEnd + '</tbody></table>'.length)
      : text;
  }

  const holdings = [];
  const reportDateMatch = firstTableSection.match(/截止至：<font[^>]*>([^<]+)<\/font>/)
    || text.match(/截止至：<font[^>]*>([^<]+)<\/font>/);
  const reportDate = reportDateMatch ? reportDateMatch[1].trim() : null;

  // 匹配每行：支持5位港股代码和6位A股代码
  const rowRegex = /<tr><td>\d+<\/td><td><a[^>]*>(\d{5,6})<\/a><\/td><td[^>]*><a[^>]*>([^<]+)<\/a><\/td>.*?<td class=["']tor["']>([\d.]+)%<\/td>/g;
  let match;
  while ((match = rowRegex.exec(firstTableSection)) !== null) {
    const [, code, name, weightStr] = match;
    const weight = safeNumber(weightStr);
    const market = detectMarket(code);
    if (code && weight !== null && market) {
      holdings.push({
        stock_code: code,
        stock_name: name.trim(),
        weight,
        market,
      });
    }
  }

  // 也尝试解析持仓市值
  const mvRegex = /<tr><td>\d+<\/td><td><a[^>]*>(\d{5,6})<\/a><\/td><td[^>]*><a[^>]*>([^<]+)<\/a><\/td>.*?<td class=["']tor["']>([\d.]+)%<\/td><td class=["']tor["']>([\d,]+(?:\.\d+)?)<\/td><td class=["']tor["']>([\d,]+(?:\.\d+)?)<\/td><\/tr>/g;
  let mvMatch;
  while ((mvMatch = mvRegex.exec(firstTableSection)) !== null) {
    const [, code, , , sharesStr, mvStr] = mvMatch;
    const holding = holdings.find((h) => h.stock_code === code);
    if (holding) {
      holding.shares = safeNumber(sharesStr.replace(/,/g, "")) * 10000;
      holding.market_value = safeNumber(mvStr.replace(/,/g, "")) * 10000;
    }
  }

  if (holdings.length === 0) return null;
  const totalWeight = holdings.reduce((sum, h) => sum + h.weight, 0);
  return { holdings, reportDate, totalWeight, latestQuarter };
}

/**
 * 解析 Sina 批量行情响应文本（可单独测试）
 * @param {string} text Sina 响应文本
 * @param {Map<string,string>} codeByKey symbol→stockCode 映射
 * @returns {Object} { [stockCode]: { current_price, prev_close, change_pct } }
 */
export function parseSinaQuotesResponse(text, codeByKey) {
  const result = {};
  const lines = text.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    const symbolMatch = line.match(/hq_str_(\w+)=/);
    if (!symbolMatch) continue;
    const symbol = symbolMatch[1];
    const code = codeByKey.get(symbol);
    if (!code) continue;

    const isHK = symbol.startsWith("hk");
    let fields;

    if (isHK) {
      // HK format: var hq_str_hk01888="name_en,name_cn,HK,prevClose,open,high,low,current,...";
      // Single quoted comma-separated string — extract the quoted content then split
      const hkMatch = line.match(/="([^"]*)"/);
      if (!hkMatch) continue;
      fields = hkMatch[1].split(",");
      if (fields.length < 8) continue;
    } else {
      // A-share format: ="field0,field1,field2,...";
      const match = line.match(/="([^"]+)"/);
      if (!match) continue;
      fields = match[1].split(",");
      if (fields.length < 4) continue;
    }

    const prevClose = parseFloat(isHK ? fields[3] : fields[2]);
    const current = parseFloat(isHK ? fields[6] : fields[3]);
    if (!prevClose || !current || prevClose === 0) continue;

    result[code] = {
      current_price: current,
      prev_close: prevClose,
      change_pct: ((current - prevClose) / prevClose) * 100,
    };
  }
  return result;
}

async function fetchFundHoldings(fundCode) {
  const cached = holdingsCache.get(fundCode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const currentYear = new Date().getFullYear();
  const url = `${FUND_HOLDER_API}?type=jjcc&code=${fundCode}&topline=10&year=${currentYear}&month=`;

  try {
    const text = await new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            Referer: `https://fundf10.eastmoney.com/ccmx_${fundCode}.html`,
            "User-Agent": "Mozilla/5.0 FundDashboard/1.0",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const decoder = new TextDecoder("utf-8");
            resolve(decoder.decode(Buffer.concat(chunks)));
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(8000, () => req.destroy(new Error("timeout")));
    });

    const data = parseHoldingsFromHtml(text);
    if (!data) {
      holdingsCache.set(fundCode, { data: null, fetchedAt: Date.now() });
      return null;
    }
    holdingsCache.set(fundCode, { data, fetchedAt: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/**
 * 批量获取多只股票实时行情（Sina 支持批量请求）
 * @param {Array<{code: string, market: string}>} stockEntries 股票代码+市场数组
 */
async function fetchStockQuotesBatch(stockEntries) {
  if (stockEntries.length === 0) return {};

  // Check cache keyed by sorted symbol set
  const symbols = stockEntries.map((entry) => toSinaSymbol(entry.code, entry.market));
  const cacheKey = [...symbols].sort().join(",");
  const cached = cachedQuotesMap.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < QUOTES_CACHE_TTL_MS) {
    console.log("[fund-estimate] Sina quotes cache hit (key=%s, %d entries)", cacheKey, Object.keys(cached.data).length);
    return cached.data;
  }

  const codeByKey = new Map(stockEntries.map((entry) => [toSinaSymbol(entry.code, entry.market), entry.code]));

  try {
    const text = await new Promise((resolve, reject) => {
      const req = https.get(
        `https://hq.sinajs.cn/list=${symbols.join(",")}`,
        {
          headers: { Referer: "https://finance.sina.com.cn/", "User-Agent": "Mozilla/5.0" },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            try {
              resolve(new TextDecoder("gbk").decode(Buffer.concat(chunks)));
            } catch {
              resolve(Buffer.concat(chunks).toString("utf8"));
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(8000, () => req.destroy(new Error("timeout")));
    });

    const result = parseSinaQuotesResponse(text, codeByKey);

    // Defensive check: warn about missing stocks
    const receivedCodes = new Set(Object.keys(result));
    for (const entry of stockEntries) {
      if (!receivedCodes.has(entry.code)) {
        console.warn(`[fund-estimate] Sina returned no quote for ${entry.code} (${entry.market}), skipping`);
      }
    }

    console.log("[fund-estimate] Sina quotes fresh fetch: %d/%d stocks (key=%s)", receivedCodes.size, stockEntries.length, cacheKey);
    cachedQuotesMap.set(cacheKey, { data: result, fetchedAt: Date.now() });
    return result;
  } catch {
    return {};
  }
}

/**
 * 计算基金盘中估算
 * @param {string} fundCode 基金代码
 * @param {number} prevNav 上一交易日的确认净值（作为估算基准）
 * @returns {Promise<{estimated_nav: number, estimated_change_pct: number, coverage: number, holdings_used: number, holdings_total: number, as_of: string, report_date: string, details: Array} | null>}
 */
export async function estimateFundNav(fundCode, prevNav) {
  if (!prevNav || prevNav <= 0) return null;
  // 盘中正常估值；收盘后保留收盘价估算（不再变化但有参考价值），
  // 避免出现 15:00~当天净值公布前的估值真空期
  const trading = isTradingHours();
  if (!trading) {
    // 非交易日（周末/节假日）不估算
    const cst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const day = cst.getDay();
    if (day === 0 || day === 6) return null;
  }

  const holdingsData = await fetchFundHoldings(fundCode);
  if (!holdingsData || holdingsData.holdings.length === 0) return null;

  const { holdings, reportDate, totalWeight } = holdingsData;
  const stockEntries = holdings.map((h) => ({ code: h.stock_code, market: h.market || detectMarket(h.stock_code) || "A" }));

  const quotes = await fetchStockQuotesBatch(stockEntries);

  let weightedChange = 0;
  let coveredWeight = 0;
  const details = [];

  for (const holding of holdings) {
    const quote = quotes[holding.stock_code];
    const changePct = quote ? quote.change_pct : null;
    const weight = holding.weight / 100;

    if (changePct !== null) {
      weightedChange += weight * changePct;
      coveredWeight += holding.weight;
    }

    details.push({
      stock_code: holding.stock_code,
      stock_name: holding.stock_name,
      market: holding.market || detectMarket(holding.stock_code) || "A",
      weight: holding.weight,
      current_price: quote?.current_price ?? null,
      prev_close: quote?.prev_close ?? null,
      change_pct: changePct !== null ? roundNumber(changePct, 2) : null,
      contribution_pct: changePct !== null ? roundNumber(weight * changePct, 4) : null,
      quoted: quote !== undefined,
    });
  }

  // 未覆盖部分假设零涨跌，所以估算涨跌 = 加权涨跌（已自动按权重折算）
  const estimatedChangePct = roundNumber(weightedChange, 2);
  const estimatedNav = roundNumber(prevNav * (1 + weightedChange / 100), 4);

  return {
    estimated_nav: estimatedNav,
    estimated_change_pct: estimatedChangePct,
    coverage: roundNumber(coveredWeight, 2),
    coverage_pct: roundNumber((coveredWeight / 100) * 100, 1),
    holdings_used: details.filter((d) => d.quoted).length,
    holdings_total: holdings.length,
    as_of: new Date().toISOString(),
    report_date: reportDate,
    prev_nav: prevNav,
    details,
    in_trading_hours: trading,
    post_close_snapshot: !trading,
  };
}

export function clearFundEstimateCache() {
  holdingsCache.clear();
  cachedQuotesMap = new Map();
}
