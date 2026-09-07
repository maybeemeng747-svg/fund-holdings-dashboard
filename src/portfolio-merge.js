export function mergeFundHoldings(currentHoldings, importedHoldings) {
  const importedByKey = new Map();
  for (const item of importedHoldings || []) {
    const key = item?.fund_code || item?.fund_name;
    if (key) importedByKey.set(key, item);
  }

  const merged = (currentHoldings || []).map((current) => {
    const key = current?.fund_code || current?.fund_name;
    const imported = key ? importedByKey.get(key) : null;
    if (!imported) return current;
    importedByKey.delete(key);
    return { ...current, ...imported };
  });

  return [...merged, ...importedByKey.values()];
}
