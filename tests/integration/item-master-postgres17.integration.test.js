import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import { inspectMigrations, migrate } from "../../scripts/db/migration-runner.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString || !/^postgresql:\/\/migration_test:[^@]+@hrn-postgres17-test-[a-f0-9]+:5432\/migration_test$/.test(connectionString)) throw new Error("URL descartável PostgreSQL 17 obrigatória.");
const { Client } = pg;
const directory = path.resolve("database", "migrations");
let admin;
const connect = async () => { const c = new Client({ connectionString }); await c.connect(); return c; };
async function reset() { await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); const c = await connect(); await migrate({ client: c, directory, operator: "item-master.test" }); await c.end(); }
async function item(values = {}) {
  const v = { sku: "HR 001", family: "helices", description: "Item teste", unit: "un", ...values };
  return (await admin.query("INSERT INTO public.master_items (primary_sku,family,description,unit) VALUES ($1,$2,$3,$4) RETURNING *", [v.sku,v.family,v.description,v.unit])).rows[0];
}
before(async () => { admin = await connect(); assert.match((await admin.query("SHOW server_version")).rows[0].server_version, /^17\./); });
beforeEach(reset);
after(async () => admin.end());

test("V003 aplica e registra checksum sem tocar agregados legados", async () => {
  const report = await inspectMigrations({ client: admin, directory }); assert.equal(report.valid, true);
  assert.deepEqual((await admin.query("SELECT version FROM public.schema_migrations ORDER BY version")).rows.map(x => x.version), ["1","2","3","4","5"]);
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.app_state")).rows[0].n, 0);
});
test("item válido recebe UUID, versão e normalização conservadora", async () => {
  const a = await item({sku:"00123"}), b = await item({sku:"123",description:"Outro"}); assert.match(a.id,/^[0-9a-f-]{36}$/); assert.equal(a.primary_sku_normalized,"00123"); assert.equal(b.primary_sku_normalized,"123");
  await assert.rejects(() => item({sku:" 00123 ",description:"Espaço"})); await assert.rejects(() => item({sku:"00123",description:"Duplicado"}));
});
test("valida família/campos e impede mudar UUID", async () => {
  const a = await item(); await assert.rejects(() => admin.query("UPDATE public.master_items SET id=gen_random_uuid() WHERE id=$1",[a.id]),/immutable/);
  await assert.rejects(() => item({family:"fundicao"})); await assert.rejects(() => item({unit:" "}));
});
test("aliases aplicam namespace, FK, unicidade e não transferência", async () => {
  const a=await item({sku:"A"}), b=await item({sku:"B",description:"B"});
  const x=(await admin.query("INSERT INTO public.item_aliases (item_id,namespace,original_code) VALUES ($1,'tiny','  ab-01  ') RETURNING *",[a.id])).rows[0];
  assert.equal(x.original_code,"  ab-01  "); assert.equal(x.normalized_code,"AB-01");
  await assert.rejects(() => admin.query("INSERT INTO public.item_aliases (item_id,namespace,original_code) VALUES ($1,'tiny','AB-01')",[b.id]));
  await admin.query("INSERT INTO public.item_aliases (item_id,namespace,original_code) VALUES ($1,'legacy_helices','AB-01')",[b.id]);
  await assert.rejects(() => admin.query("INSERT INTO public.item_aliases (item_id,namespace,original_code) VALUES (gen_random_uuid(),'erp','X')"));
  await admin.query("UPDATE public.item_aliases SET status='inactive' WHERE id=$1",[x.id]); await assert.rejects(() => admin.query("UPDATE public.item_aliases SET item_id=$1 WHERE id=$2",[b.id,x.id]),/immutable/);
});
test("FK restrict, rollback e concorrência preservam identificadores", async () => {
  const a=await item({sku:"CONCORRENTE"}); await admin.query("INSERT INTO public.item_aliases (item_id,namespace,original_code) VALUES ($1,'erp','X')",[a.id]);
  await assert.rejects(() => admin.query("DELETE FROM public.master_items WHERE id=$1",[a.id]));
  const c1=await connect(), c2=await connect(); try { await c1.query("BEGIN"); await c1.query("INSERT INTO public.master_items (primary_sku,family,description,unit) VALUES ('DUP','buchas','D1','un')"); const duplicate=c2.query("INSERT INTO public.master_items (primary_sku,family,description,unit) VALUES ('dup','buchas','D2','un')"); await c1.query("COMMIT"); await assert.rejects(duplicate); } finally { await c1.query("ROLLBACK").catch(()=>{}); await c1.end(); await c2.end(); }
});
test("checksum de V003 corresponde ao arquivo e falha transacional não persiste", async () => {
  const source=await readFile(path.join(directory,"V003__master_items_and_aliases.sql")); const checksum=createHash("sha256").update(source).digest("hex"); assert.equal((await admin.query("SELECT checksum_sha256 FROM public.schema_migrations WHERE version=3")).rows[0].checksum_sha256,checksum);
  await admin.query("BEGIN"); await item({sku:"ROLL"}); await assert.rejects(() => item({sku:"ROLL",description:"Erro"})); await admin.query("ROLLBACK"); assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_items WHERE primary_sku='ROLL'")).rows[0].n,0);
});
