import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import pg from "pg";
import { migrate } from "../../scripts/db/migration-runner.js";

const connectionString = process.env.MIGRATIONS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("MIGRATIONS_TEST_DATABASE_URL obrigatoria.");
const { Client } = pg;
const migrationsDirectory = path.resolve("database", "migrations");
let admin;
let previousMigrationsDirectory;
const connect = async () => { const client = new Client({ connectionString }); await client.connect(); return client; };

async function addProduct(sku) {
  return (await admin.query(
    "INSERT INTO public.master_items(primary_sku,family,description,unit,item_type,created_by,updated_by) VALUES($1,'componentes',$1,'UN','Componente','bom.test','bom.test') RETURNING id",
    [sku]
  )).rows[0].id;
}

async function addLine({ sourceLineId, familyKey, lineOrder, level, rootId, parentId, childId, quantity = null, status = "pending", sourceSchema = "normalized_bom_v1" }) {
  return (await admin.query(
    `INSERT INTO public.product_bom_lines
      (parent_product_id,child_product_id,quantity,unit,level_code,link_status,source_line_id,source_payload,created_by,updated_by)
     VALUES($1,$2,$3,'UN',$4,$5,$6,$7::jsonb,'bom.test','bom.test') RETURNING id`,
    [parentId || rootId, childId, quantity, String(level).padStart(2, "0"), status, sourceLineId,
      JSON.stringify({ sourceSchema, familyKey, originLineKey: `${familyKey}-L${String(lineOrder).padStart(3, "0")}` })]
  )).rows[0].id;
}

before(async () => {
  admin = await connect();
  previousMigrationsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "hrn-migrations-v008-"));
  const names = (await fs.readdir(migrationsDirectory)).filter(name => /^V00[1-8]__.*\.sql$/.test(name));
  for (const name of names) await fs.copyFile(path.join(migrationsDirectory, name), path.join(previousMigrationsDirectory, name));
});

after(async () => {
  await admin?.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;").catch(() => {});
  await admin?.end();
  if (previousMigrationsDirectory) await fs.rm(previousMigrationsDirectory, { recursive: true, force: true });
});

test("migration reparenta níveis da BOM e preserva quantidade, estado e trilha de reversão", async () => {
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate({ client: admin, directory: previousMigrationsDirectory, operator: "bom-hierarchy.setup" });

  const root = await addProduct("HR CNS 006");
  const body = await addProduct("HR MP 112");
  const brass = await addProduct("HR LR 007");
  const cover = await addProduct("HR MP 113");
  const brassCover = await addProduct("HR LR 001");
  const deep1 = await addProduct("DEEP-1");
  const deep2 = await addProduct("DEEP-2");
  const deep3 = await addProduct("DEEP-3");
  const manual = await addProduct("MANUAL-CHILD");

  await addLine({ sourceLineId: "BOM:C006:L002", familyKey: "FAM-C006", lineOrder: 2, level: 1, rootId: root, childId: body, quantity: 1, status: "active" });
  const bodyMaterialLine = await addLine({ sourceLineId: "BOM:C006:L003", familyKey: "FAM-C006", lineOrder: 3, level: 2, rootId: root, childId: brass });
  await addLine({ sourceLineId: "BOM:C006:L004", familyKey: "FAM-C006", lineOrder: 4, level: 1, rootId: root, childId: cover, quantity: 1, status: "active" });
  const coverMaterialLine = await addLine({ sourceLineId: "BOM:C006:L005", familyKey: "FAM-C006", lineOrder: 5, level: 2, rootId: root, childId: brassCover });

  await addLine({ sourceLineId: "BOM:DEEP:L001", familyKey: "FAM-DEEP", lineOrder: 1, level: 1, rootId: root, childId: deep1, quantity: 1, status: "active" });
  const deep2Line = await addLine({ sourceLineId: "BOM:DEEP:L002", familyKey: "FAM-DEEP", lineOrder: 2, level: 2, rootId: root, childId: deep2 });
  const deep3Line = await addLine({ sourceLineId: "BOM:DEEP:L003", familyKey: "FAM-DEEP", lineOrder: 3, level: 3, rootId: root, childId: deep3 });
  const manualLine = await addLine({ sourceLineId: "ERP:MANUAL", familyKey: "", lineOrder: 1, level: 2, rootId: root, childId: manual, sourceSchema: "erp" });

  await migrate({ client: admin, directory: migrationsDirectory, operator: "bom-hierarchy.test" });

  const parents = (await admin.query("SELECT id,parent_product_id,version,quantity,link_status FROM public.product_bom_lines WHERE id=ANY($1::uuid[])", [[bodyMaterialLine,coverMaterialLine,deep2Line,deep3Line,manualLine]])).rows;
  const byId = new Map(parents.map(line => [line.id, line]));
  assert.equal(byId.get(bodyMaterialLine).parent_product_id, body);
  assert.equal(byId.get(coverMaterialLine).parent_product_id, cover);
  assert.equal(byId.get(deep2Line).parent_product_id, deep1);
  assert.equal(byId.get(deep3Line).parent_product_id, deep2);
  assert.equal(byId.get(manualLine).parent_product_id, root);
  for (const id of [bodyMaterialLine, coverMaterialLine, deep2Line, deep3Line]) {
    assert.equal(byId.get(id).version, 2);
    assert.equal(byId.get(id).quantity, null);
    assert.equal(byId.get(id).link_status, "pending");
  }
  assert.equal(byId.get(manualLine).version, 1);
  assert.equal((await admin.query("SELECT count(*)::int AS total FROM public.product_bom_parent_repair_audit")).rows[0].total, 4);
  const audit = (await admin.query("SELECT previous_parent_product_id,corrected_parent_product_id FROM public.product_bom_parent_repair_audit WHERE line_id=$1", [bodyMaterialLine])).rows[0];
  assert.deepEqual(audit, { previous_parent_product_id: root, corrected_parent_product_id: body });
});
