import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneralStock } from "../../server/general-stock.js";

function sample() {
  return {
    snapshot: { revision: 7, data: {
      hrn_modelos: [{ id: "hel-1", sku: "HP-1", nome: "Hélice 1", codigoBruto: "COQ-1", skuBucha: "B-1", skuCaixa: "CMP-1" }],
      hrn_estoque_arvore: [{ Posicao: "00", SKU: "CMP-1", Descricao: "Componente 1" }, { Posicao: "01", SKU: "CMP-2", Descricao: "Subcomponente", Quantidade: 2 }, { Posicao: "02", SKU: "MAT-1", Descricao: "Material", Quantidade: 0.5 }],
      hrn_earv_estoque: { "CMP-1": 4 },
      hrn_earv_meta: { updatedAt: "2026-10-27T10:00:00.000Z" },
      hrn_fundicao_catalog: [{ id: "raw-1", coquilha: "COQ-1", descricao: "Bruto 1" }, { id: "raw-2", coquilha: "COQ-1", descricao: "Outra aplicação" }]
    } },
    analysisRows: [{ sku: "HP-1", produto: "Hélice 1", estoqueFisico: 8, importedAt: "2026-10-27T09:00:00.000Z" }],
    buchasStock: { catalog: [{ id: "b-1", sku: "B-1", descricao: "Bucha 1" }], items: [{ sku: "B-1", estoqueFinal: 2 }] },
    rawStock: { items: [{ id: "raw-state-1", rawCode: "COQ-1", quantity: 3, updatedAt: "2026-10-27T11:00:00.000Z" }] }
  };
}

test("consolida as quatro famílias sem criar disponibilidade fictícia", () => {
  const result = buildGeneralStock(sample());
  assert.equal(result.items.length, 6);
  assert.equal(result.items.every(item => item.availableStock === null && item.reservedStock === null), true);
  assert.equal(result.items.find(item => item.family === "helices").physicalStock, 8);
  assert.equal(result.items.find(item => item.family === "componentes").physicalStock, 4);
  assert.equal(result.items.find(item => item.family === "buchas").physicalStock, 2);
  assert.equal(result.items.find(item => item.family === "brutos").physicalStock, 3);
  assert.equal(result.items.filter(item => item.family === "brutos").length, 1);
  assert.deepEqual(result.items.find(item => item.code === "CMP-1").bom.map(line => [line.code, line.quantity, line.status]), [["CMP-2", 2, "linked"]]);
  assert.deepEqual(result.items.find(item => item.code === "CMP-2").bom.map(line => [line.code, line.quantity, line.status]), [["MAT-1", 0.5, "linked"]]);
  assert.equal(result.items.find(item => item.code === "MAT-1").typeLabel, "Material");
  assert.deepEqual(result.items.find(item => item.code === "HP-1").bom.map(line => line.status), ["linked", "linked", "linked"]);
});

test("não transforma ausência de fonte em saldo zero e sinaliza duplicidade de identidade", () => {
  const input = sample();
  input.snapshot.data.hrn_modelos.push({ id: "hel-2", sku: "HP-1", nome: "Hélice duplicada" });
  input.snapshot.data.hrn_estoque_arvore.push({ SKU: "CMP-2", Descricao: "Componente sem snapshot" });
  const result = buildGeneralStock(input);
  const duplicated = result.items.filter(item => item.family === "helices");
  assert.equal(duplicated.every(item => item.identityStatus === "ambiguous" && item.physicalStock === null), true);
  assert.equal(result.items.find(item => item.code === "CMP-2").stockStatus, "pending");
});

test("não promove linhas de saldo sem catálogo nem inventa quantidade de BOM", () => {
  const input = sample();
  input.analysisRows.push({ sku: "FORA-1", produto: "Só na planilha", estoqueFisico: 33 });
  input.rawStock.items.push({ rawCode: "FORA-2", quantity: 9 });
  input.snapshot.data.hrn_modelos[0].skuCaixa = "CAIXA-SEM-CADASTRO";
  const result = buildGeneralStock(input);
  assert.equal(result.items.some(item => item.code === "FORA-1" || item.code === "FORA-2"), false);
  assert.equal(result.summary.unmatchedSourceRows.helices, 1);
  assert.equal(result.summary.unmatchedSourceRows.brutos, 1);
  assert.equal(result.items.find(item => item.code === "HP-1").bom.find(line => line.role === "Caixa").status, "not_cataloged");
  assert.equal(result.items.find(item => item.code === "HP-1").bom.every(line => line.quantity === null), true);
});

test("saldos internos com código duplicado aguardam reconciliação", () => {
  const input = sample();
  input.rawStock.items.push({ rawCode: "COQ-1", quantity: 8 });
  input.buchasStock.items.push({ sku: "B-1", estoqueFinal: 7 });
  const result = buildGeneralStock(input);
  for (const family of ["brutos", "buchas"]) {
    const item = result.items.find(row => row.family === family);
    assert.equal(item.identityStatus, "ambiguous");
    assert.equal(item.physicalStock, null);
  }
});
