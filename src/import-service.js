import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";

import { getCurrentHoldings } from "./portfolio-store.js";
import { buildImportAdvisories, HIGH_PRIORITY_MISSING_FIELDS } from "./import-quality.js";
import { paths } from "./config.js";
import { mergeFundHoldings } from "./portfolio-merge.js";

const DIFF_TOLERANCES = {
  amount: 0.5,
  ratio: 0.01,
  nav: 0.0005,
};

const FIELD_RULES = [
  { key: "fund_code", labels: ["基金代码", "代码"] },
  { key: "market_value", labels: ["持仓金额", "持仓市值", "持有金额", "市值", "持仓"] },
  { key: "shares", labels: ["持有份额", "持仓份额", "份额"] },
  { key: "cost_nav", labels: ["成本价", "持有成本", "持仓成本", "平均成本"] },
  { key: "latest_nav", labels: ["最新净值", "净值"] },
  { key: "daily_change_pct", labels: ["日涨幅", "日增长率", "涨跌幅"] },
  { key: "yesterday_profit", labels: ["昨日收益", "昨日盈亏"] },
  { key: "holding_profit", labels: ["持有收益", "持仓收益", "累计收益"] },
  { key: "holding_profit_rate", labels: ["持有收益率", "持仓收益率", "收益率"] },
];

const NON_FUND_TITLE_PATTERNS = [
  /^资产详情$/,
  /^详情$/,
  /^当前持有/,
  /^收益明细$/,
  /^交易记录$/,
  /^我的定投/,
  /^累计盈亏$/,
  /^业绩走势$/,
  /^讨论区$/,
  /^财富号$/,
  /^卖出$/,
  /^买入$/,
  /^定投$/,
  /^产品详情$/,
  /^提供机构$/,
  /^交易规则$/,
  /^费率.*交易时间/,
  /^三心$/,
];

function formatNowLocal() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hh = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const mm = String(absMinutes % 60).padStart(2, "0");
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}${sign}${hh}:${mm}`;
}

function stripDataUrlPrefix(imageDataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(imageDataUrl || "");
  if (!match) {
    throw new Error("上传内容不是有效的图片 data URL");
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function runSwiftOcr(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("swift", [paths.ocrScriptFile, imagePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "本地 OCR 执行失败"));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("OCR 输出格式无法解析"));
      }
    });
  });
}

function normalizeLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[：:]/g, ":")
    .trim();
}

function parseNumber(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[,，\s]/g, "").replace(/元/g, "");
  if (!/[0-9]/.test(cleaned)) return null;
  const value = Number(cleaned.replace(/%/g, ""));
  return Number.isFinite(value) ? value : null;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function labelRegex(label) {
  return new RegExp(`${label}\\s*:?\\s*([+\\-]?[0-9.,]+%?)`, "i");
}

function extractFieldFromText(text, field) {
  for (const label of field.labels) {
    const regex = labelRegex(label);
    const match = text.match(regex);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function isProbableFundName(line) {
  if (!line) return false;
  if (NON_FUND_TITLE_PATTERNS.some((pattern) => pattern.test(line))) {
    return false;
  }
  if (/^(基金代码|持仓金额|持仓市值|市值|持有份额|份额|成本价|最新净值|日涨幅|涨跌幅|昨日收益|昨日盈亏|持有收益|收益率)/.test(line)) {
    return false;
  }
  if (/\d{4,}/.test(line) && !/[A-Za-z\u4e00-\u9fff]/.test(line.replace(/\d/g, ""))) {
    return false;
  }
  return /[\u4e00-\u9fff]{2,}/.test(line);
}

function isNameFocusedLine(line) {
  return isProbableFundName(line) && line.length <= 32;
}

function segmentBlocks(lines) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    if (isNameFocusedLine(line)) {
      if (current) {
        blocks.push(current);
      }
      current = { fund_name: line, lines: [line] };
      continue;
    }

    if (!current) {
      current = { fund_name: null, lines: [] };
    }
    current.lines.push(line);
  }

  if (current) {
    blocks.push(current);
  }

  return blocks.filter((block) => block.lines.length > 0);
}

function parseHoldingBlock(block, rawObservations) {
  const text = block.lines.join("\n");
  const combined = block.lines.join(" ");
  const fundCodeMatch = combined.match(/\b\d{6}\b/);
  const lineConfidences = rawObservations
    .filter((item) => block.lines.includes(normalizeLine(item.text)))
    .map((item) => Number(item.confidence || 0));
  const avgConfidence = lineConfidences.length
    ? lineConfidences.reduce((sum, item) => sum + item, 0) / lineConfidences.length
    : 0.5;

  const holding = {
    fund_name: block.fund_name || null,
    fund_code: fundCodeMatch ? fundCodeMatch[0] : null,
    market_value: null,
    shares: null,
    cost_nav: null,
    latest_nav: null,
    daily_change_pct: null,
    yesterday_profit: null,
    holding_profit: null,
    holding_profit_rate: null,
    extraction_confidence: Number(avgConfidence.toFixed(3)),
    suspicious_fields: [],
    missing_fields: [],
    raw_block_text: text,
  };

  for (const field of FIELD_RULES) {
    const extracted = extractFieldFromText(text, field);
    if (field.key === "fund_code" && extracted) {
      holding.fund_code = extracted.replace(/\D/g, "").slice(0, 6) || holding.fund_code;
      continue;
    }

    if (extracted) {
      holding[field.key] = parseNumber(extracted);
    }
  }

  for (const requiredField of ["fund_name", "market_value", "holding_profit"]) {
    if (holding[requiredField] === null || holding[requiredField] === "") {
      holding.missing_fields.push(requiredField);
    }
  }
  for (const field of HIGH_PRIORITY_MISSING_FIELDS) {
    if (holding[field] === null || holding[field] === "") {
      holding.missing_fields.push(field);
    }
  }

  if (holding.extraction_confidence < 0.72) {
    holding.suspicious_fields.push("ocr_confidence_low");
  }
  if (holding.market_value !== null && holding.market_value < 0) {
    holding.suspicious_fields.push("market_value_negative");
  }
  if (holding.holding_profit_rate !== null && Math.abs(holding.holding_profit_rate) > 1000) {
    holding.suspicious_fields.push("holding_profit_rate_outlier");
  }
  if (!holding.fund_name) {
    holding.suspicious_fields.push("fund_name_missing");
  }
  if (HIGH_PRIORITY_MISSING_FIELDS.some((field) => holding.missing_fields.includes(field))) {
    holding.suspicious_fields.push("action_confidence_degraded");
  }

  return holding;
}

function hasMeaningfulNumericField(holding) {
  return [
    "market_value",
    "shares",
    "cost_nav",
    "latest_nav",
    "daily_change_pct",
    "yesterday_profit",
    "holding_profit",
    "holding_profit_rate",
  ].some((field) => holding[field] !== null);
}

function canonicalizeHolding(holding, currentHoldings) {
  const currentByCode = new Map((currentHoldings.holdings || []).map((item) => [item.fund_code, item]));
  const currentByName = new Map((currentHoldings.holdings || []).map((item) => [item.fund_name, item]));

  if (holding.fund_code && currentByCode.has(holding.fund_code)) {
    const matched = currentByCode.get(holding.fund_code);
    holding.fund_name = matched.fund_name;
    return holding;
  }

  if (holding.fund_name && currentByName.has(holding.fund_name)) {
    const matched = currentByName.get(holding.fund_name);
    holding.fund_code = holding.fund_code || matched.fund_code;
  }

  return holding;
}

function buildSingleFundDetailHolding(uniqueLines, currentHoldings) {
  const joinedText = uniqueLines.map((item) => item.text).join(" ");
  const currentByCode = new Map((currentHoldings.holdings || []).map((item) => [item.fund_code, item]));
  const currentNames = (currentHoldings.holdings || []).map((item) => item.fund_name).filter(Boolean);
  const codeMatch = joinedText.match(/\b\d{6}\b/);
  const matchedByCode = codeMatch ? currentByCode.get(codeMatch[0]) : null;
  const matchedByName = currentNames.find((name) => joinedText.includes(name)) || null;
  const matched = matchedByCode || (matchedByName ? (currentHoldings.holdings || []).find((item) => item.fund_name === matchedByName) : null);

  if (!matched) return null;

  const holding = parseHoldingBlock(
    {
      fund_name: matched.fund_name,
      lines: uniqueLines.map((item) => item.text),
    },
    uniqueLines,
  );

  holding.fund_code = matched.fund_code || holding.fund_code;
  holding.fund_name = matched.fund_name;
  return holding;
}

function toleranceForField(field) {
  if (["market_value", "yesterday_profit", "holding_profit"].includes(field)) {
    return DIFF_TOLERANCES.amount;
  }
  if (["daily_change_pct", "holding_profit_rate"].includes(field)) {
    return DIFF_TOLERANCES.ratio;
  }
  if (["cost_nav", "latest_nav"].includes(field)) {
    return DIFF_TOLERANCES.nav;
  }
  return 0;
}

function shouldIgnoreDiff(field, oldValue, newValue) {
  if (oldValue === null || newValue === null) return false;
  const oldNumber = safeNumber(oldValue);
  const newNumber = safeNumber(newValue);
  if (oldNumber === null || newNumber === null) return false;
  return Math.abs(oldNumber - newNumber) < toleranceForField(field);
}

function summarizePortfolioLevelAlerts(currentHoldings, extractedHoldings, diff) {
  const currentSummary = currentHoldings.summary || {};
  const currentTotalMarketValue = safeNumber(currentSummary.total_market_value)
    ?? (currentHoldings.holdings || []).reduce((sum, item) => sum + (safeNumber(item.market_value) || 0), 0);
  const extractedTotalMarketValue = extractedHoldings.reduce(
    (sum, item) => sum + (safeNumber(item.market_value) || 0),
    0,
  );
  const alerts = [];

  if (currentTotalMarketValue > 0) {
    const deltaPct = Math.abs((extractedTotalMarketValue - currentTotalMarketValue) / currentTotalMarketValue) * 100;
    if (deltaPct >= 15) {
      alerts.push(
        `总市值变化过大：当前真源约 ${currentTotalMarketValue.toFixed(2)}，预览约 ${extractedTotalMarketValue.toFixed(2)}，变化 ${deltaPct.toFixed(2)}%。`,
      );
    }
  }

  if ((currentHoldings.holdings || []).length !== extractedHoldings.length) {
    alerts.push(
      `基金数量变化：当前 ${((currentHoldings.holdings || []).length)} 只，预览 ${extractedHoldings.length} 只。`,
    );
  }
  if ((diff.removed || []).length > 0) {
    alerts.push(`原有基金消失：${diff.removed.join(" / ")}。`);
  }
  if ((diff.added || []).length > 0) {
    alerts.push(`新基金突然出现：${diff.added.join(" / ")}。`);
  }

  return {
    current_total_market_value: Number(currentTotalMarketValue.toFixed(2)),
    extracted_total_market_value: Number(extractedTotalMarketValue.toFixed(2)),
    current_holdings_count: (currentHoldings.holdings || []).length,
    extracted_holdings_count: extractedHoldings.length,
    alerts,
  };
}

export function buildDiff(currentHoldings, extractedHoldings) {
  const currentMap = new Map(
    (currentHoldings.holdings || []).map((item) => [item.fund_code || item.fund_name, item]),
  );
  const extractedMap = new Map(
    extractedHoldings.map((item) => [item.fund_code || item.fund_name, item]),
  );

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, value] of extractedMap.entries()) {
    if (!currentMap.has(key)) {
      added.push(value.fund_name || key);
      continue;
    }

    const before = currentMap.get(key);
    const fieldDiffs = [];
    for (const field of [
      "market_value",
      "shares",
      "cost_nav",
      "latest_nav",
      "daily_change_pct",
      "yesterday_profit",
      "holding_profit",
      "holding_profit_rate",
    ]) {
      const oldValue = before[field] ?? null;
      const newValue = value[field] ?? null;
      if (oldValue !== newValue && !shouldIgnoreDiff(field, oldValue, newValue)) {
        fieldDiffs.push({ field, before: oldValue, after: newValue });
      }
    }
    if (fieldDiffs.length > 0) {
      changed.push({ fund_name: value.fund_name || key, field_diffs: fieldDiffs });
    }
  }

  for (const [key, value] of currentMap.entries()) {
    if (!extractedMap.has(key)) {
      removed.push(value.fund_name || key);
    }
  }

  return { added, removed, changed };
}

export function validateImportPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("确认写入的请求体不能为空");
  }
  if (!payload.confirmed) {
    throw new Error("必须经过用户确认后才能写入");
  }
  if (!Array.isArray(payload.holdings) || payload.holdings.length === 0) {
    throw new Error("确认写入时 holdings 不能为空");
  }
  if (
    payload.import_scope === "partial" &&
    payload.holdings.some((item) => !item?.fund_code && !item?.fund_name)
  ) {
    throw new Error("局部导入必须包含基金代码或基金名称");
  }
}


export async function extractPortfolioFromScreenshot({ imageDataUrl, imageName }) {
  if (!imageDataUrl) {
    throw new Error("请先上传截图");
  }

  const { base64, mimeType } = stripDataUrlPrefix(imageDataUrl);
  const extension = mimeType.includes("png") ? ".png" : ".jpg";
  const tempPath = path.join(os.tmpdir(), `fund-import-${Date.now()}${extension}`);
  await fs.writeFile(tempPath, Buffer.from(base64, "base64"));

  const ocrResult = await runSwiftOcr(tempPath);
  const normalizedLines = (ocrResult.observations || [])
    .map((item) => ({ ...item, text: normalizeLine(item.text) }))
    .filter((item) => item.text);

  const uniqueLines = [];
  const seen = new Set();
  for (const line of normalizedLines) {
    if (seen.has(line.text)) continue;
    seen.add(line.text);
    uniqueLines.push(line);
  }

  const currentHoldings = await getCurrentHoldings();
  const detailPageHolding = buildSingleFundDetailHolding(uniqueLines, currentHoldings);

  let holdings;
  if (detailPageHolding) {
    holdings = [canonicalizeHolding(detailPageHolding, currentHoldings)];
  } else {
    const blocks = segmentBlocks(uniqueLines.map((item) => item.text));
    holdings = blocks
      .map((block) => canonicalizeHolding(parseHoldingBlock(block, uniqueLines), currentHoldings))
      .filter((item) => {
        return item.fund_code || hasMeaningfulNumericField(item);
      });
  }

  if (holdings.length === 0) {
    holdings.push({
      fund_name: null,
      fund_code: null,
      market_value: null,
      shares: null,
      cost_nav: null,
      latest_nav: null,
      daily_change_pct: null,
      yesterday_profit: null,
      holding_profit: null,
      holding_profit_rate: null,
      extraction_confidence: 0.2,
      suspicious_fields: ["no_structured_holding_detected"],
      missing_fields: ["fund_name", "market_value", "holding_profit"],
      raw_block_text: uniqueLines.map((item) => item.text).join("\n"),
    });
  }

  const importScope = detailPageHolding ? "partial" : "full";
  const previewHoldings = importScope === "partial"
    ? mergeFundHoldings(currentHoldings.holdings || [], holdings)
    : holdings;
  const diff = buildDiff(currentHoldings, previewHoldings);
  const advisory = buildImportAdvisories(holdings);
  const portfolioLevel = summarizePortfolioLevelAlerts(currentHoldings, previewHoldings, diff);
  const warnings = [...advisory.warnings, ...portfolioLevel.alerts];

  return {
    preview_generated_at: formatNowLocal(),
    source: {
      type: "screenshot_import",
      image_name: imageName || "uploaded-screenshot",
      mime_type: mimeType,
      imported_via: "local_swift_vision_ocr",
    },
    ocr_summary: {
      line_count: uniqueLines.length,
      average_confidence: uniqueLines.length
        ? Number(
            (
              uniqueLines.reduce((sum, item) => sum + Number(item.confidence || 0), 0) /
              uniqueLines.length
            ).toFixed(3),
          )
        : 0,
      raw_lines: uniqueLines.map((item) => ({
        text: item.text,
        confidence: Number(Number(item.confidence || 0).toFixed(3)),
      })),
    },
    holdings,
    import_scope: importScope,
    warnings,
    advisory,
    portfolio_level: portfolioLevel,
    diff,
    requires_confirmation: true,
  };
}
