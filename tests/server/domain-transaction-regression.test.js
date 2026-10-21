import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../server/database.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} deve existir`);
  assert.notEqual(end, -1, `${nextName} deve delimitar ${name}`);
  return source.slice(start, end);
}

test("estoque bruto continua usando lock e transacao PostgreSQL", () => {
  const body = functionBody("adjustRawMaterialStock", "mutateManualProductionOrder");
  assert.match(body, /return transaction\(async client/);
  assert.match(body, /lockStateRows\(client/);
  assert.match(body, /hrn_materiais/);
  assert.match(body, /hrn_movimentos/);
});

test("finalizacao da fundicao continua atomica com entrada no estoque bruto", () => {
  const body = functionBody("finalizeFundicaoOrder", "updateFundicaoOrder");
  assert.match(body, /return transaction\(async client/);
  assert.match(body, /lockStateRows\(client/);
  assert.match(body, /hrn_fundicoes/);
  assert.match(body, /hrn_materiais/);
  assert.match(body, /hrn_movimentos/);
  assert.match(body, /FUND_OP_FINALIZE/);
});
