import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import path from "node:path";
import { migrate } from "../../scripts/db/migration-runner.js";
import { closeDatabase } from "../../server/database.js";
import { createProduct, updateProduct } from "../../server/product-catalog.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATIONS_TEST_DATABASE_URL obrigatoria.");
const { Client } = pg;
const directory = path.resolve("database", "migrations");
let admin;
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
async function reset() {
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const client = await connect();
  await migrate({ client, directory, operator: "product-catalog.test" });
  await client.end();
}

before(async () => { admin = await connect(); });
beforeEach(reset);
after(async () => { await closeDatabase(); await admin.end(); });

test("editar campos do produto sem trocar SKU nao exige historico, e trocar SKU registra historico", async () => {
  const initial = await createProduct({
    sku: "SKU-INICIAL", family: "componentes", description: "Componente",
    unit: "UN", itemType: "Componente", tinyImportEnabled: false
  }, "operador");

  const edited = await updateProduct(initial.id, {
    sku: initial.primary_sku, family: initial.family, description: initial.description,
    unit: initial.unit, itemType: initial.item_type, basicCharacteristics: {},
    tinyImportEnabled: true, status: initial.status, version: initial.version
  }, "operador");
  assert.equal(edited.tiny_import_enabled, true);
  assert.equal(edited.version, 2);
  assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.master_item_sku_history WHERE item_id=$1", [initial.id])).rows[0].total, 0);

  const renamed = await updateProduct(initial.id, {
    sku: "SKU-RENOMEADO", family: edited.family, description: edited.description,
    unit: edited.unit, itemType: edited.item_type, basicCharacteristics: {},
    tinyImportEnabled: true, status: edited.status, version: edited.version
  }, "operador");
  assert.equal(renamed.primary_sku, "SKU-RENOMEADO");
  assert.equal(renamed.version, 3);
  const history = (await admin.query("SELECT old_primary_sku,new_primary_sku,old_version,new_version,actor FROM public.master_item_sku_history WHERE item_id=$1", [initial.id])).rows[0];
  assert.deepEqual(history, { old_primary_sku: "SKU-INICIAL", new_primary_sku: "SKU-RENOMEADO", old_version: 2, new_version: 3, actor: "operador" });
});
