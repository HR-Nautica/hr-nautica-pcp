import assert from "node:assert/strict";
import path from "node:path";
import { parseHeliceProductionWorkbook } from "./helice-ops-parser.js";
import { buildOperationMovement } from "../server/database.js";

const workbookPath = path.resolve("public", "Novas Planilhas", "Acompanhamento_Helice.xlsx");
const parsed = parseHeliceProductionWorkbook(workbookPath);

assert.equal(parsed.sourceSheet, "prod-comp helices");
assert.equal(parsed.operationNames.length, 9, "as colunas F:N devem gerar nove operações");
assert.equal(parsed.orders.length, 76, "cada linha preenchida deve gerar uma OP");
assert.ok(parsed.orders.every(order => order.sku && order.description));
assert.ok(parsed.orders.every(order => order.operations.length === 9));
assert.ok(parsed.orders.every(order => /^\d{2}$/.test(order.currentOperation)));

const repeatedSku = parsed.orders.filter(order => order.sku === "HR HM 005");
assert.ok(repeatedSku.length > 1, "o mesmo SKU deve aceitar várias OPs independentes");
assert.equal(new Set(repeatedSku.map(order => order.sourceKey)).size, repeatedSku.length);

const finished = parsed.orders.filter(order => order.status === "finalizada");
assert.equal(finished.length, 0, "a planilha atual ainda não possui linhas preenchidas na operação 9");

const sampleOperations = parsed.operationNames.map((name, index) => ({
  code: String(index + 1).padStart(2, "0"), name, quantity: index === 0 ? 300 : null
}));
const movement = buildOperationMovement({
  operations: sampleOperations,
  currentOperation: "01",
  quantity: 300
}, 200, "QA", "2026-08-06T12:00:00.000Z");
assert.equal(movement.forwardedQuantity, 200);
assert.equal(movement.movement.inputQuantity, 300);
assert.equal(movement.movement.scrapQuantity, 100);
assert.equal(movement.nextOperation.code, "02");
assert.equal(movement.operations[1].quantity, 200);

console.log(`QA rastreio: ${parsed.orders.length} OPs, 9 operações, avanço 300→200 e refugo 100 validados.`);
