import assert from "node:assert/strict";
import {
  adjustRawMaterialStock,
  closeDatabase,
  getRawMaterialStock,
  getStateSnapshot,
  mutateManualProductionOrder
} from "../server/database.js";

const actor = "QA_RAW_STOCK";
let testOpId = "";

try {
  const initialStock = await getRawMaterialStock();
  const raw = initialStock.items.find(item => item.quantity === 0);
  assert.ok(raw, "Deve existir uma peca bruta com saldo zero para o teste.");
  const snapshot = await getStateSnapshot(0);
  const model = (snapshot.data.hrn_modelos || []).find(item =>
    String(item.codigoBruto || "").trim().toLocaleUpperCase("pt-BR") === raw.rawCode
  );
  assert.ok(model, `Deve existir uma helice vinculada a ${raw.rawCode}.`);

  const adjusted = await adjustRawMaterialStock(raw.rawCode, 10, initialStock.version, actor);
  assert.equal(adjusted.items.find(item => item.rawCode === raw.rawCode).quantity, 10);

  const created = await mutateManualProductionOrder("create", "", {
    modelo: model.nome, qty: 4, cliente: "QA", prazo: "2099-12-31", etapa: "Fila de Espera", prioridade: "Normal", obs: "Teste transacional"
  }, snapshot.versions.hrn_ops, actor);
  testOpId = created.op.id;
  assert.equal(created.stock.find(item => item.rawCode === raw.rawCode).quantity, 6, "Criacao deve consumir uma vez.");

  await assert.rejects(
    mutateManualProductionOrder("create", "", { modelo: model.nome, qty: 4 }, snapshot.versions.hrn_ops, actor),
    error => error.status === 409
  );

  const updated = await mutateManualProductionOrder("update", testOpId, { ...created.op, qty: 6 }, created.version, actor);
  assert.equal(updated.stock.find(item => item.rawCode === raw.rawCode).quantity, 4, "Edicao deve consumir apenas a diferenca.");

  await assert.rejects(
    mutateManualProductionOrder("update", testOpId, { ...updated.op, qty: 20 }, updated.version, actor),
    error => error.code === "INSUFFICIENT_RAW_STOCK"
  );

  const cancelled = await mutateManualProductionOrder("delete", testOpId, null, updated.version, actor);
  testOpId = "";
  assert.equal(cancelled.stock.find(item => item.rawCode === raw.rawCode).quantity, 10, "Cancelamento deve devolver todo o consumo.");

  await adjustRawMaterialStock(raw.rawCode, 0, cancelled.versions.hrn_materiais, actor);
  console.log(`QA estoque bruto: ${raw.rawCode}, baixa unica, diferenca, bloqueio negativo e estorno validados.`);
} finally {
  const snapshot = await getStateSnapshot(0);
  if (testOpId && (snapshot.data.hrn_ops || []).some(op => op.id === testOpId)) {
    await mutateManualProductionOrder("delete", testOpId, null, snapshot.versions.hrn_ops, actor);
  }
  const stockAfterTest = await getRawMaterialStock();
  const changedRaw = stockAfterTest.items.find(item => item.movements?.some(entry => entry.usuario === actor));
  if (changedRaw && changedRaw.quantity !== 0) {
    await adjustRawMaterialStock(changedRaw.rawCode, 0, stockAfterTest.version, actor);
  }
  // O ledger e a auditoria são históricos: este teste não os reescreve por
  // endpoint genérico. Execute-o somente em banco descartável de integração.
  await closeDatabase();
}
