import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import { inspectMigrations, migrate } from "../../scripts/db/migration-runner.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString || !/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) throw new Error("URL descartavel PostgreSQL 17 obrigatoria.");
const { Client } = pg;
const directory = path.resolve("database", "migrations");
let admin;
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
async function reset() { await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); const client = await connect(); await migrate({ client, directory, operator: "master-item-events.test" }); await client.end(); }
async function item(values = {}) { const value = { sku: "HR 001", family: "helices", description: "Item teste", unit: "un", ...values }; return (await admin.query("INSERT INTO public.master_items (primary_sku,family,description,unit) VALUES ($1,$2,$3,$4) RETURNING *", [value.sku,value.family,value.description,value.unit])).rows[0]; }

before(async () => { admin = await connect(); assert.match((await admin.query("SHOW server_version")).rows[0].server_version, /^17\./); });
beforeEach(reset);
after(async () => admin.end());

test("V004 aplica, preserva checksums V001-V003 e nao toca agregados legados", async () => {
  assert.deepEqual((await admin.query("SELECT version FROM public.schema_migrations ORDER BY version")).rows.map((row) => row.version), ["1", "2", "3", "4", "5"]);
  for (const [version, filename] of [[1,"V001__baseline.sql"],[2,"V002__authentication.sql"],[3,"V003__master_items_and_aliases.sql"],[4,"V004__master_item_events_and_sku_history.sql"],[5,"V005__legacy_catalog_master_links.sql"]]) {
    const checksum = createHash("sha256").update(await readFile(path.join(directory, filename))).digest("hex");
    assert.equal((await admin.query("SELECT checksum_sha256 FROM public.schema_migrations WHERE version=$1", [version])).rows[0].checksum_sha256, checksum);
  }
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.app_state")).rows[0].n, 0);
});

test("evento idempotente e unico por operacao, mas a mesma chave pode existir em outro escopo", async () => {
  const a = await item({ sku: "EVENTO" });
  await admin.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ('master_item_create','evt-1',$1,$2,$3::jsonb,'teste')", ["a".repeat(64), a.id, JSON.stringify({ itemId: a.id })]);
  await assert.rejects(() => admin.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ('master_item_create','evt-1',$1,$2,'{}','teste')", ["b".repeat(64), a.id]));
  await admin.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ('master_item_update','evt-1',$1,$2,'{}','teste')", ["b".repeat(64), a.id]);
  await assert.rejects(() => admin.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ('master_item_create','evt-foreign',$1,gen_random_uuid(),'{}','teste')", ["c".repeat(64)]));
});

test("alteracao de SKU requer historico equivalente na mesma transacao", async () => {
  const a = await item({ sku: "SKU-ANTIGO" });
  await admin.query("BEGIN");
  const changed = (await admin.query("UPDATE public.master_items SET primary_sku='SKU-NOVO', version=version+1, updated_by='operador' WHERE id=$1 RETURNING *", [a.id])).rows[0];
  await admin.query("INSERT INTO public.master_item_sku_history (item_id,old_primary_sku,old_primary_sku_normalized,new_primary_sku,new_primary_sku_normalized,old_version,new_version,actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [a.id,a.primary_sku,a.primary_sku_normalized,changed.primary_sku,changed.primary_sku_normalized,a.version,changed.version,"operador"]);
  await admin.query("COMMIT");
  const history = (await admin.query("SELECT * FROM public.master_item_sku_history WHERE item_id=$1", [a.id])).rows[0];
  assert.equal(history.old_primary_sku, "SKU-ANTIGO"); assert.equal(history.new_primary_sku, "SKU-NOVO"); assert.equal(history.old_version, 1); assert.equal(history.new_version, 2);
  await assert.rejects(() => admin.query("UPDATE public.master_items SET primary_sku='SEM-HISTORICO', version=version+1 WHERE id=$1", [a.id]), /requires matching/);
});

test("rollback remove alteracao de SKU, historico e evento ainda nao confirmado", async () => {
  const a = await item({ sku: "ROLL-SKU" });
  await admin.query("BEGIN");
  const changed = (await admin.query("UPDATE public.master_items SET primary_sku='ROLL-SKU-NOVO', version=version+1, updated_by='operador' WHERE id=$1 RETURNING *", [a.id])).rows[0];
  await admin.query("INSERT INTO public.master_item_sku_history (item_id,old_primary_sku,old_primary_sku_normalized,new_primary_sku,new_primary_sku_normalized,old_version,new_version,actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [a.id,a.primary_sku,a.primary_sku_normalized,changed.primary_sku,changed.primary_sku_normalized,a.version,changed.version,"operador"]);
  await admin.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ('master_item_update','evt-rollback',$1,$2,'{}','operador')", ["d".repeat(64), a.id]);
  await admin.query("ROLLBACK");
  assert.equal((await admin.query("SELECT primary_sku FROM public.master_items WHERE id=$1", [a.id])).rows[0].primary_sku, "ROLL-SKU");
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_item_sku_history WHERE item_id=$1", [a.id])).rows[0].n, 0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_item_idempotency_events WHERE event_key='evt-rollback'")).rows[0].n, 0);
});
