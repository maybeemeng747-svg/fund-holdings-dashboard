const screenshotInput = document.querySelector("#screenshot-input");
const extractButton = document.querySelector("#extract-button");
const selectedFile = document.querySelector("#selected-file");
const importStatus = document.querySelector("#import-status");
const previewSection = document.querySelector("#preview-section");
const previewMeta = document.querySelector("#preview-meta");
const previewWarnings = document.querySelector("#preview-warnings");
const diffSummary = document.querySelector("#diff-summary");
const editableTableBody = document.querySelector("#editable-table tbody");
const rawLines = document.querySelector("#raw-lines");
const confirmButton = document.querySelector("#confirm-button");
const refreshDashboardButton = document.querySelector("#refresh-dashboard");
const detailRefreshButton = document.querySelector("#detail-refresh-button");
const toggleColumnsButton = document.querySelector("#toggle-columns-button");
const fullscreenButton = document.querySelector("#fullscreen-button");
const summaryCards = document.querySelector("#summary-cards");
const holdingsCards = document.querySelector("#holdings-cards");
const holdingsList = document.querySelector("#holdings-list");
const sourceBadge = document.querySelector("#source-badge");
const truthStatusBanner = document.querySelector("#truth-status-banner");
const columnToggles = document.querySelector("#column-toggles");
const columnToolbar = document.querySelector("#column-toolbar");

let selectedImageDataUrl = null;
let currentPreview = null;
let autoRefreshTimer = null;
let lastDashboardData = null;
const autoRefreshIntervalMs = 30000;

const storageKey = "fund-dashboard-visible-columns";
const columnDefinitions = [
  { key: "fund_name", label: "基金名称", defaultVisible: true },
  { key: "fund_code", label: "代码", defaultVisible: false },
  { key: "market_value", label: "市值", defaultVisible: true },
  { key: "cost_nav", label: "成本价", defaultVisible: false },
  { key: "latest_nav", label: "净值", defaultVisible: false },
  { key: "shares", label: "份额", defaultVisible: false },
  { key: "daily_change_pct", label: "当日涨幅", defaultVisible: true },
  { key: "yesterday_profit", label: "昨日收益", defaultVisible: false },
  { key: "holding_profit", label: "持有收益", defaultVisible: true },
  { key: "holding_profit_rate", label: "收益率", defaultVisible: true },
  { key: "portfolio_weight_pct", label: "占比", defaultVisible: true },
  { key: "position_role", label: "角色", defaultVisible: true },
  { key: "style_tags", label: "风格", defaultVisible: false },
  { key: "holding_intent", label: "意图", defaultVisible: false },
];
const editableFields = [
  "fund_name",
  "fund_code",
  "market_value",
  "shares",
  "cost_nav",
  "latest_nav",
  "daily_change_pct",
  "yesterday_profit",
  "holding_profit",
  "holding_profit_rate",
];
const numericFields = new Set([
  "market_value",
  "shares",
  "cost_nav",
  "latest_nav",
  "daily_change_pct",
  "yesterday_profit",
  "holding_profit",
  "holding_profit_rate",
]);

let visibleColumns = loadVisibleColumns();

function loadVisibleColumns() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return Object.fromEntries(columnDefinitions.map((item) => [item.key, item.defaultVisible]));
    }
    return {
      ...Object.fromEntries(columnDefinitions.map((item) => [item.key, item.defaultVisible])),
      ...JSON.parse(raw),
    };
  } catch {
    return Object.fromEntries(columnDefinitions.map((item) => [item.key, item.defaultVisible]));
  }
}

function saveVisibleColumns() {
  window.localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
}

function visibleFieldDefinitions() {
  return columnDefinitions.filter((column) => visibleColumns[column.key] !== false);
}

function countVisibleColumns() {
  return visibleFieldDefinitions().length;
}

function updateToggleButtonLabel() {
  toggleColumnsButton.textContent = `字段设置 (${countVisibleColumns()})`;
}

function renderColumnToggles() {
  columnToggles.innerHTML = "";
  columnDefinitions.forEach((column) => {
    const label = document.createElement("label");
    label.className = "column-toggle-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = visibleColumns[column.key] !== false;
    input.addEventListener("change", () => {
      visibleColumns[column.key] = input.checked;
      saveVisibleColumns();
      if (lastDashboardData) renderHoldingCards(lastDashboardData.holdings || []);
      updateToggleButtonLabel();
    });
    const text = document.createElement("span");
    text.textContent = column.label;
    label.append(input, text);
    columnToggles.appendChild(label);
  });
}

function fmtNumber(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "—";
  return `${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${suffix}`;
}

function setStatus(text, type = "neutral") {
  importStatus.textContent = text;
  importStatus.dataset.type = type;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

function sizeClassForWeight(weight) {
  if (weight >= 25) return "card-large";
  if (weight >= 10) return "card-medium";
  return "card-small";
}

function displayWeightForTreemap(weight) {
  const normalized = Math.max(Number(weight) || 0, 1);
  return Math.max(22, Math.sqrt(normalized) * 10.6);
}

function splitTreemap(items, rect) {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ holding: items[0], rect }];

  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let running = 0;
  let splitIndex = 1;
  let bestDiff = Infinity;

  for (let index = 1; index < items.length; index += 1) {
    running += items[index - 1].weight;
    const diff = Math.abs(total / 2 - running);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIndex = index;
    }
  }

  const groupA = items.slice(0, splitIndex);
  const groupB = items.slice(splitIndex);
  const weightA = groupA.reduce((sum, item) => sum + item.weight, 0);
  const ratioA = total > 0 ? weightA / total : 0.5;
  const splitVertical = rect.w >= rect.h;

  if (splitVertical) {
    const widthA = rect.w * ratioA;
    return [
      ...splitTreemap(groupA, { x: rect.x, y: rect.y, w: widthA, h: rect.h }),
      ...splitTreemap(groupB, { x: rect.x + widthA, y: rect.y, w: rect.w - widthA, h: rect.h }),
    ];
  }

  const heightA = rect.h * ratioA;
  return [
    ...splitTreemap(groupA, { x: rect.x, y: rect.y, w: rect.w, h: heightA }),
    ...splitTreemap(groupB, { x: rect.x, y: rect.y + heightA, w: rect.w, h: rect.h - heightA }),
  ];
}

function tileColorForChange(changePct) {
  const value = Number(changePct || 0);
  const intensity = Math.min(1, Math.abs(value) / 3);
  if (value > 0) {
    const bg = `rgba(229, 112, 118, ${0.76 + intensity * 0.16})`;
    const border = `rgba(184, 63, 71, ${0.68 + intensity * 0.22})`;
    return { bg, border, text: "#18120f" };
  }
  if (value < 0) {
    const bg = `rgba(132, 196, 144, ${0.76 + intensity * 0.16})`;
    const border = `rgba(82, 143, 93, ${0.68 + intensity * 0.22})`;
    return { bg, border, text: "#18120f" };
  }
  return {
    bg: "rgba(202, 191, 166, 0.86)",
    border: "rgba(141, 129, 105, 0.72)",
    text: "#18120f",
  };
}

function isGoldNightSession() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 19 * 60 + 50 || totalMinutes <= 2 * 60 + 30;
}

function formatFieldValue(columnKey, holding) {
  if (columnKey === "style_tags") return (holding.style_tags || []).join(" / ") || "—";
  if (columnKey === "holding_intent") return holding.holding_intent || "—";
  if (columnKey === "position_role") return holding.position_role || "未配置";
  if (columnKey === "display_daily_profit") return fmtNumber(holding[columnKey]);
  if (columnKey === "display_daily_change_pct") return fmtNumber(holding[columnKey], "%");
  if (["current_holding_profit_rate", "current_holding_profit", "current_market_value"].includes(columnKey)) {
    return columnKey.endsWith("_rate") ? fmtNumber(holding[columnKey], "%") : fmtNumber(holding[columnKey]);
  }
  if (["daily_change_pct", "holding_profit_rate", "portfolio_weight_pct"].includes(columnKey)) {
    return fmtNumber(holding[columnKey], "%");
  }
  return fmtNumber(holding[columnKey]);
}

function renderHoldingCards(holdings) {
  holdingsCards.innerHTML = "";
  const sorted = [...holdings]
    .map((holding) => ({
      ...holding,
      weight: Number(holding.portfolio_weight_pct || 0),
      displayWeight: displayWeightForTreemap(holding.portfolio_weight_pct),
    }))
    .sort((left, right) => right.weight - left.weight);
  const layout = splitTreemap(
    sorted.map((holding) => ({ ...holding, weight: holding.displayWeight })),
    { x: 0, y: 0, w: 100, h: 100 }
  );

  layout.forEach(({ holding, rect }) => {
    const weight = Number(holding.portfolio_weight_pct || 0);
    const colors = tileColorForChange(holding.display_daily_change_pct ?? holding.daily_change_pct);
    const sizeClass = sizeClassForWeight(weight);
    const isConfirmedForDay = holding.realtime?.status === "confirmed_updated";
    const realtimeState =
      isConfirmedForDay
        ? "最新净值"
        : holding.realtime?.source === "qdii_topix_proxy"
        ? "QDII代理"
        : holding.realtime?.status === "estimated"
        ? "盘中估算"
        : holding.realtime?.status === "fallback_snapshot"
          ? "快照回退"
          : "无估算";
    const updateBadge =
      isConfirmedForDay
        ? '<div class="status-badge status-badge-updated">已更新</div>'
        : "";
    const goldNightBadge =
      holding.fund_code === "008702" && isGoldNightSession()
        ? '<div class="status-badge status-badge-gold">黄金夜盘中</div>'
        : "";
    const card = document.createElement("article");
    card.className = `holding-card ${sizeClass}`;
    card.style.setProperty("--x", rect.x.toFixed(3));
    card.style.setProperty("--y", rect.y.toFixed(3));
    card.style.setProperty("--w", rect.w.toFixed(3));
    card.style.setProperty("--h", rect.h.toFixed(3));
    card.style.setProperty("--tile-bg", colors.bg);
    card.style.setProperty("--tile-border", colors.border);
    card.style.setProperty("--tile-text", colors.text);
    card.innerHTML = `
      <div class="holding-card-header">
        <div>
          <h3>${holding.fund_name || "未命名基金"}</h3>
          <p>${realtimeState}</p>
        </div>
        <div class="badge-stack">
          ${goldNightBadge}
          ${updateBadge}
          <div class="weight-badge">${fmtNumber(holding.portfolio_weight_pct, "%")}</div>
        </div>
      </div>
      <div class="holding-card-body compact-body">
        <div class="holding-metric metric-primary">
          <span>${isConfirmedForDay ? "今日涨幅" : "今日估算涨幅"}</span>
          <strong>${formatFieldValue("display_daily_change_pct", holding)}</strong>
        </div>
        <div class="holding-metric metric-middle">
          <span>当日收益</span>
          <strong>${formatFieldValue("display_daily_profit", holding)}</strong>
        </div>
      </div>
    `;
    holdingsCards.appendChild(card);
  });
}

function renderHoldingList(holdings) {
  holdingsList.innerHTML = "";
  const sorted = [...holdings].sort(
    (left, right) => Number(right.current_market_value ?? right.market_value ?? 0) - Number(left.current_market_value ?? left.market_value ?? 0),
  );

  sorted.forEach((holding) => {
    const item = document.createElement("article");
    item.className = "holding-list-item";
    item.innerHTML = `
      <div class="holding-list-header">
        <div>
          <h3>${holding.fund_name || "未命名基金"}</h3>
          <p>${holding.fund_code || "无代码"}${holding.position_role ? ` · ${holding.position_role}` : ""}</p>
        </div>
        <div class="holding-list-weight">${fmtNumber(holding.portfolio_weight_pct, "%")}</div>
      </div>
      <div class="holding-list-grid">
        <div class="holding-list-field"><span>持仓金额</span><strong>${fmtNumber(holding.current_market_value ?? holding.market_value)}</strong></div>
        <div class="holding-list-field"><span>持有份额</span><strong>${fmtNumber(holding.shares)}</strong></div>
        <div class="holding-list-field"><span>持仓成本价</span><strong>${fmtNumber(holding.cost_nav)}</strong></div>
        <div class="holding-list-field"><span>最新净值</span><strong>${fmtNumber(holding.current_nav ?? holding.latest_nav)}</strong></div>
        <div class="holding-list-field"><span>确认总收益</span><strong>${fmtNumber(holding.current_holding_profit ?? holding.holding_profit)}</strong></div>
        <div class="holding-list-field"><span>确认总收益率</span><strong>${fmtNumber(holding.current_holding_profit_rate ?? holding.holding_profit_rate, "%")}</strong></div>
      </div>
    `;
    holdingsList.appendChild(item);
  });
}

function renderPreview(preview) {
  currentPreview = preview;
  previewSection.classList.remove("hidden");
  previewMeta.textContent = `预览时间：${preview.preview_generated_at}；OCR 平均置信度：${preview.ocr_summary.average_confidence}`;
  previewWarnings.innerHTML = "";
  if ((preview.warnings || []).length === 0) {
    previewWarnings.innerHTML = "<li>未发现明显缺失项，但仍建议人工复核后再确认写入。</li>";
  } else {
    preview.warnings.forEach((warning) => {
      const li = document.createElement("li");
      li.textContent = warning;
      previewWarnings.appendChild(li);
    });
  }

  const diff = preview.diff || {};
  diffSummary.innerHTML = `
    <div class="diff-card"><strong>${(diff.added || []).length}</strong><span>新增基金</span><small>${(diff.added || []).join(" / ") || "无"}</small></div>
    <div class="diff-card"><strong>${(diff.removed || []).length}</strong><span>将被移除</span><small>${(diff.removed || []).join(" / ") || "无"}</small></div>
    <div class="diff-card"><strong>${(diff.changed || []).length}</strong><span>发生变更</span><small>${(diff.changed || []).map((item) => item.fund_name).join(" / ") || "无"}</small></div>
    <div class="diff-card"><strong>${preview.portfolio_level?.alerts?.length || 0}</strong><span>组合级异常提示</span><small>${(preview.portfolio_level?.alerts || []).join(" / ") || "无"}</small></div>
  `;

  editableTableBody.innerHTML = "";
  preview.holdings.forEach((holding, index) => {
    const row = document.createElement("tr");
    const hasMissing = (holding.missing_fields || []).length > 0;
    const hasSuspicious = (holding.suspicious_fields || []).length > 0;
    if (hasMissing) row.classList.add("row-missing");
    else if (hasSuspicious) row.classList.add("row-suspicious");
    editableFields.forEach((field) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.value = holding[field] ?? "";
      input.dataset.index = String(index);
      input.dataset.field = field;
      if (numericFields.has(field)) {
        input.inputMode = "decimal";
        input.placeholder = "请输入数字";
      }
      td.appendChild(input);
      row.appendChild(td);
    });
    const issueTd = document.createElement("td");
    const issues = [...(holding.missing_fields || []), ...(holding.suspicious_fields || [])];
    issueTd.textContent = issues.length ? issues.join(", ") : "—";
    if ((holding.suspicious_fields || []).includes("action_confidence_degraded")) {
      issueTd.textContent += "；动作建议可信度下降";
    }
    row.appendChild(issueTd);
    editableTableBody.appendChild(row);
  });

  rawLines.textContent = (preview.ocr_summary.raw_lines || [])
    .map((item) => `[${item.confidence}] ${item.text}`)
    .join("\n");
}

function validateEditedHoldings() {
  const invalidMessages = [];
  const rows = [...editableTableBody.querySelectorAll("tr")];
  rows.forEach((row, index) => {
    row.querySelectorAll("input").forEach((input) => {
      input.classList.remove("input-invalid");
      const field = input.dataset.field;
      const raw = input.value.trim();
      if (!numericFields.has(field) || raw === "") return;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        input.classList.add("input-invalid");
        invalidMessages.push(`第 ${index + 1} 行 ${field} 不是合法数字`);
      }
    });
  });
  return invalidMessages;
}

function collectEditedHoldings() {
  if (!currentPreview) return [];
  const rows = [...editableTableBody.querySelectorAll("tr")];
  return rows.map((row, index) => {
    const source = currentPreview.holdings[index] || {};
    const next = { ...source };
    row.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      const raw = input.value.trim();
      if (["fund_name", "fund_code"].includes(field)) {
        next[field] = raw || null;
      } else {
        next[field] = raw === "" ? null : Number(raw);
      }
    });
    return next;
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function loadDashboard() {
  const data = await fetchJson("/api/holdings");
  lastDashboardData = data;
  const summary = data.summary || {};
  const coverage = data.data_source?.realtime_status;
  const coverageText = coverage
    ? `实时覆盖 ${coverage.estimated_count}/${coverage.total_count}`
    : "未启用实时估算";
  summaryCards.innerHTML = `
    <article class="summary-card trend-card"><span>今日涨幅</span><strong>${fmtNumber(summary.estimated_portfolio_daily_change_pct, "%")}</strong></article>
    <article class="summary-card"><span>今日收益</span><strong>${fmtNumber(summary.estimated_today_profit)}</strong></article>
    <article class="summary-card total-card"><span>基金总持仓金额</span><strong>${fmtNumber(summary.confirmed_total_market_value ?? summary.total_market_value)}</strong></article>
    <article class="summary-card"><span>确认总收益</span><strong>${fmtNumber(summary.confirmed_holding_profit ?? summary.holding_profit)}</strong></article>
  `;

  const confirmedDate = data.data_source.latest_confirmed_nav_date || "—";
  const confirmedGeneratedAt = data.data_source.confirmed_snapshot_generated_at || "—";
  sourceBadge.textContent = `${data.data_source.source_file} | 基础持仓导入时间：${data.data_source.updated_at || "—"} | 最新确认净值日期：${confirmedDate} | 确认仓位刷新时间：${confirmedGeneratedAt} | ${coverageText}`;
  if (data.data_source.source_type === "manual_template" || !data.data_source.is_screenshot_import) {
    truthStatusBanner.textContent = "当前为示例数据，尚未导入真实持仓截图";
    truthStatusBanner.classList.remove("hidden");
  } else {
    truthStatusBanner.textContent = data.data_source.source_status_message || "";
    truthStatusBanner.classList.toggle("hidden", !truthStatusBanner.textContent);
  }

  renderHoldingCards(data.holdings || []);
  renderHoldingList(data.holdings || []);
  updateToggleButtonLabel();
}

screenshotInput.addEventListener("change", async () => {
  const file = screenshotInput.files?.[0];
  if (!file) {
    selectedFile.textContent = "尚未选择截图";
    selectedImageDataUrl = null;
    extractButton.disabled = true;
    return;
  }
  selectedFile.textContent = `已选择：${file.name}`;
  selectedImageDataUrl = await fileToDataUrl(file);
  extractButton.disabled = false;
});

extractButton.addEventListener("click", async () => {
  const file = screenshotInput.files?.[0];
  if (!selectedImageDataUrl || !file) return;
  setStatus("正在进行本地 OCR 和结构化提取，请稍候……");
  extractButton.disabled = true;
  try {
    const preview = await fetchJson("/api/import/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageName: file.name, imageDataUrl: selectedImageDataUrl }),
    });
    renderPreview(preview);
    setStatus("预览生成完成，请核对差异、缺失项和可疑项后再确认写入。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    extractButton.disabled = false;
  }
});

confirmButton.addEventListener("click", async () => {
  if (!currentPreview) return;
  const invalidMessages = validateEditedHoldings();
  if (invalidMessages.length > 0) {
    setStatus(`存在数字字段格式错误：${invalidMessages.join("；")}`, "error");
    return;
  }
  if (!window.confirm("确认覆盖写入 portfolio/current_holdings.json 吗？系统会同时生成快照和更新日志。")) {
    setStatus("已取消写入，你可以继续检查或修改预览结果。");
    return;
  }
  setStatus("正在写入 current_holdings.json，并生成快照与更新日志……");
  confirmButton.disabled = true;
  try {
    const result = await fetchJson("/api/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        source: currentPreview.source,
        warnings: currentPreview.warnings,
        holdings: collectEditedHoldings(),
      }),
    });
    const qualityHint = result.import_quality?.message ? `；${result.import_quality.message}` : "";
    setStatus(`写入完成，快照已生成：${result.snapshot_file}${qualityHint}`, "success");
    await loadDashboard();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    confirmButton.disabled = false;
  }
});

refreshDashboardButton.addEventListener("click", () => loadDashboard());
detailRefreshButton.addEventListener("click", () => loadDashboard());
toggleColumnsButton.addEventListener("click", () => columnToolbar.classList.toggle("hidden"));

fullscreenButton.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      fullscreenButton.textContent = "退出全屏";
    } else {
      await document.exitFullscreen();
      fullscreenButton.textContent = "全屏";
    }
  } catch (error) {
    console.error(error);
  }
});

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("is-fullscreen", Boolean(document.fullscreenElement));
  fullscreenButton.textContent = document.fullscreenElement ? "退出全屏" : "全屏";
});

function startAutoRefresh() {
  if (autoRefreshTimer !== null) return;
  autoRefreshTimer = window.setInterval(() => {
    if (!document.hidden) loadDashboard();
  }, autoRefreshIntervalMs);
}

function stopAutoRefresh() {
  if (autoRefreshTimer === null) return;
  window.clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
    return;
  }
  loadDashboard();
  startAutoRefresh();
});

loadDashboard();
renderColumnToggles();
updateToggleButtonLabel();
startAutoRefresh();
