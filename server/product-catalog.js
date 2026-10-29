import { randomUUID } from "node:crypto";
import { transaction, withConnection } from "./database.js";

const TYPES = new Set(["Produto acabado / componente", "Componente", "Hélice usinada", "Hélice bruta", "Bucha", "Caixa"]);
const FAMILIES = new Set(["helices", "componentes", "buchas", "brutos"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogError extends Error {
  constructor(message, code = "CATALOG_VALIDATION", status = 400) { super(message); this.code = code; this.status = status; }
}

function fail(message, code, status) { throw new CatalogError(message, code, status); }
function text(value, name, max, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!result || result.length > max) fail(`${name} inválido.`);
  return result;
}
function id(value, name = "id") { const result = String(value || ""); if (!UUID.test(result)) fail(`${name} inválido.`); return result; }
function actor(value) { return text(value, "usuário", 100); }
function jsonObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function productInput(data) {
  if(data?.status!==undefined&&!['active','inactive'].includes(data.status))fail('Status inválido.');
  const family = text(data?.family, "família", 32);
  const itemType = text(data?.itemType, "tipo", 64);
  if (!FAMILIES.has(family) || !TYPES.has(itemType)) fail("Família ou tipo inválido.");
  return {
    sku: text(data?.sku, "SKU", 120), description: text(data?.description, "descrição", 500),
    family, itemType, unit: text(data?.unit || "UN", "unidade", 32),
    characteristics: jsonObject(data?.basicCharacteristics), tiny: Boolean(data?.tinyImportEnabled),
    status: data?.status === "inactive" ? "inactive" : "active"
  };
}

export async function listProducts({ query = "", page = 1, limit = 50 } = {}) {
  const safePage = Math.max(1, Number(page) || 1); const safeLimit = 1000;
  const search = `%${String(query).trim()}%`;
  return withConnection(async client => {
    const total = Number((await client.query("SELECT count(*)::int total FROM public.master_items WHERE primary_sku ILIKE $1 OR description ILIKE $1", [search])).rows[0].total);
    const items = (await client.query(`SELECT i.*,s.physical_quantity,s.stock_authority,EXISTS(SELECT 1 FROM public.product_bom_lines b WHERE b.parent_product_id=i.id) AS has_bom,EXISTS(SELECT 1 FROM public.product_routing_steps r WHERE r.product_id=i.id) AS has_routing FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id WHERE i.primary_sku ILIKE $1 OR i.description ILIKE $1 ORDER BY i.primary_sku_normalized,i.id LIMIT $2 OFFSET $3`, [search,safeLimit,(safePage-1)*safeLimit])).rows;
    return { items, total, page: safePage, limit: safeLimit };
  });
}

export async function getProduct(productId) {
  return withConnection(async client => {
    const product = (await client.query("SELECT i.*,s.physical_quantity,s.stock_authority FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id WHERE i.id=$1", [id(productId)])).rows[0];
    if (!product) fail("Produto não encontrado.", "PRODUCT_NOT_FOUND", 404);
    const bom = (await client.query("SELECT b.*,c.primary_sku child_sku,c.description child_description FROM public.product_bom_lines b JOIN public.master_items c ON c.id=b.child_product_id WHERE b.parent_product_id=$1 ORDER BY b.link_status,b.source_line_id", [productId])).rows;
    const routing = (await client.query("SELECT r.*,p.code,p.name FROM public.product_routing_steps r JOIN public.production_steps p ON p.id=r.production_step_id WHERE r.product_id=$1 ORDER BY r.sequence", [productId])).rows;
    const suppliers = (await client.query("SELECT l.*,s.legal_name,s.trade_name FROM public.product_supplier_links l JOIN public.product_suppliers s ON s.id=l.supplier_id WHERE l.product_id=$1 ORDER BY l.preferred DESC,s.legal_name", [productId])).rows;
    return { product, bom, routing, suppliers };
  });
}

export async function createProduct(data, username) {
  const input = productInput(data); const safeActor = actor(username);
  try { return await transaction(async client => {
    const product = (await client.query(`INSERT INTO public.master_items (primary_sku,family,description,unit,status,item_type,basic_characteristics,tiny_import_enabled,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9) RETURNING *`, [input.sku,input.family,input.description,input.unit,input.status,input.itemType,JSON.stringify(input.characteristics),input.tiny,safeActor])).rows[0];
    await client.query("INSERT INTO public.product_stock_balances(product_id,stock_authority,updated_by) VALUES($1,$2,$3)", [product.id,input.tiny?"tiny_import":"erp",safeActor]);
    return product;
  }); } catch (error) { if (error?.code === "23505") fail("SKU já cadastrado.", "PRODUCT_SKU_CONFLICT", 409); throw error; }
}

export async function updateProduct(productId, data, username) {
  const input = productInput(data); const safeActor = actor(username); const expected = Number(data?.version);
  if (!Number.isInteger(expected) || expected < 1) fail("Versão inválida.");
  try { return await transaction(async client => {
    const previous = (await client.query("SELECT * FROM public.master_items WHERE id=$1 FOR UPDATE", [id(productId)])).rows[0];
    if (!previous) fail("Produto não encontrado.", "PRODUCT_NOT_FOUND", 404);
    const product = (await client.query(`UPDATE public.master_items SET primary_sku=$1,family=$2,description=$3,unit=$4,status=$5,item_type=$6,basic_characteristics=$7::jsonb,tiny_import_enabled=$8,version=version+1,updated_at=clock_timestamp(),updated_by=$9 WHERE id=$10 AND version=$11 RETURNING *`, [input.sku,input.family,input.description,input.unit,input.status,input.itemType,JSON.stringify(input.characteristics),input.tiny,safeActor,id(productId),expected])).rows[0];
    if (!product) fail("Produto foi alterado por outro usuário.", "PRODUCT_VERSION_CONFLICT", 409);
    if (product.primary_sku !== previous.primary_sku) await client.query(`INSERT INTO public.master_item_sku_history (item_id,old_primary_sku,old_primary_sku_normalized,new_primary_sku,new_primary_sku_normalized,old_version,new_version,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [product.id,previous.primary_sku,previous.primary_sku_normalized,product.primary_sku,product.primary_sku_normalized,previous.version,product.version,safeActor]);
    await client.query("UPDATE public.product_stock_balances SET stock_authority=$1,version=version+1,updated_at=clock_timestamp(),updated_by=$2 WHERE product_id=$3", [input.tiny?"tiny_import":"erp",safeActor,product.id]);
    return product;
  }); } catch (error) { if (error?.code === "23505") fail("SKU já cadastrado.", "PRODUCT_SKU_CONFLICT", 409); throw error; }
}

export async function deactivateProduct(productId, expectedVersion, username) {
  const expected=Number(expectedVersion);
  if (!Number.isInteger(expected) || expected<1) fail("Versão inválida.");
  return transaction(async client=>{
    const result=(await client.query("UPDATE public.master_items SET status='inactive',version=version+1,updated_at=clock_timestamp(),updated_by=$3 WHERE id=$1 AND version=$2 RETURNING *",[id(productId),expected,actor(username)])).rows[0];
    if(!result) fail("Produto não encontrado ou alterado por outro usuário.","PRODUCT_VERSION_CONFLICT",409);
    return result;
  });
}

export async function setProductStatus(productId,status,expectedVersion,username){
  if(!['active','inactive'].includes(status))fail('Status inválido.');
  const expected=Number(expectedVersion);
  if(!Number.isInteger(expected)||expected<1)fail('Versão inválida.');
  return transaction(async client=>{
    const product=(await client.query("UPDATE public.master_items SET status=$1,version=version+1,updated_at=clock_timestamp(),updated_by=$2 WHERE id=$3 AND version=$4 RETURNING *",[status,actor(username),id(productId),expected])).rows[0];
    if(!product)fail('Produto não encontrado ou alterado por outro usuário.','PRODUCT_VERSION_CONFLICT',409);
    return product;
  });
}

// Call inside the same transaction as each future stock movement or production order.
export async function requireActiveProduct(client,productId){
  const product=(await client.query('SELECT id,status FROM public.master_items WHERE id=$1 FOR SHARE',[id(productId)])).rows[0];
  if(!product)fail('Produto não encontrado.','PRODUCT_NOT_FOUND',404);
  if(product.status!=='active')fail('Produto inativo: movimentações e ordens de produção não são permitidas.','PRODUCT_INACTIVE',409);
  return product;
}

export async function listSuppliers() { return withConnection(async client => (await client.query("SELECT * FROM public.product_suppliers ORDER BY legal_name")).rows); }
export async function saveSupplier(data, username, supplierId) {
  const values=[text(data?.legalName,"razão social",300),text(data?.tradeName,"nome fantasia",300,true),text(data?.taxId,"documento",80,true),text(data?.email,"e-mail",200,true),text(data?.phone,"telefone",80,true),text(data?.notes,"observações",2000,true),actor(username)];
  return withConnection(async client => supplierId
    ? (await client.query("UPDATE public.product_suppliers SET legal_name=$1,trade_name=$2,tax_id=$3,email=$4,phone=$5,notes=$6,version=version+1,updated_at=clock_timestamp(),updated_by=$7 WHERE id=$8 RETURNING *", [...values,id(supplierId)])).rows[0]
    : (await client.query("INSERT INTO public.product_suppliers(legal_name,trade_name,tax_id,email,phone,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *", values)).rows[0]);
}
export async function deleteSupplier(supplierId) { try { return await withConnection(async client => (await client.query("DELETE FROM public.product_suppliers WHERE id=$1 RETURNING id", [id(supplierId)])).rows[0] || fail("Fornecedor não encontrado.","SUPPLIER_NOT_FOUND",404)); } catch(error) { if(error?.code==="23503") fail("Fornecedor está vinculado a um produto.","SUPPLIER_IN_USE",409); throw error; } }

export async function listSteps() { return withConnection(async client => (await client.query("SELECT * FROM public.production_steps ORDER BY code_normalized")).rows); }
export async function saveStep(data, username, stepId) {
  const values=[text(data?.code,"código",80),text(data?.name,"nome",200),text(data?.description,"descrição",2000,true),actor(username)];
  try { return await withConnection(async client => stepId
    ? (await client.query("UPDATE public.production_steps SET code=$1,name=$2,description=$3,version=version+1,updated_at=clock_timestamp(),updated_by=$4 WHERE id=$5 RETURNING *", [...values,id(stepId)])).rows[0]
    : (await client.query("INSERT INTO public.production_steps(code,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING *", values)).rows[0]);
  } catch(error) { if(error?.code==="23505") fail("Código da etapa já existe.","STEP_CODE_CONFLICT",409); throw error; }
}
export async function deleteStep(stepId) { try { return await withConnection(async client => (await client.query("DELETE FROM public.production_steps WHERE id=$1 RETURNING id", [id(stepId)])).rows[0] || fail("Etapa não encontrada.","STEP_NOT_FOUND",404)); } catch(error) { if(error?.code==="23503") fail("Etapa está vinculada a um produto.","STEP_IN_USE",409); throw error; } }

export async function listStock({ query = "" } = {}) { const search=`%${String(query).trim()}%`; return withConnection(async client => (await client.query(`SELECT i.id,i.primary_sku,i.description,i.item_type,i.unit,i.tiny_import_enabled,s.physical_quantity,s.stock_authority,s.updated_at FROM public.master_items i LEFT JOIN public.product_stock_balances s ON s.product_id=i.id WHERE i.status='active' AND (i.primary_sku ILIKE $1 OR i.description ILIKE $1) ORDER BY i.primary_sku_normalized LIMIT 1000`,[search])).rows); }

export async function addBomLine(parentId, data, username) {
  const parent=id(parentId,"produto pai"),child=id(data?.childProductId,"componente");
  const quantity=Number(data?.quantity); if(!(quantity>0)) fail("Quantidade inválida.");
  const unit=text(data?.unit||"UN","unidade",32); const safeActor=actor(username);
  try { return await withConnection(async client => (await client.query(`INSERT INTO public.product_bom_lines(parent_product_id,child_product_id,quantity,unit,link_status,source_line_id,source_payload,created_by,updated_by) VALUES($1,$2,$3,$4,'active',$5,'{"source":"erp"}'::jsonb,$6,$6) RETURNING *`,[parent,child,quantity,unit,`erp:${randomUUID()}`,safeActor])).rows[0]); }
  catch(error){ if(error?.code==="23514") fail("Um produto não pode usar a si mesmo na BOM.","BOM_SELF_REFERENCE",409); throw error; }
}
export async function deleteBomLine(parentId,lineId){ return withConnection(async client=>(await client.query("DELETE FROM public.product_bom_lines WHERE id=$1 AND parent_product_id=$2 RETURNING id",[id(lineId,"linha da BOM"),id(parentId,"produto")])).rows[0]||fail("Linha da BOM não encontrada.","BOM_NOT_FOUND",404)); }

export async function addRoutingStep(productId, data, username) {
  const product=id(productId,"produto"),step=id(data?.productionStepId,"etapa");
  const sequence=Number(data?.sequence); if(!Number.isInteger(sequence)||sequence<1) fail("Sequência inválida.");
  const instructions=text(data?.instructions,"instruções",2000,true); const safeActor=actor(username);
  const setup=data?.setupMinutes==null||data.setupMinutes===""?null:Number(data.setupMinutes);
  const run=data?.runMinutes==null||data.runMinutes===""?null:Number(data.runMinutes);
  if((setup!==null&&(!Number.isFinite(setup)||setup<0))||(run!==null&&(!Number.isFinite(run)||run<0))) fail("Tempos da etapa inválidos.");
  try { return await withConnection(async client=>(await client.query(`INSERT INTO public.product_routing_steps(product_id,production_step_id,sequence,instructions,setup_minutes,run_minutes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,[product,step,sequence,instructions,setup,run,safeActor])).rows[0]); }
  catch(error){ if(error?.code==="23505") fail("Já existe uma etapa nesta sequência.","ROUTING_SEQUENCE_CONFLICT",409); if(error?.code==="23503") fail("Produto ou etapa não encontrado.","ROUTING_REFERENCE_NOT_FOUND",404); throw error; }
}

export async function deleteRoutingStep(productId, routingId, expectedVersion) {
  const expected=Number(expectedVersion); if(!Number.isInteger(expected)||expected<1) fail("Versão inválida.");
  return withConnection(async client=>(await client.query("DELETE FROM public.product_routing_steps WHERE id=$1 AND product_id=$2 AND version=$3 RETURNING id",[id(routingId,"vínculo da etapa"),id(productId,"produto"),expected])).rows[0]||fail("Etapa do produto não encontrada ou alterada por outro usuário.","ROUTING_VERSION_CONFLICT",409));
}
