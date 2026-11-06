// Tradução das fórmulas de 3-Cobertura, células I7:P7.
export const COVERAGE_DEFAULTS = Object.freeze({ targetMonths: 2, averageFactor: 1, productionMonths: 3 });
const numeric = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function calculateHeliceCoverage(item, parameters = COVERAGE_DEFAULTS) {
  const physical = numeric(item.physical_quantity), sold = numeric(item.expected_outgoing_quantity);
  const average = numeric(item.monthly_average);
  const monthly = average === null ? null : average * parameters.averageFactor;
  const stockOne = physical === null || sold === null ? null : physical - sold;
  const production = numeric(item.incoming_quantity) ?? 0;
  const virtual = stockOne === null ? null : stockOne + production;
  let prio2 = null;
  if (stockOne !== null && stockOne < 0) prio2 = -1;
  else if (stockOne !== null && virtual !== null && monthly !== null) {
    const raw = virtual < 0 ? (monthly === 0 ? null : virtual / monthly)
      : /max\./i.test(item.description || '') ? 0 : monthly < 2 ? 5 : stockOne / monthly;
    if (raw !== null) prio2 = Math.trunc(raw * 10) / 10;
  }
  // A planilha retorna 6 quando a média é zero (1 + 5), não infinito.
  const coverage = monthly === null ? null : monthly === 0 ? 6 : virtual === null ? null : virtual / monthly;
  const deficit = virtual === null || monthly === null ? null : monthly * parameters.productionMonths - virtual;
  const suggested = /^COQ/.test(item.description || '') ? 0 : deficit === null ? null : Math.max(0, Math.ceil(deficit / 10) * 10);
  return { ...item, monthly_average: monthly, stock_one_quantity: stockOne, virtual_quantity: virtual,
    prio2, coverage_months: coverage, suggested_op: suggested,
    target_stock_quantity: monthly === null || stockOne === null ? null : Math.max(0, monthly * parameters.targetMonths - stockOne) };
}

export function rankHeliceCoverage(items) {
  return [...items].sort((a, b) => {
    if ((a.prio2 === null) !== (b.prio2 === null)) return a.prio2 === null ? 1 : -1;
    return (a.prio2 ?? 0) - (b.prio2 ?? 0) || a.primary_sku.localeCompare(b.primary_sku, 'pt-BR') || a.id.localeCompare(b.id);
  }).map((item, index) => ({ ...item, general_priority: item.prio2 === null ? null : index + 1 }));
}
