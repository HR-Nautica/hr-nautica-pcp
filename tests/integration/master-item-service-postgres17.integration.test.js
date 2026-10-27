import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import pg from "pg";
import { migrate } from "../../scripts/db/migration-runner.js";
import { addMasterItemAlias, canonicalPayloadHash, createMasterItem, getMasterItem, listMasterItemAliases, listMasterItems, MasterItemError, resolveMasterItemCode, updateMasterItem } from "../../server/master-items.js";
import { closeDatabase } from "../../server/database.js";
import path from "node:path";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATIONS_TEST_DATABASE_URL obrigatoria.");
const { Client } = pg;
const directory = path.resolve("database", "migrations");
let admin;
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };
async function reset() { await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); const client = await connect(); await migrate({ client, directory, operator: "master-item-service.test" }); await client.end(); }
const meta = (eventKey, actor = "arquitetura") => ({ eventKey, actor });
async function create(sku = "00123", key = `create-${sku}`) { return createMasterItem({ primarySku: sku, family: "helices", description: `Item ${sku}`, unit: "un" }, meta(key)); }

before(async () => { admin = await connect(); });
beforeEach(reset);
after(async () => { await closeDatabase(); await admin.end(); });

test("cria Item Mestre, preserva zeros, normaliza hash e recupera repeticao idempotente", async () => {
  assert.equal(canonicalPayloadHash({ b: 1, a: { z: 2, y: 3 } }), canonicalPayloadHash({ a: { y: 3, z: 2 }, b: 1 }));
  const first = await create("00123", "evt-create"); const again = await create("00123", "evt-create");
  assert.equal(first.item.primary_sku, "00123"); assert.equal(first.item.primary_sku_normalized, "00123"); assert.equal(first.idempotent, false); assert.equal(again.item.id, first.item.id); assert.equal(again.idempotent, true);
  await assert.rejects(() => createMasterItem({ primarySku: "00123", family: "helices", description: "Outro", unit: "un" }, meta("evt-create")), (error) => error instanceof MasterItemError && error.code === "MASTER_ITEM_EVENT_CONFLICT");
  await assert.rejects(() => create("00123", "outro-evento"), (error) => error instanceof MasterItemError && error.code === "MASTER_ITEM_SKU_CONFLICT");
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_items")).rows[0].n, 1);
});

test("criacao concorrente com a mesma chave gera somente um Item Mestre", async () => {
  const input = { primarySku: "CONCORRENTE", family: "buchas", description: "Bucha", unit: "un" };
  const [left, right] = await Promise.all([createMasterItem(input, meta("evt-concurrente")), createMasterItem(input, meta("evt-concurrente"))]);
  assert.equal(left.item.id, right.item.id); assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_items")).rows[0].n, 1);
});

test("atualizacao aplica CAS, registra historico de SKU e rollback preserva item", async () => {
  const created = await create("SKU-ANTIGO", "evt-old");
  const updated = await updateMasterItem(created.item.id, { primarySku: "SKU-NOVO", description: "Novo" }, { ...meta("evt-update"), expectedVersion: 1 });
  assert.equal(updated.item.version, 2); assert.equal(updated.item.primary_sku, "SKU-NOVO");
  const history = (await admin.query("SELECT old_primary_sku,new_primary_sku,old_version,new_version FROM public.master_item_sku_history WHERE item_id=$1", [created.item.id])).rows[0];
  assert.deepEqual(history, { old_primary_sku: "SKU-ANTIGO", new_primary_sku: "SKU-NOVO", old_version: 1, new_version: 2 });
  await assert.rejects(() => updateMasterItem(created.item.id, { description: "Obsoleta" }, { ...meta("evt-stale"), expectedVersion: 1 }), (error) => error instanceof MasterItemError && error.code === "MASTER_ITEM_VERSION_CONFLICT");
  await assert.rejects(() => updateMasterItem(created.item.id, { primarySku: "SKU-FALHA" }, { ...meta("evt-falha"), expectedVersion: 2, actor: "" }), /actor invalido/);
  assert.equal((await getMasterItem(created.item.id)).primary_sku, "SKU-NOVO"); assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_item_sku_history WHERE item_id=$1", [created.item.id])).rows[0].n, 1);
});

test("aliases respeitam FK, namespace, nao transferem e resolvem sem efeitos colaterais", async () => {
  const first = await create("A", "evt-a"); const second = await create("B", "evt-b");
  const alias = await addMasterItemAlias(first.item.id, { namespace: "tiny", originalCode: "  ab-01  " }, meta("evt-alias"));
  const repeat = await addMasterItemAlias(first.item.id, { namespace: "tiny", originalCode: "  ab-01  " }, meta("evt-alias"));
  assert.equal(alias.alias.normalized_code, "AB-01"); assert.equal(repeat.alias.id, alias.alias.id); assert.equal((await resolveMasterItemCode("tiny", "ab-01")).id, first.item.id);
  await assert.rejects(() => addMasterItemAlias(second.item.id, { namespace: "tiny", originalCode: "AB-01" }, meta("evt-collision")), (error) => error instanceof MasterItemError && error.code === "MASTER_ITEM_ALIAS_CONFLICT");
  await assert.rejects(() => admin.query("UPDATE public.item_aliases SET item_id=$1 WHERE id=$2", [second.item.id, alias.alias.id]), /immutable/);
  const before = await admin.query("SELECT count(*)::int n FROM public.master_item_idempotency_events"); await listMasterItemAliases(first.item.id); await resolveMasterItemCode("tiny", "AB-01"); await listMasterItems({ query: "A", page: 1, limit: 10 });
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.master_item_idempotency_events")).rows[0].n, before.rows[0].n);
});

test("servico nao escreve agregados operacionais legados", async () => {
  await create("OPERACIONAL", "evt-op");
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.app_state")).rows[0].n, 0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM public.helice_production_orders")).rows[0].n, 0);
});
