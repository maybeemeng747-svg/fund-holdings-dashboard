/* ===== 持仓云图 v5 — 5寸屏大字体热力图 + 股票持仓盈亏 ===== */

const API_BASE = window.location.origin;

// ===== Color =====
function getColor(pct) {
  if (pct >= 3) return 'var(--up-strong)';
  if (pct >= 1.5) return 'var(--up-mid)';
  if (pct > 0) return 'var(--up-light)';
  if (pct <= -3) return 'var(--down-strong)';
  if (pct <= -1.5) return 'var(--down-mid)';
  if (pct < 0) return 'var(--down-light)';
  return 'var(--flat)';
}

function getBgColor(pct) {
  if (pct > 0) {
    const a = Math.min(0.75, 0.15 + Math.abs(pct) * 0.12);
    return `rgba(255, 68, 68, ${a})`;
  } else if (pct < 0) {
    const a = Math.min(0.75, 0.15 + Math.abs(pct) * 0.12);
    return `rgba(0, 204, 102, ${a})`;
  }
  return 'rgba(85, 94, 106, 0.3)';
}

function fmtMoney(v) {
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + '万';
  return v.toFixed(0);
}

function fmtPct(v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
function fmtPnl(v) { return (v > 0 ? '+' : '') + fmtMoney(v); }
function fmtMa(v) { return Number.isFinite(v) ? v.toFixed(2) : '--'; }

let summaryValuesHidden = false;
let summaryTotalText = '--';
let summaryPnlText = '--';

function applySummaryVisibility() {
  const totalEl = document.getElementById('total-value');
  const pnlEl = document.getElementById('today-pnl');
  const displayText = summaryValuesHidden ? '******' : null;
  const actionText = summaryValuesHidden ? '显示总仓位和总收益' : '隐藏总仓位和总收益';

  totalEl.textContent = displayText || summaryTotalText;
  pnlEl.textContent = displayText || summaryPnlText;

  for (const el of [totalEl, pnlEl]) {
    el.classList.toggle('is-hidden', summaryValuesHidden);
    el.setAttribute('aria-pressed', String(summaryValuesHidden));
    el.setAttribute('aria-label', actionText);
    el.title = actionText;
  }
}

function toggleSummaryVisibility() {
  summaryValuesHidden = !summaryValuesHidden;
  applySummaryVisibility();
}

function bindSummaryVisibilityToggle() {
  for (const el of document.querySelectorAll('.summary-toggle')) {
    el.addEventListener('click', toggleSummaryVisibility);
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleSummaryVisibility();
    });
  }
}

function shortName(name) {
  return name
    .replace(/ETF联接/g, '')
    .replace(/混合C/g, 'C')
    .replace(/混合A/g, 'A')
    .replace(/指数/g, '')
    .replace(/产业/g, '')
    .replace(/精选/g, '')
    .replace(/股票/g, '')
    .replace(/\(QDII\)/g, '')
    .replace(/中证/g, '')
    .substring(0, 8);
}

// ===== Squarified Treemap =====
function squarify(items, rect) {
  if (!items.length) return [];
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue <= 0) return [];

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const results = [];

  function worst(row, sideLen, total) {
    const rowSum = row.reduce((s, i) => s + i.value, 0);
    const otherLen = sideLen * (rowSum / total);
    let maxR = 0;
    for (const item of row) {
      const len = sideLen * (item.value / rowSum);
      maxR = Math.max(maxR, Math.max(otherLen / len, len / otherLen));
    }
    return maxR;
  }

  function layout(items, rect) {
    if (!items.length) return;
    const total = items.reduce((s, i) => s + i.value, 0);
    const { x, y, w, h } = rect;
    const isWide = w >= h;
    const sideLen = isWide ? h : w;

    let row = [items[0]];
    let rest = items.slice(1);
    let bestW = worst(row, sideLen, total);

    for (let i = 1; i < items.length; i++) {
      const test = [...row, items[i]];
      const tw = worst(test, sideLen, total);
      if (tw <= bestW) {
        row = test;
        rest = items.slice(i + 1);
        bestW = tw;
      } else break;
    }

    const rowSum = row.reduce((s, i) => s + i.value, 0);
    const frac = rowSum / total;

    if (isWide) {
      const rw = w * frac;
      let oy = y;
      for (const item of row) {
        const ih = h * (item.value / rowSum);
        results.push({ ...item, rect: { x, y: oy, w: rw, h: ih } });
        oy += ih;
      }
      if (rest.length) layout(rest, { x: x + rw, y, w: w - rw, h });
    } else {
      const rh = h * frac;
      let ox = x;
      for (const item of row) {
        const iw = w * (item.value / rowSum);
        results.push({ ...item, rect: { x: ox, y, w: iw, h: rh } });
        ox += iw;
      }
      if (rest.length) layout(rest, { x, y: y + rh, w, h: h - rh });
    }
  }

  layout(sorted, rect);
  return results;
}

// ===== Render =====
function renderTreemap(container, tiles, type) {
  container.innerHTML = '';
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!tiles.length || W < 10 || H < 10) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:15px;">暂无持仓</div>';
    return;
  }

  // Stocks: treemap layout — boost smallest items so no tile is too tiny
  if (type === 'stock') {
    const gap = 2;
    const MIN_FRAC_STOCK = 0.1; // each stock gets at least 10% of space
    const totalCountStock = tiles.length;
    const minBucketStock = MIN_FRAC_STOCK * totalCountStock;
    const remainingStock = Math.max(0, 1 - minBucketStock);
    const totalValueStock = tiles.reduce((s, t) => s + t.value, 0);
    const boostedStock = tiles.map(t => ({
      ...t,
      _origValue: t.value,
      value: (MIN_FRAC_STOCK + remainingStock * (t.value / totalValueStock)) * totalValueStock,
    }));
    const layoutItems = squarify(boostedStock, { x: 0, y: 0, w: W, h: H });
    for (const item of layoutItems) {
      const { x, y, w, h } = item.rect;
      const d = item.data;
      const pct = d.display_daily_change_pct || 0;
      const tile = document.createElement('div');

      const sizeClass = (w < 70 || h < 40) ? 'small' : (w < 110 || h < 60) ? 'medium' : '';

      tile.className = `tile stock-tile ${sizeClass}`;
      tile.style.left = (x + gap) + 'px';
      tile.style.top = (y + gap) + 'px';
      tile.style.width = Math.max(0, w - gap * 2) + 'px';
      tile.style.height = Math.max(0, h - gap * 2) + 'px';
      tile.style.backgroundColor = getBgColor(pct);

      const name = d.display_name || d.stock_name || '';
      const sn = shortName(name);
      const price = d.current_price || 0;

      let html = '';
      html += `<div class="tile-name" title="${name}">${sn}</div>`;
      html += `<div class="stock-daily-change" style="color:${getColor(pct)}">${fmtPct(pct)}</div>`;
      html += `<div class="stock-current-price">现价 ${price > 0 ? price.toFixed(2) : '--'}</div>`;
      html += `<div class="stock-ma"><span class="ma5-value">MA5 ${fmtMa(d.ma5)}</span><span class="ma-separator">·</span><span class="ma20-value">MA20 ${fmtMa(d.ma20)}</span></div>`;

      tile.innerHTML = html;
      container.appendChild(tile);
    }
    return;
  }

  // Funds: treemap layout — boost smallest items so no tile is too tiny
  const MIN_FRAC = 0.1; // each tile gets at least 10% of space
  const totalCount = tiles.length;
  const minBucket = MIN_FRAC * totalCount; // total reserved fraction
  const remaining = Math.max(0, 1 - minBucket);
  const totalValue = tiles.reduce((s, t) => s + t.value, 0);
  const boosted = tiles.map(t => ({
    ...t,
    _origValue: t.value,
    value: (MIN_FRAC + remaining * (t.value / totalValue)) * totalValue,
  }));

  const layoutItems = squarify(boosted, { x: 0, y: 0, w: W, h: H });
  const gap = 2;

  for (const item of layoutItems) {
    const { x, y, w, h } = item.rect;
    const d = item.data;
    const pct = d.display_daily_change_pct || 0;
    const tile = document.createElement('div');

    const sizeClass = (w < 70 || h < 40) ? 'small' : (w < 110 || h < 60) ? 'medium' : '';

    tile.className = `tile ${sizeClass}`;
    tile.style.left = (x + gap) + 'px';
    tile.style.top = (y + gap) + 'px';
    tile.style.width = Math.max(0, w - gap * 2) + 'px';
    tile.style.height = Math.max(0, h - gap * 2) + 'px';
    tile.style.backgroundColor = getBgColor(pct);

    const name = d.display_name || d.fund_name || d.stock_name || '';
    const sn = shortName(name);
    const code = d.fund_code || d.stock_code || '';
    const dailyPnl = d.display_daily_profit || 0;
    const mv = d.display_market_value || 0;
    const holdPnl = d.display_holding_profit || 0;
    const holdPct = d.display_holding_profit_rate || 0;

    let html = '';
    html += `<div class="tile-name" title="${name}">${sn}</div>`;
    html += `<div class="tile-code">${code}</div>`;
    html += `<div class="tile-pct" style="color:${getColor(pct)}">${fmtPct(pct)}</div>`;
    if (sizeClass !== 'small') {
      html += `<div class="tile-pnl" style="color:${getColor(dailyPnl >= 0 ? pct : -Math.abs(pct))}">${fmtPnl(dailyPnl)}</div>`;
    }
    if (!sizeClass) {
      html += `<div class="tile-sub">${fmtMoney(mv)}元 · 收益${fmtPnl(holdPnl)} · 收益率${fmtPct(holdPct)}</div>`;
    }

    tile.innerHTML = html;
    tile.addEventListener('mouseenter', (e) => showTooltip(e, d));
    tile.addEventListener('mousemove', moveTooltip);
    tile.addEventListener('mouseleave', hideTooltip);
    tile.addEventListener('click', (e) => showTooltip(e, d));
    container.appendChild(tile);
  }
}

function mainPnlColor(dailyPct, holdPnl) {
  return holdPnl >= 0 ? Math.abs(dailyPct) : -Math.abs(dailyPct);
}

// ===== Tooltip =====
const tooltip = document.getElementById('tooltip');

function showTooltip(e, data) {
  const name = data.display_name || data.fund_name || data.stock_name || '';
  const code = data.fund_code || data.stock_code || '';
  const pct = data.display_daily_change_pct || 0;
  const pnl = data.display_daily_profit || 0;
  const mv = data.display_market_value || 0;
  const hp = data.display_holding_profit || 0;
  const hr = data.display_holding_profit_rate || 0;
  const price = data.current_price || 0;

  tooltip.querySelector('.tooltip-name').textContent = name;
  tooltip.querySelector('.tooltip-code').textContent = code + (price > 0 ? '  现价 ' + price.toFixed(2) : '');
  tooltip.querySelector('.tooltip-mv').textContent = fmtMoney(mv) + '元';

  const dcEl = tooltip.querySelector('.tooltip-dc');
  dcEl.textContent = fmtPct(pct);
  dcEl.className = 'tooltip-value ' + (pct >= 0 ? 'up' : 'down');

  const tpEl = tooltip.querySelector('.tooltip-tp');
  tpEl.textContent = fmtPnl(pnl);
  tpEl.className = 'tooltip-value ' + (pnl >= 0 ? 'up' : 'down');

  const hpEl = tooltip.querySelector('.tooltip-hp');
  hpEl.textContent = fmtPnl(hp);
  hpEl.className = 'tooltip-value ' + (hp >= 0 ? 'up' : 'down');

  const hrEl = tooltip.querySelector('.tooltip-hr');
  hrEl.textContent = fmtPct(hr);
  hrEl.className = 'tooltip-value ' + (hr >= 0 ? 'up' : 'down');

  tooltip.classList.remove('hidden');
  moveTooltip(e);
}

function moveTooltip(e) {
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + tooltip.offsetWidth > window.innerWidth) x = e.clientX - tooltip.offsetWidth - pad;
  if (y + tooltip.offsetHeight > window.innerHeight) y = e.clientY - tooltip.offsetHeight - pad;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

function hideTooltip() { tooltip.classList.add('hidden'); }

// ===== Data =====
async function fetchSnapshot() {
  try {
    const r = await fetch('/api/realtime-snapshot');
    if (!r.ok) throw new Error('API error');
    return await r.json();
  } catch { return null; }
}

// Cache last successful stock quotes for offline fallback
let _lastStockQuotes = [];
let _lastWatchlistQuotes = [];
let _stockQuotesStale = false;
const WATCHLIST_LIMIT = 10;

async function fetchStockQuotes() {
  try {
    const r = await fetch('/api/stock-quotes');
    if (!r.ok) throw new Error('Stock API error');
    const d = await r.json();
    const quotes = d.quotes || [];
    const watchlistQuotes = (d.watchlist_quotes || []).slice(0, WATCHLIST_LIMIT);
    if (quotes.length > 0) {
      _lastStockQuotes = quotes;
    }
    _lastWatchlistQuotes = watchlistQuotes;
    _stockQuotesStale = [...quotes, ...watchlistQuotes]
      .some((quote) => quote.quote_status !== 'realtime');
    return { quotes, watchlistQuotes };
  } catch (err) {
    console.warn('Stock quotes fetch failed, using cached data:', err.message);
    _stockQuotesStale = true;
    return { quotes: _lastStockQuotes, watchlistQuotes: _lastWatchlistQuotes };
  }
}

function renderWatchlist(quotes) {
  const grid = document.getElementById('watchlist-grid');
  const items = (quotes || []).slice(0, WATCHLIST_LIMIT);
  grid.innerHTML = '';

  for (let index = 0; index < WATCHLIST_LIMIT; index += 1) {
    const quote = items[index];
    const cell = document.createElement('div');
    cell.className = quote ? 'watchlist-cell' : 'watchlist-cell is-empty';

    if (!quote) {
      cell.textContent = '待添加';
    } else {
      const name = document.createElement('div');
      const pct = document.createElement('div');
      const price = document.createElement('div');
      const averages = document.createElement('div');
      const change = quote.display_daily_change_pct || 0;

      name.className = 'watchlist-name';
      name.textContent = shortName(quote.display_name || quote.stock_name || '');
      name.title = quote.display_name || quote.stock_name || '';
      pct.className = 'watchlist-change';
      pct.style.color = getColor(change);
      pct.textContent = fmtPct(change);
      price.className = 'watchlist-price';
      price.textContent = `现价 ${quote.current_price > 0 ? quote.current_price.toFixed(2) : '--'}`;
      averages.className = 'watchlist-ma';
      averages.innerHTML = `<span class="ma5-value">MA5 ${fmtMa(quote.ma5)}</span><span class="ma20-value">MA20 ${fmtMa(quote.ma20)}</span>`;
      cell.append(name, pct, price, averages);
    }
    grid.appendChild(cell);
  }

  document.getElementById('watchlist-count').textContent = `${items.length}/${WATCHLIST_LIMIT}`;
}

async function fetchPolysilicon() {
  try {
    const r = await fetch('/api/polysilicon');
    if (!r.ok) throw new Error('API error');
    return await r.json();
  } catch { return null; }
}

async function fetchMarketSummary() {
  try {
    const r = await fetch('/api/market-summary');
    if (!r.ok) throw new Error('API error');
    return await r.json();
  } catch {
    return null;
  }
}

function fmtTurnover(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '--';
  if (numeric >= 1e12) return (numeric / 1e12).toFixed(2) + '万亿';
  return Math.round(numeric / 1e8).toLocaleString('zh-CN') + '亿';
}

// ===== Main =====
async function render() {
  const [snapshot, stockQuoteData, polysilicon, marketSummary] = await Promise.all([
    fetchSnapshot(),
    fetchStockQuotes(),
    fetchPolysilicon(),
    fetchMarketSummary()
  ]);

  if (!snapshot) {
    document.getElementById('data-status').textContent = '⚠️ 数据加载失败';
    return;
  }

  const stockQuotes = stockQuoteData.quotes;

  const summary = snapshot.summary || {};
  const holdings = snapshot.holdings || [];

  // Prefer estimated values when fresh (< 5 min), fall back to confirmed
  const estSummary = snapshot.estimated_summary || {};
  const estimateFresh = snapshot.estimate_fresh && estSummary.total_market_value > 0;
  const fundMV = estimateFresh ? (estSummary.total_market_value || 0) : (summary.total_market_value || 0);
  const fundPnl = estimateFresh ? (estSummary.today_profit || 0) : (summary.today_profit || 0);
  const stockMV = stockQuotes.reduce((s, q) => s + (q.display_market_value || 0), 0);
  const stockDailyPnl = stockQuotes.reduce((s, q) => s + (q.display_daily_profit || 0), 0);
  const totalMV = fundMV + stockMV;
  const todayPnl = fundPnl + stockDailyPnl;

  summaryTotalText = (totalMV / 10000).toFixed(2) + '万';
  summaryPnlText = fmtPnl(todayPnl);

  const tpEl = document.getElementById('today-pnl');
  tpEl.classList.toggle('up', todayPnl >= 0);
  tpEl.classList.toggle('down', todayPnl < 0);
  applySummaryVisibility();

  const turnoverEl = document.getElementById('market-turnover');
  const turnoverYoyEl = document.getElementById('market-turnover-yoy');
  if (turnoverEl) {
    const turnover = marketSummary?.total_amount_yuan;
    // Use innerHTML to preserve the nested yoy span
    turnoverEl.childNodes[0].nodeValue = `两市成交 ${fmtTurnover(turnover)}`;
    turnoverEl.classList.toggle('is-stale', marketSummary?.status === 'stale');
    turnoverEl.title = marketSummary && Number.isFinite(turnover)
      ? `沪市 ${fmtTurnover(marketSummary.shanghai_amount_yuan)} · 深市 ${fmtTurnover(marketSummary.shenzhen_amount_yuan)}`
      : '两市成交额暂不可用';
  }
  if (turnoverYoyEl) {
    const yoy = marketSummary?.turnover_yoy_pct;
    if (Number.isFinite(yoy)) {
      const sign = yoy > 0 ? '+' : '';
      turnoverYoyEl.textContent = `${sign}${yoy.toFixed(1)}%`;
      turnoverYoyEl.classList.toggle('up', yoy > 0);
      turnoverYoyEl.classList.toggle('down', yoy < 0);
      const prev = marketSummary?.prev_total_amount_yuan;
      turnoverYoyEl.title = prev ? `昨日 ${fmtTurnover(prev)}` : '';
    } else {
      turnoverYoyEl.textContent = '';
    }
  }

  // Check if all fund NAVs are confirmed (not estimated)
  const coverage = summary.realtime_coverage || {};
  const latestConfirmed = coverage.latest_confirmed_nav_date || '';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const navConfirmed = latestConfirmed === today;

  // Update time + status
  const genTime = snapshot.generated_at || '';
  if (genTime) {
    const d = new Date(genTime);
    let statusHtml = navConfirmed
      ? '<span class="nav-confirmed">已更新</span>'
      : '<span class="live-dot"></span>估值';
    if (_stockQuotesStale) {
      statusHtml += ' <span style="color:var(--down-strong);font-size:0.75em">⚠ 离线</span>';
    }
    document.getElementById('update-time').textContent =
      d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('data-status').innerHTML = statusHtml;
  }

  // Polysilicon price
  const polyEl = document.getElementById('polysilicon-price');
  if (polyEl && polysilicon && polysilicon.status === 'ok') {
    const pct = polysilicon.change_pct || 0;
    const sign = pct >= 0 ? '+' : '';
    polyEl.innerHTML = `<span class="poly-label">多晶硅</span> <span class="poly-price">${polysilicon.price.toFixed(2)}</span> <span class="poly-pct" style="color:${pct >= 0 ? 'var(--up-strong)' : 'var(--down-strong)'}">${sign}${pct.toFixed(2)}%</span>`;
  }

  // Stock items — sort by market value desc
  const stockItems = stockQuotes
    .map(s => ({ value: Math.max(1, s.display_market_value || 1), data: { ...s, _type: 'stock' } }))
    .sort((a, b) => b.value - a.value);

  // Fund items — sort by market value desc
  const fundItems = holdings
    .map(h => ({ value: Math.max(1, h.display_market_value || 0), data: { ...h, _type: 'fund' } }))
    .sort((a, b) => b.value - a.value);

  // Dynamic section flex based on total value
  const stockTotal = stockItems.reduce((s, i) => s + i.value, 0);
  const fundTotal = fundItems.reduce((s, i) => s + i.value, 0);
  const combinedTotal = stockTotal + fundTotal;
  const stockSection = document.getElementById('stock-section');
  const fundSection = document.getElementById('fund-section');

  if (!stockItems.length) {
    stockSection.style.display = 'none';
    fundSection.style.flex = '1';
  } else if (!fundItems.length) {
    fundSection.style.display = 'none';
    stockSection.style.flex = '1';
  } else {
    stockSection.style.display = 'flex';
    fundSection.style.display = 'flex';
    // Stock section fills remaining space, fund section auto-sizes to content
    stockSection.style.flex = '1 1 auto';
    fundSection.style.flex = '0 0 auto';
  }

  // Counts
  document.getElementById('stock-count').textContent = stockItems.length;
  document.getElementById('fund-count').textContent = fundItems.length;

  // Reset container display for treemap (absolute positioning)
  const stockTm = document.getElementById('stock-treemap');
  const fundTm = document.getElementById('fund-treemap');
  stockTm.style.display = '';
  fundTm.style.display = '';

  renderTreemap(fundTm, fundItems, 'fund');
  renderTreemap(stockTm, stockItems, 'stock');
  renderWatchlist(stockQuoteData.watchlistQuotes);
}

// ===== Auto refresh =====
function scheduleRefresh() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
  const market = day >= 1 && day <= 5 && ((h === 9 && m >= 30) || (h >= 10 && h < 15));
  const delay = market ? 30000 : 300000;
  setTimeout(async () => { await render(); scheduleRefresh(); }, delay);
}

// ===== Init =====
window.addEventListener('load', async () => {
  bindSummaryVisibilityToggle();
  await render();
  scheduleRefresh();

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(render, 200);
  });
});
