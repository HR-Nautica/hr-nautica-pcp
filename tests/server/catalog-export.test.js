import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { buildCatalogExport, catalogExportWorkbook } from "../../server/catalog-export.js";

test("exporta catálogos e fontes de saldo sem modificar os dados", () => {
  const model = { sku: "HP-1", nome: "Hélice", estrutura: { bruto: "B-1" } };
  const payload = buildCatalogExport({
    snapshot: { revision: 9, versions: { hrn_modelos: 3 }, data: { hrn_modelos: [model], hrn_earv_estoque: { "CMP-1": 4 } } },
    analysisRows: [{ sku: "HP-1", estoqueFisico: 2 }],
    buchasStock: { items: [{ sku: "BU-1", estoqueFinal: 1 }] },
    rawStock: { items: [{ rawCode: "BR-1", quantity: 3 }] },
    exportedAt: "2026-10-28T12:00:00.000Z"
  });
  assert.equal(payload.sourceRevision, 9);
  assert.equal(payload.sourceVersions.hrn_modelos, 3);
  assert.deepEqual(payload.catalogs.hrn_modelos[0], model);
  assert.equal(payload.catalogs.hrn_earv_estoque["CMP-1"], 4);
  assert.equal(payload.stockSources.brutos.items[0].quantity, 3);
});

test("gera planilha legível e mantém o JSON como formato integral", () => {
  const payload = buildCatalogExport({ snapshot: { data: { hrn_modelos: [{ sku: "HP-1", estrutura: { bruto: "B-1" } }] } } });
  const workbook = XLSX.read(catalogExportWorkbook(payload), { type: "buffer" });
  assert.equal(workbook.SheetNames.includes("Helices"), true);
  assert.equal(workbook.SheetNames.includes("Metadados"), true);
  const data = XLSX.utils.sheet_to_json(workbook.Sheets.Helices);
  assert.equal(data[0].estrutura, JSON.stringify({ bruto: "B-1" }));
});

