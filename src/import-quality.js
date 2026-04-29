export const HIGH_PRIORITY_MISSING_FIELDS = ["shares", "cost_nav", "latest_nav"];

export function buildImportAdvisories(holdings) {
  const degradedFunds = holdings
    .filter((item) => HIGH_PRIORITY_MISSING_FIELDS.some((field) => item.missing_fields?.includes(field)))
    .map((item) => item.fund_name || item.fund_code || "未识别基金");
  const warnings = [];

  if (holdings.some((item) => item.missing_fields?.length > 0)) {
    warnings.push("存在缺失字段，请在确认写入前人工补齐。");
  }
  if (holdings.some((item) => item.suspicious_fields?.length > 0)) {
    warnings.push("存在可疑项或异常值，请重点核对。");
  }
  if (degradedFunds.length > 0) {
    warnings.push(
      `以下基金缺少 shares / cost_nav / latest_nav 等高优先级字段，动作建议可信度下降：${degradedFunds.join(" / ")}。`,
    );
  }

  return {
    confidence_level: degradedFunds.length > 0 ? "degraded" : "normal",
    degraded_funds: degradedFunds,
    warnings,
  };
}
