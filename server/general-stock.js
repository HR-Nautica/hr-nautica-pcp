import { getAnalysisTempRows, getBuchasStock, getRawMaterialStock, getStateSnapshot } from "./database.js";

const FAMILY_LABELS = {
  helices: "Hélices",
  componentes: "Componentes",
  buchas: "Buchas",
  brutos: "Brutos"
};
const TYPE_LABELS = {
  item_final: "Item final",
  componente: "Componente",
  material: "Material",
  helice_usinada: "Hélice usinada",
  bucha: "Bucha",
  helice_bruta: "Hélice bruta / coquilha"
};

const normalize = (value) => String(value ?? "").trim().toLocaleUpperCase("pt-BR").replace(/\s+/g, " ");
const text = (value) => String(value ?? "").trim();
const isInactive = (item) => item?.active === false || item?.ativo === false || ["inactive", "inativo", "desativado"].includes(String(item?.status || "").toLocaleLowerCase("pt-BR"));
const known = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function record({ id, family, code, description, unit, sourceIdentifier, physicalStock = null, source, updatedAt = null, identityStatus = "confirmed", masterItemId = null, location = null, catalogStatus = "active", itemTypes = [], catalogSource = null, bom = [] }) {
  const physical = known(physicalStock);
  return {
    id,
    family,
    familyLabel: FAMILY_LABELS[family],
    itemTypes,
    typeLabel: itemTypes.map(type => TYPE_LABELS[type]).join(" / ") || "Não classificado",
    catalogSource,
    bom,
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
      catalogStatus: "active",
      itemTypes: ["helice_usinada", "item_final"],
      catalogSource: "Catálogo de Hélices",
      bom: [
        ["Bruto / coquilha", item.codigoBruto, "brutos"],
        ["Bucha", item.skuBucha, "buchas"],
        ["Caixa", item.skuCaixa, "componentes"],
        ["Tubo de alumínio", item.skuTinyTuboAl, "componentes"],
        ["Latão", item.skuTinyLatao, "componentes"]
      ].filter(([, targetCode]) => text(targetCode)).map(([role, targetCode, targetFamily]) => ({ role, code: text(targetCode), family: targetFamily, quantity: null, unit: null }))
    });
  });
  return result;
}

function componentes(snapshot) {
  const tree = Array.isArray(snapshot.data?.hrn_estoque_arvore) ? snapshot.data.hrn_estoque_arvore.filter(item => !isInactive(item)) : [];
  const stockMap = snapshot.data?.hrn_earv_estoque && typeof snapshot.data.hrn_earv_estoque === "object" ? snapshot.data.hrn_earv_estoque : {};
  const meta = snapshot.data?.hrn_earv_meta && typeof snapshot.data.hrn_earv_meta === "object" ? snapshot.data.hrn_earv_meta : {};
  const bySku = new Map();
  let parent = null;
  let component = null;
  for (const item of tree) {
    const code = normalize(item.SKU || item.sku);
    const position = String(item.Posicao ?? item.posicao ?? "").trim().padStart(2, "0");
    if (position === "00") { parent = code || null; component = null; }
    if (position === "01") component = code || null;
    if (!code) continue;
    const previous = bySku.get(code);
    const description = text(item.Descricao || item.descricao || item.Produto || item.produto);
    const type = position === "00" ? "item_final" : position === "02" ? "material" : "componente";
    const current = previous || { item, ambiguous: false, description, types: new Set(), bom: [] };
    current.ambiguous ||= Boolean(description && current.description && description !== current.description);
    current.description ||= description;
    current.types.add(type);
    bySku.set(code, current);
    const parentCode = position === "01" ? parent : position === "02" ? component : null;
    if (parentCode && parentCode !== code) {
      const parentRow = bySku.get(parentCode);
      if (parentRow) parentRow.bom.push({ role: position === "01" ? "Componente" : "Material", code, family: "componentes", quantity: known(item.Quantidade), unit: item.unidade || null });
    }
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
    identityStatus: value.ambiguous ? "ambiguous" : "confirmed",
    itemTypes: [...value.types],
    catalogSource: "Estoque de Componentes / árvore",
    bom: value.bom
  }));
}

function buchas(readModel) {
  const catalog = Array.isArray(readModel?.catalog) ? readModel.catalog.filter(item => !isInactive(item)) : [];
  const stockRows = Array.isArray(readModel?.items) ? readModel.items : [];
  const catalogDuplicates = duplicateCodes(catalog, item => item.sku);
  const stockDuplicates = duplicateCodes(stockRows, item => item.sku);
  const stockBySku = new Map(stockRows.map(item => [normalize(item.sku), item]));
  return catalog.map((item, index) => {
    const code = text(item.sku || item.codigo);
    const stock = stockBySku.get(normalize(code));
    const ambiguous = !code || catalogDuplicates.has(normalize(code)) || stockDuplicates.has(normalize(code));
    return record({
      id: `buchas:${text(item.id || code || index)}`,
      family: "buchas",
      code,
      description: item.descricao || item.description || item.nome,
      unit: item.unidade || "un",
      sourceIdentifier: code,
      physicalStock: ambiguous ? null : stock?.estoqueFinal,
      source: ambiguous ? "Identidade pendente em Buchas" : stock ? "Movimentações internas do ERP" : "Fonte pendente",
      updatedAt: null,
      identityStatus: ambiguous ? "ambiguous" : "confirmed",
      itemTypes: ["bucha", "componente"],
      catalogSource: "Catálogo de Buchas"
    });
  });
}

function brutos(snapshot, rawStock) {
  const catalog = Array.isArray(snapshot.data?.hrn_fundicao_catalog) ? snapshot.data.hrn_fundicao_catalog.filter(item => !isInactive(item)) : [];
  const coquilhas = Array.isArray(snapshot.data?.hrn_coquilhas_catalog) ? snapshot.data.hrn_coquilhas_catalog : [];
  const rawItems = Array.isArray(rawStock?.items) ? rawStock.items : [];
  const rawDuplicates = duplicateCodes(rawItems, item => item.rawCode);
  const rawByCode = new Map(rawItems.map(item => [normalize(item.rawCode), item]));
  const catalogByCode = new Map();
  for (const item of catalog) {
    const code = text(item.coquilha || item.codigo || item.sku);
    const normalized = normalize(code);
    if (normalized && !catalogByCode.has(normalized)) catalogByCode.set(normalized, { code, item });
  }
  for (const value of coquilhas) {
    const code = text(typeof value === "string" ? value : value?.coquilha || value?.codigo);
    if (code && !catalogByCode.has(normalize(code))) catalogByCode.set(normalize(code), { code, item: {} });
  }
  const models = Array.isArray(snapshot.data?.hrn_modelos) ? snapshot.data.hrn_modelos.filter(item => !isInactive(item)) : [];
  for (const model of models) {
    const code = text(model.codigoBruto);
    if (code && !catalogByCode.has(normalize(code))) catalogByCode.set(normalize(code), { code, item: {}, linkedFromModel: true });
  }
  return [...catalogByCode.values()].map(({ code, item, linkedFromModel }) => {
    const stock = rawByCode.get(normalize(code));
    const ambiguous = rawDuplicates.has(normalize(code));
    return record({
      id: `brutos:catalog:${normalize(code)}`,
      family: "brutos",
      code,
      description: `Hélice bruta / ${code}`,
      unit: item.unidade || "un",
      sourceIdentifier: code,
      physicalStock: ambiguous ? null : stock ? stock.quantity : null,
      source: ambiguous ? "Identidade pendente em Brutos" : stock ? "Movimentações internas do ERP" : "Fonte pendente",
      updatedAt: stock?.updatedAt || null,
      location: stock?.location || null,
      identityStatus: ambiguous ? "ambiguous" : "confirmed",
      itemTypes: ["helice_bruta", "componente"],
      catalogSource: linkedFromModel ? "Catálogo de Brutos / vínculo em Hélices" : "Catálogo de Brutos"
    });
  });
}

function resolveBom(items) {
  const byCode = new Map();
  for (const item of items) {
    const key = `${item.family}:${normalize(item.code)}`;
    byCode.set(key, [...(byCode.get(key) || []), item]);
  }
  for (const item of items) {
    item.bom = item.bom.map(line => {
      const matches = byCode.get(`${line.family}:${normalize(line.code)}`) || [];
      return { ...line, targetId: matches.length === 1 && matches[0].identityStatus === "confirmed" ? matches[0].id : null, status: matches.length === 0 ? "not_cataloged" : matches.length === 1 && matches[0].identityStatus === "confirmed" ? "linked" : "ambiguous" };
    });
  }
}

export function buildGeneralStock({ snapshot = { data: {} }, analysisRows = [], buchasStock = {}, rawStock = {} } = {}) {
  const items = [
    ...helices(snapshot, analysisRows),
    ...componentes(snapshot),
    ...buchas(buchasStock),
    ...brutos(snapshot, rawStock)
  ].sort((a, b) => a.familyLabel.localeCompare(b.familyLabel, "pt-BR") || a.code.localeCompare(b.code, "pt-BR"));
  resolveBom(items);
  const active = items.filter(item => item.catalogStatus === "active");
  const catalogCodes = Object.fromEntries(Object.keys(FAMILY_LABELS).map(family => [family, new Set(items.filter(item => item.family === family).map(item => normalize(item.code)))]));
  const unmatchedSourceRows = {
    helices: (Array.isArray(analysisRows) ? analysisRows : []).filter(row => !catalogCodes.helices.has(normalize(row.sku))).length,
    componentes: Object.keys(snapshot.data?.hrn_earv_estoque || {}).filter(code => !catalogCodes.componentes.has(normalize(code))).length,
    buchas: (Array.isArray(buchasStock?.items) ? buchasStock.items : []).filter(row => !catalogCodes.buchas.has(normalize(row.sku))).length,
    brutos: (Array.isArray(rawStock?.items) ? rawStock.items : []).filter(row => !catalogCodes.brutos.has(normalize(row.rawCode))).length
  };
  return {
    items,
    summary: {
      totalActive: active.length,
      physicalKnown: active.filter(item => item.physicalStock !== null).length,
      physicalZero: active.filter(item => item.physicalStock === 0).length,
      balancePending: active.filter(item => item.physicalStock === null).length,
      availableConfigured: active.filter(item => item.availableStock !== null).length,
      unmatchedSourceRows
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
