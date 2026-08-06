import assert from "node:assert/strict";
import { buildOperationMovement, closeDatabase, transaction } from "../server/database.js";

const ROLLBACK_MARKER = "QA_HELICE_OP_ROLLBACK";
let checked = false;

try {
  await transaction(async client => {
    const selected = await client.query(`
      SELECT id, quantity, operations, operation_history, current_operation
      FROM helice_production_orders
      WHERE status = 'em_producao' AND current_operation < '09' AND quantity > 0
      ORDER BY id
      LIMIT 1
    `);
    assert.equal(selected.rows.length, 1, "deve existir uma OP ativa para o teste");

    const source = selected.rows[0];
    const movement = buildOperationMovement({
      operations: source.operations,
      operationHistory: source.operation_history,
      currentOperation: source.current_operation,
      quantity: source.quantity
    }, Number(source.quantity) - 1, "QA_ROLLBACK", new Date().toISOString());

    const advancedResult = await client.query(`
      UPDATE helice_production_orders
      SET operations = $1::jsonb, operation_history = operation_history || $2::jsonb,
          current_operation = $3, current_operation_name = $4, quantity = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING quantity, current_operation, operations, operation_history
    `, [
      JSON.stringify(movement.operations), JSON.stringify([movement.movement]),
      movement.nextOperation.code, movement.nextOperation.name, movement.forwardedQuantity, source.id
    ]);
    const advanced = advancedResult.rows[0];
    assert.equal(Number(advanced.quantity), Number(source.quantity) - 1);
    assert.equal(advanced.current_operation, movement.nextOperation.code);
    assert.equal(advanced.operation_history.at(-1).scrapQuantity, 1);

    const result = await client.query(`
      UPDATE helice_production_orders
      SET operations = jsonb_set(operations, '{8,quantity}', to_jsonb(quantity), true),
          operation_history = operation_history || jsonb_build_object('type','finish','quantity',quantity,'actor','QA_ROLLBACK','at',NOW()),
          status = 'finalizada', current_operation = '09', current_operation_name = '9 - Finalizado',
          finished_at = NOW(), finished_by = 'QA_ROLLBACK', updated_at = NOW()
      WHERE id = $1
      RETURNING status, current_operation, finished_by, operations
    `, [selected.rows[0].id]);

    const finalized = result.rows[0];
    assert.equal(finalized.status, "finalizada");
    assert.equal(finalized.current_operation, "09");
    assert.equal(finalized.finished_by, "QA_ROLLBACK");
    assert.equal(Number(finalized.operations[8].quantity), Number(selected.rows[0].quantity) - 1);
    checked = true;
    throw new Error(ROLLBACK_MARKER);
  });
} catch (error) {
  if (error.message !== ROLLBACK_MARKER) throw error;
} finally {
  await closeDatabase();
}

assert.equal(checked, true);
console.log("QA Supabase: avanço, refugo, histórico e finalização validados com rollback.");
