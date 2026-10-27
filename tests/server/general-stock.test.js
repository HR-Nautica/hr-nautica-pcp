import assert from "node:assert/strict";
import test from "node:test";
import { buildGeneralStock } from "../../server/general-stock.js";

function sample() {
  return {
    snapshot: { revision: 7, data: {
      hrn_modelos: [{ id: "hel-1", sku: "HP-1", nome: "Hélice 1" }],
      hrn_estoque_arvore: [{ SKU: "CMP-1", Descricao: "Componente 1" }],
      hrn_earv_estoque: { "CMP-1": 4 },
      hrn_earv_meta: { updatedAt: "2026-10-27T10:00:00.000Z" },
      hrn_fundicao_catalog: [{ id: "raw-1", coquilha: "COQ-1", descricao: "Bruto 1" }]
    } },
    analysisRows: [{ sku: "HP-1", produto: "Hélice 1", estoqueFisico: 8, importedAt: "2026-10-27T09:00:00.000Z" }],
    buchasStock: { catalog: [{ id: "b-1", sku: "B-1", descricao: "Bucha 1" }], items: [{ sku: "B-1", estoqueFinal: 2 }] },
    rawStock: { items: [{ id: "raw-state-1", rawCode: "COQ-1", quantity: 3, updatedAt: "2026-10-27T11:00:00.000Z" }] }
  };
}

test("consolida as quatro famílias sem criar disponibilidade fictícia", () => {
  const result = buildGeneralStock(sample());
  assert.equal(result.items.filter(item => item.catalogStatus === "active").length, 4);
  assert.equal(result.items.every(item => item.availableStock === null && item.reservedStock === null), true);
  assert.equal(result.items.find(item => item.family === "helices").physicalStock, 8);
  assert.equal(result.items.find(item => item.family === "componentes").physicalStock, 4);
  assert.equal(result.items.find(item => item.family === "buchas").physicalStock, 2);
  assert.equal(result.items.find(item => item.family === "brutos").physicalStock, 3);
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
