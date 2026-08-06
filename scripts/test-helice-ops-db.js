import assert from "node:assert/strict";
import { closeDatabase, transaction } from "../server/database.js";

const ROLLBACK_MARKER = "QA_HELICE_OP_ROLLBACK";
let checked = false;

try {
  await transaction(async client => {
    const selected = await client.query(`
      SELECT id, quantity
      FROM helice_production_orders
      WHERE status = 'em_producao'
      ORDER BY id
      LIMIT 1
    `);
    assert.equal(selected.rows.length, 1, "deve existir uma OP ativa para o teste");

    const result = await client.query(`
      UPDATE helice_production_orders
      SET operations = jsonb_set(operations, '{8,quantity}', to_jsonb(quantity), true),
          status = 'finalizada', current_operation = '09', current_operation_name = '9 - Finalizado',
          finished_at = NOW(), finished_by = 'QA_ROLLBACK', updated_at = NOW()
      WHERE id = $1
      RETURNING status, current_operation, finished_by, operations
    `, [selected.rows[0].id]);

    const finalized = result.rows[0];
    assert.equal(finalized.status, "finalizada");
    assert.equal(finalized.current_operation, "09");
    assert.equal(finalized.finished_by, "QA_ROLLBACK");
    assert.equal(Number(finalized.operations[8].quantity), Number(selected.rows[0].quantity));
    checked = true;
    throw new Error(ROLLBACK_MARKER);
  });
} catch (error) {
  if (error.message !== ROLLBACK_MARKER) throw error;
} finally {
  await closeDatabase();
}

assert.equal(checked, true);
console.log("QA finalização: status, operação 9 e quantidade validados com rollback.");
