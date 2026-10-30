import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseComponentRoutingWorkbook, planComponentRoutings } from "../../server/component-routing-import.js";

function workbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "BOM Componentes");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const headers = ["Posição", "SKU", "Descrição", "Quantidade", "OP 01 (Compras)", "OP 02 (Usinagem)", "OP 05 (Montagem)", "Chave_Familia", "Chave_Linha"];
const steps = [
  { id: "step-1", code: "CO - OP 01", status: "active" },
  { id: "step-2", code: "CO - OP 02", status: "active" },
  { id: "step-5", code: "CO - OP 05", status: "active" }
];

test("lê operações CO e preserva responsável e sequência da planilha", () => {
  const parsed = parseComponentRoutingWorkbook(workbookBuffer([
    headers,
    ["00", "FG-1", "Produto montado", 1, "-", "Danilo", "Montagem", "F1", "FG-1"],
    ["01", "CMP-1", "Componente usinado", 1, "-", "Danilo", "-", "F1", "CMP-1"],
    ["02", "MAT-1", "Material comprado", 2, "Alberto", "-", "-", "F1", "MAT-1"]
  ]));

  assert.equal(parsed.summary.uniqueSkus, 3);
  const plan = planComponentRoutings(parsed, [
    { id: "p1", primary_sku: "FG-1", primary_sku_normalized: "FG-1", family: "componentes" },
    { id: "p2", primary_sku: "CMP-1", primary_sku_normalized: "CMP-1", family: "componentes" },
    { id: "p3", primary_sku: "MAT-1", primary_sku_normalized: "MAT-1", family: "componentes" }
  ], steps, []);

  assert.equal(plan.canImport, true);
  assert.equal(plan.plan.length, 4);
  assert.deepEqual(plan.plan.filter(item => item.sku === "FG-1").map(item => [item.stepCode, item.sequence]), [["CO - OP 02", 2], ["CO - OP 05", 5]]);
  assert.match(plan.plan.find(item => item.sku === "MAT-1").instructions, /Alberto/);
});

test("não substitui vínculos existentes e bloqueia colisão de sequência", () => {
  const parsed = parseComponentRoutingWorkbook(workbookBuffer([
    headers,
    ["01", "CMP-1", "Componente", 1, "Alberto", "Danilo", "-", "F1", "F1-L1"]
  ]));
  const products = [{ id: "p1", primary_sku: "CMP-1", primary_sku_normalized: "CMP-1", family: "componentes" }];
  const already = planComponentRoutings(parsed, products, steps, [{ product_id: "p1", production_step_id: "step-1", sequence: 1 }]);
  assert.equal(already.canImport, true);
  assert.deepEqual(already.plan.map(item => item.sequence), [2]);
  assert.equal(already.summary.alreadyLinked, 1);

  const conflict = planComponentRoutings(parsed, products, steps, [{ product_id: "p1", production_step_id: "other-step", sequence: 1 }]);
  assert.equal(conflict.canImport, false);
  assert.equal(conflict.summary.sequenceConflicts, 1);
});

test("separa SKU com etapas divergentes e exige operação registrada e produto do grupo Componentes", () => {
  const parsed = parseComponentRoutingWorkbook(workbookBuffer([
    headers,
    ["00", "CONFLICT", "Peça", 1, "-", "Danilo", "-", "F1", "F1-L1"],
    ["01", "CONFLICT", "Peça", 1, "Alberto", "-", "-", "F2", "F2-L1"],
    ["01", "MISSING", "Peça", 1, "-", "Danilo", "-", "F2", "F2-L2"],
    ["01", "OTHER", "Peça", 1, "-", "-", "-", "F2", "F2-L3"]
  ]));
  const plan = planComponentRoutings(parsed, [
    { id: "p1", primary_sku: "CONFLICT", primary_sku_normalized: "CONFLICT", family: "componentes" },
    { id: "p2", primary_sku: "MISSING", primary_sku_normalized: "MISSING", family: "componentes" },
    { id: "p3", primary_sku: "OTHER", primary_sku_normalized: "OTHER", family: "helices" }
  ], steps.filter(step => step.code !== "CO - OP 02"), []);

  assert.equal(plan.warnings.some(warning => warning.sku === "CONFLICT"), true);
  assert.equal(plan.canImport, false);
  assert.equal(plan.issues.some(issue => issue.code === "PRODUCT_FAMILY_MISMATCH"), true);
  assert.equal(plan.issues.some(issue => issue.code === "COMPONENT_STEP_NOT_FOUND"), true);
});
