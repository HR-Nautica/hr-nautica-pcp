import XLSX from "xlsx";
import { getAnalysisTempRows, getBuchasStock, getRawMaterialStock, getStateSnapshot } from "./database.js";

const CATALOG_KEYS = [
  "hrn_modelos",
  "hrn_buchas",
  "hrn_fundicao_catalog",
  "hrn_coquilhas_catalog",
  "hrn_estoque_arvore",
  "hrn_earv_estoque",
  "hrn_earv_meta"
];

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.entries(value).map(([codigo, saldo]) => ({ codigo, saldo }));
  return [];
}

function excelSafe(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function tabular(value) {
  return rows(value).map(row => Object.fromEntries(Object.entries(
    row && typeof row === "object" ? row : { valor: row }
  ).map(([key, cell]) => [key, excelSafe(cell)])));
}

export function buildCatalogExport({ snapshot, analysisRows, buchasStock, rawStock, exportedAt = new Date().toISOString() }) {
  const state = snapshot?.data || {};
  const catalogs = Object.fromEntries(CATALOG_KEYS.map(key => [key, state[key] ?? (key === "hrn_earv_estoque" || key === "hrn_earv_meta" ? {} : [])]));
  return {
    schemaVersion: 1,
    exportedAt,
    sourceRevision: Number(snapshot?.revision || 0),
    sourceVersions: Object.fromEntries(CATALOG_KEYS.map(key => [key, Number(snapshot?.versions?.[key] || 0)])),
    catalogs,
    stockSources: {
      helices: Array.isArray(analysisRows) ? analysisRows : [],
      buchas: buchasStock || {},
      brutos: rawStock || {}
    }
  };
}

export function catalogExportWorkbook(payload) {
  const workbook = XLSX.utils.book_new();
  const sheets = [
    ["Helices", payload.catalogs.hrn_modelos],
    ["Buchas", payload.catalogs.hrn_buchas],
    ["Brutos", payload.catalogs.hrn_fundicao_catalog],
    ["Coquilhas", payload.catalogs.hrn_coquilhas_catalog],
    ["Componentes", payload.catalogs.hrn_estoque_arvore],
    ["Saldo Componentes", payload.catalogs.hrn_earv_estoque],
    ["Saldo Helices", payload.stockSources.helices],
    ["Saldo Buchas", payload.stockSources.buchas?.items],
    ["Saldo Brutos", payload.stockSources.brutos?.items]
  ];
  for (const [name, value] of sheets) {
    const data = tabular(value);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.length ? data : [{ aviso: "Sem registros" }]), name);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    versao_exportacao: payload.schemaVersion,
    exportado_em: payload.exportedAt,
    revisao_origem: payload.sourceRevision,
    observacao: "O JSON correspondente preserva integralmente estruturas aninhadas e deve ser mantido para restauração."
  }]), "Metadados");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
}

export async function getCatalogExport(deps = { getStateSnapshot, getAnalysisTempRows, getBuchasStock, getRawMaterialStock }) {
  const [snapshot, analysisRows, buchasStock, rawStock] = await Promise.all([
    deps.getStateSnapshot(0), deps.getAnalysisTempRows(), deps.getBuchasStock(), deps.getRawMaterialStock()
  ]);
  return buildCatalogExport({ snapshot, analysisRows, buchasStock, rawStock });
}

