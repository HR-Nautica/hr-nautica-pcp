import assert from "node:assert/strict";
import test from "node:test";

import { createMigrationGate } from "../../server/migration-gate.js";

function invoke(gate) {
  return new Promise((resolve) => gate({}, {}, resolve));
}

test("libera rota quando migrations exigidas estão aplicadas", async () => {
  const error = await invoke(createMigrationGate([3, 4], () => ({ pending: [5] })));
  assert.equal(error, undefined);
});

test("bloqueia somente a funcionalidade dependente e informa versões pendentes", async () => {
  const error = await invoke(createMigrationGate([3, 4, 5], () => ({ pending: [3, 5] })));
  assert.equal(error.code, "MIGRATIONS_PENDING");
  assert.deepEqual(error.pendingMigrations, [3, 5]);
});
