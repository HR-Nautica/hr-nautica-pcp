import { getAnalysisTempRows, getBuchasStock, getRawMaterialStock, getStateSnapshot } from "./database.js";

const FAMILY_LABELS = {
  helices: "Hélices",
  componentes: "Componentes",
  buchas: "Buchas",
  brutos: "Brutos"
};

const normalize = (value) => String(value ?? "").trim().toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
const text = (value) => String(value ?? "").trim();
const isInactive = (item) => item?.active === false || ["inactive", "inativo", "desativado"].includes(String(item?.status || "").toLocaleLowerCase("pt-BR"));
const known = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function record({ id, family, code, description, unit, sourceIdentifier, physicalStock = null, source, updatedAt = null, identityStatus = "confirmed", masterItemId = null, location = null, catalogStatus = "active" }) {
  const physical = known(physicalStock);
  return {
    id,
    family,
    familyLabel: FAMILY_LABELS[family],
    code: text(code),
    description: text(description) || "Descrição não informada",
    unit: text(unit) || "—",
    sourceIdentifier: text(sourceIdentifier) || null,
    masterItemId,
    physicalStock: physical,
    reservedStock: null,
    availableStock: null,
    stockStatus: physical === null ? "pending" : physical === 0 ? "zero" : "physical_known",
    source,
    updatedAt,
    location: location || null,
    identityStatus,
    catalogStatus
  };
}

function duplicateCodes(items, codeOf) {
  const counts = new Map();
  for (const item of items) {
    const code = normalize(codeOf(item));
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([code]) => code));
}

function helices(snapshot, analysisRows) {
  const catalog = Array.isArray(snapshot.data?.hrn_modelos) ? snapshot.data.hrn_modelos.filter(item => !isInactive(item)) : [];
  const rows = Array.isArray(analysisRows) ? analysisRows : [];
  const catalogDuplicates = duplicateCodes(catalog, item => item.sku);
  const snapshotDuplicates = duplicateCodes(rows, item => item.sku);
  const bySku = new Map(rows.map(item => [normalize(item.sku), item]));
  const result = catalog.map((item, index) => {
    const code = text(item.sku || item.codigo || item.codigoSku);
    const sourceRow = bySku.get(normalize(code));
    const ambiguous = !code || catalogDuplicates.has(normalize(code)) || snapshotDuplicates.has(normalize(code));
    return record({
      id: `helices:catalog:${text(item.id || code || index)}`,
      family: "helices",
      code,
      description: item.nome || item.descricao || sourceRow?.produto,
      unit: item.unidade || "un",
      sourceIdentifier: code,
      physicalStock: ambiguous || !sourceRow ? null : sourceRow.estoqueFisico,
      source: sourceRow && !ambiguous ? "Snapshot Excel de hélices" : "Fonte pendente",
      updatedAt: sourceRow?.importedAt || null,
      identityStatus: ambiguous ? "ambiguous" : "confirmed",
      catalogStatus: "active"
    });
  });
  const catalogCodes = new Set(catalog.map(item => normalize(item.sku)).filter(Boolean));
  rows.forEach((item, index) => {
    const code = normalize(item.sku);
    if (!code || catalogCodes.has(code)) return;
    result.push(record({
      id: `helices:snapshot:${item.sourceRow || index}`,
      family: "helices",
      code: item.sku,
      description: item.produto,
      unit: "un",
      sourceIdentifier: item.sku,
      physicalStock: snapshotDuplicates.has(code) ? null : item.estoqueFisico,
      source: snapshotDuplicates.has(code) ? "Identidade pendente no snapshot" : "Snapshot Excel de hélices",
      updatedAt: item.importedAt || null,
      identityStatus: snapshotDuplicates.has(code) ? "ambiguous" : "catalog_missing",
      catalogStatus: "reconciliation_pending"
    }));
  });
  return result;
}

function componentes(snapshot) {
  const tree = Array.isArray(snapshot.data?.hrn_estoque_arvore) ? snapshot.data.hrn_estoque_arvore.filter(item => !isInactive(item)) : [];
  const stockMap = snapshot.data?.hrn_earv_estoque && typeof snapshot.data.hrn_earv_estoque === "object" ? snapshot.data.hrn_earv_estoque : {};
  const meta = snapshot.data?.hrn_earv_meta && typeof snapshot.data.hrn_earv_meta === "object" ? snapshot.data.hrn_earv_meta : {};
  const bySku = new Map();
  for (const item of tree) {
    const code = normalize(item.SKU || item.sku);
    if (!code) continue;
    const previous = bySku.get(code);
    const description = text(item.Descricao || item.descricao || item.Produto || item.produto);
    bySku.set(code, previous ? { item: previous.item, ambiguous: previous.ambiguous || (description && previous.description && description !== previous.description), description: previous.description || description } : { item, ambiguous: false, description });
  }
  return [...bySku.entries()].map(([code, value]) => record({
    id: `componentes:${code}`,
    family: "componentes",
    code,
    description: value.description,
    unit: value.item.unidade || "un",
    sourceIdentifier: code,
    physicalStock: value.ambiguous || !Object.prototype.hasOwnProperty.call(stockMap, code) ? null : stockMap[code],
    source: value.ambiguous ? "Identidade pendente na árvore" : Object.prototype.hasOwnProperty.call(stockMap, code) ? "Snapshot Excel de componentes" : "Fonte pendente",
    updatedAt: meta.updatedAt || null,
    identityStatus: value.ambiguous ? "ambiguous" : "confirmed"
  }));
}

function buchas(readModel) {
  const catalog = Array.isArray(readModel?.catalog) ? readModel.catalog.filter(item => !isInactive(item)) : [];
  const stockBySku = new Map((Array.isArray(readModel?.items) ? readModel.items : []).map(item => [normalize(item.sku), item]));
  return catalog.map((item, index) => {
    const code = text(item.sku || item.codigo);
    const stock = stockBySku.get(normalize(code));
    return record({
      id: `buchas:${text(item.id || code || index)}`,
      family: "buchas",
      code,
      description: item.descricao || item.description || item.nome,
      unit: item.unidade || "un",
      sourceIdentifier: code,
      physicalStock: stock?.estoqueFinal,
      source: stock ? "Movimentações internas do ERP" : "Fonte pendente",
      updatedAt: null,
      identityStatus: code ? "confirmed" : "ambiguous"
    });
  });
}

function brutos(snapshot, rawStock) {
  const catalog = Array.isArray(snapshot.data?.hrn_fundicao_catalog) ? snapshot.data.hrn_fundicao_catalog.filter(item => !isInactive(item)) : [];
  const rawItems = Array.isArray(rawStock?.items) ? rawStock.items : [];
  const rawByCode = new Map(rawItems.map(item => [normalize(item.rawCode), item]));
  const catalogCodes = new Set();
  const result = catalog.map((item, index) => {
    const code = text(item.coquilha || item.codigo || item.sku);
    const normalized = normalize(code);
    const stock = rawByCode.get(normalized);
    catalogCodes.add(normalized);
    return record({
      id: `brutos:catalog:${text(item.id || code || index)}`,
      family: "brutos",
      code,
      description: item.descricao || item.description || item.produto || code,
      unit: item.unidade || "un",
      sourceIdentifier: code,
      physicalStock: stock ? stock.quantity : null,
      source: stock ? "Movimentações internas do ERP" : "Fonte pendente",
      updatedAt: stock?.updatedAt || null,
      location: stock?.location || null,
      identityStatus: normalized ? "confirmed" : "ambiguous"
    });
  });
  rawItems.forEach((item, index) => {
    const code = normalize(item.rawCode);
    if (!code || catalogCodes.has(code)) return;
    result.push(record({
      id: `brutos:ledger:${text(item.id || code || index)}`,
      family: "brutos",
      code: item.rawCode,
      description: item.rawCode,
      unit: "un",
      sourceIdentifier: item.rawCode,
      physicalStock: item.quantity,
      source: "Movimentações internas do ERP",
      updatedAt: item.updatedAt || null,
      identityStatus: "catalog_missing",
      catalogStatus: "reconciliation_pending"
    }));
  });
  return result;
}

export function buildGeneralStock({ snapshot = { data: {} }, analysisRows = [], buchasStock = {}, rawStock = {} } = {}) {
  const items = [
    ...helices(snapshot, analysisRows),
    ...componentes(snapshot),
    ...buchas(buchasStock),
    ...brutos(snapshot, rawStock)
  ].sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, "pt-BR") || a.code.localeCompare(b.code, "pt-BR"));
  const active = items.filter(item => item.catalogStatus === "active");
  return {
    items,
    summary: {
      totalActive: active.length,
      physicalKnown: active.filter(item => item.physicalStock !== null).length,
      physicalZero: active.filter(item => item.physicalStock === 0).length,
      balancePending: active.filter(item => item.physicalStock === null).length,
      availableConfigured: active.filter(item => item.availableStock !== null).length
    },
    sources: {
      helices: "Snapshot Excel de hélices",
      componentes: "Snapshot Excel de componentes",
      buchas: "Movimentações internas do ERP",
      brutos: "Movimentações internas do ERP"
    },
    revision: Number(snapshot.revision || 0)
  };
}

export async function getGeneralStock(deps = { getStateSnapshot, getAnalysisTempRows, getBuchasStock, getRawMaterialStock }) {
  const [snapshot, analysisRows, buchasStock, rawStock] = await Promise.all([
    deps.getStateSnapshot(0), deps.getAnalysisTempRows(), deps.getBuchasStock(), deps.getRawMaterialStock()
  ]);
  return buildGeneralStock({ snapshot, analysisRows, buchasStock, rawStock });
}
