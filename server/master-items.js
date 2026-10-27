import { createHash } from "node:crypto";

import { transaction, withConnection } from "./database.js";

const FAMILIES = new Set(["helices", "componentes", "buchas", "brutos"]);
const STATUSES = new Set(["active", "inactive"]);
const NAMESPACE = /^[a-z][a-z0-9_]{0,63}$/;
const OPERATION = {
  create: "master_item_create",
  update: "master_item_update",
  alias: "master_item_alias_create"
};

export class MasterItemError extends Error {
  constructor(message, code, status = 400, currentVersion) {
    super(message);
    this.code = code;
    this.status = status;
    this.currentVersion = currentVersion;
  }
}

function fail(message, code, status = 400, currentVersion) { throw new MasterItemError(message, code, status, currentVersion); }
function requiredText(value, field, max) {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > max) fail(`${field} invalido.`, "MASTER_ITEM_VALIDATION");
  return value;
}
function aliasCode(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) fail("originalCode invalido.", "MASTER_ITEM_VALIDATION");
  return value;
}
function optionalStatus(value) {
  const status = value === undefined ? "active" : requiredText(value, "status", 16);
  if (!STATUSES.has(status)) fail("status invalido.", "MASTER_ITEM_VALIDATION");
  return status;
}
function normalizedCode(value) { return value.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase()); }
function trustedActor(actor) { return requiredText(actor, "actor", 100); }
function eventKey(value) { return requiredText(value, "eventKey", 160); }
function expectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) fail("expectedVersion invalida.", "MASTER_ITEM_VALIDATION");
  return value;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalPayloadHash(payload) {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}
function normalizeCreate(data) {
  const primarySku = requiredText(data?.primarySku, "primarySku", 120);
  const family = requiredText(data?.family, "family", 32);
  if (!FAMILIES.has(family)) fail("family invalida.", "MASTER_ITEM_VALIDATION");
  return { primarySku, family, description: requiredText(data?.description, "description", 500), unit: requiredText(data?.unit, "unit", 32), status: optionalStatus(data?.status) };
}
function normalizeUpdate(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("Dados de atualizacao invalidos.", "MASTER_ITEM_VALIDATION");
  const allowed = ["primarySku", "family", "description", "unit", "status"];
  const supplied = Object.keys(data).filter((key) => data[key] !== undefined);
  if (!supplied.length || supplied.some((key) => !allowed.includes(key))) fail("Campos de atualizacao invalidos.", "MASTER_ITEM_VALIDATION");
  const result = {};
  if (data.primarySku !== undefined) result.primarySku = requiredText(data.primarySku, "primarySku", 120);
  if (data.family !== undefined) { result.family = requiredText(data.family, "family", 32); if (!FAMILIES.has(result.family)) fail("family invalida.", "MASTER_ITEM_VALIDATION"); }
  if (data.description !== undefined) result.description = requiredText(data.description, "description", 500);
  if (data.unit !== undefined) result.unit = requiredText(data.unit, "unit", 32);
  if (data.status !== undefined) result.status = optionalStatus(data.status);
  return result;
}
function normalizeAlias(data) {
  const namespace = requiredText(data?.namespace, "namespace", 64);
  if (!NAMESPACE.test(namespace)) fail("namespace invalido.", "MASTER_ITEM_VALIDATION");
  return { namespace, originalCode: aliasCode(data?.originalCode), status: optionalStatus(data?.status) };
}
function itemResult(row) { return row || null; }
async function audit(client, action, item, actor) {
  await client.query("INSERT INTO public.audit_log (state_key,action,version,actor,created_at) VALUES ($1,$2,$3,$4,clock_timestamp())", ["master_items", action, item.version, actor]);
}
async function lockEvent(client, operation, key) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${operation}:${key}`]);
}
async function recoverEvent(client, operation, key, hash, actor) {
  const event = (await client.query("SELECT payload_hash, resource_item_id, result, actor FROM public.master_item_idempotency_events WHERE operation=$1 AND event_key=$2", [operation, key])).rows[0];
  if (!event) return null;
  if (event.actor !== actor) fail("eventKey pertence a outro ator.", "MASTER_ITEM_EVENT_FORBIDDEN", 403);
  if (event.payload_hash !== hash) fail("eventKey reutilizada com payload divergente.", "MASTER_ITEM_EVENT_CONFLICT", 409);
  return event;
}
async function saveEvent(client, operation, key, hash, itemId, result, actor) {
  await client.query("INSERT INTO public.master_item_idempotency_events (operation,event_key,payload_hash,resource_item_id,result,actor) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [operation, key, hash, itemId, JSON.stringify(result), actor]);
}
async function findItemForUpdate(client, id) {
  const row = (await client.query("SELECT * FROM public.master_items WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!row) fail("Item Mestre nao encontrado.", "MASTER_ITEM_NOT_FOUND", 404);
  return row;
}
function translate(error) {
  if (error instanceof MasterItemError) throw error;
  if (error?.code === "23505" && /master_items_primary_sku_normalized_key/.test(error.constraint || "")) fail("SKU principal ja existe.", "MASTER_ITEM_SKU_CONFLICT", 409);
  if (error?.code === "23505" && /item_aliases_namespace_normalized_code_key/.test(error.constraint || "")) fail("Alias ja existe neste namespace.", "MASTER_ITEM_ALIAS_CONFLICT", 409);
  throw error;
}

export async function createMasterItem(data, { eventKey: key, actor } = {}) {
  const values = normalizeCreate(data); const safeActor = trustedActor(actor); const safeKey = eventKey(key);
  const hash = canonicalPayloadHash({ operation: OPERATION.create, ...values });
  try { return await transaction(async (client) => {
    await lockEvent(client, OPERATION.create, safeKey);
    const existing = await recoverEvent(client, OPERATION.create, safeKey, hash, safeActor);
    if (existing) return { item: itemResult((await client.query("SELECT * FROM public.master_items WHERE id=$1", [existing.resource_item_id])).rows[0]), idempotent: true };
    const item = (await client.query("INSERT INTO public.master_items (primary_sku,family,description,unit,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *", [values.primarySku,values.family,values.description,values.unit,values.status,safeActor])).rows[0];
    await saveEvent(client, OPERATION.create, safeKey, hash, item.id, { itemId: item.id }, safeActor);
    await audit(client, "CREATE", item, safeActor);
    return { item: itemResult(item), idempotent: false };
  }); } catch (error) { translate(error); }
}

export async function updateMasterItem(id, data, { expectedVersion: version, eventKey: key, actor } = {}) {
  const values = normalizeUpdate(data); const safeActor = trustedActor(actor); const safeKey = eventKey(key); const safeVersion = expectedVersion(version);
  const hash = canonicalPayloadHash({ operation: OPERATION.update, id, expectedVersion: safeVersion, ...values });
  try { return await transaction(async (client) => {
    await lockEvent(client, OPERATION.update, safeKey);
    const existing = await recoverEvent(client, OPERATION.update, safeKey, hash, safeActor);
    if (existing) return { item: itemResult((await client.query("SELECT * FROM public.master_items WHERE id=$1", [existing.resource_item_id])).rows[0]), idempotent: true };
    const previous = await findItemForUpdate(client, id);
    if (previous.version !== safeVersion) fail("Versao do Item Mestre esta desatualizada.", "MASTER_ITEM_VERSION_CONFLICT", 409, previous.version);
    const next = { primarySku: values.primarySku ?? previous.primary_sku, family: values.family ?? previous.family, description: values.description ?? previous.description, unit: values.unit ?? previous.unit, status: values.status ?? previous.status };
    const item = (await client.query("UPDATE public.master_items SET primary_sku=$1,family=$2,description=$3,unit=$4,status=$5,version=version+1,updated_at=clock_timestamp(),updated_by=$6 WHERE id=$7 AND version=$8 RETURNING *", [next.primarySku,next.family,next.description,next.unit,next.status,safeActor,id,safeVersion])).rows[0];
    if (!item) fail("Versao do Item Mestre esta desatualizada.", "MASTER_ITEM_VERSION_CONFLICT", 409, previous.version);
    if (item.primary_sku !== previous.primary_sku) await client.query("INSERT INTO public.master_item_sku_history (item_id,old_primary_sku,old_primary_sku_normalized,new_primary_sku,new_primary_sku_normalized,old_version,new_version,actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id,previous.primary_sku,previous.primary_sku_normalized,item.primary_sku,item.primary_sku_normalized,previous.version,item.version,safeActor]);
    await saveEvent(client, OPERATION.update, safeKey, hash, item.id, { itemId: item.id }, safeActor);
    await audit(client, "UPDATE", item, safeActor);
    return { item: itemResult(item), idempotent: false };
  }); } catch (error) { translate(error); }
}

export async function addMasterItemAlias(itemId, data, { eventKey: key, actor } = {}) {
  const values = normalizeAlias(data); const safeActor = trustedActor(actor); const safeKey = eventKey(key);
  const hash = canonicalPayloadHash({ operation: OPERATION.alias, itemId, ...values });
  try { return await transaction(async (client) => {
    await lockEvent(client, OPERATION.alias, safeKey);
    const existing = await recoverEvent(client, OPERATION.alias, safeKey, hash, safeActor);
    if (existing) return { alias: (await client.query("SELECT * FROM public.item_aliases WHERE id=$1", [existing.result.aliasId])).rows[0] || null, idempotent: true };
    const item = await findItemForUpdate(client, itemId);
    const alias = (await client.query("INSERT INTO public.item_aliases (item_id,namespace,original_code,status,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *", [item.id,values.namespace,values.originalCode,values.status,safeActor])).rows[0];
    await saveEvent(client, OPERATION.alias, safeKey, hash, item.id, { aliasId: alias.id, itemId: item.id }, safeActor);
    await audit(client, "UPDATE", item, safeActor);
    return { alias, idempotent: false };
  }); } catch (error) { translate(error); }
}

export async function getMasterItem(id) { return withConnection(async (client) => itemResult((await client.query("SELECT * FROM public.master_items WHERE id=$1", [id])).rows[0])); }
export async function listMasterItems({ query = "", family, status, page = 1, limit = 50 } = {}) {
  const currentPage = Number.isInteger(page) && page > 0 ? page : 1; const pageSize = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 50;
  if (family !== undefined && !FAMILIES.has(family)) fail("family invalida.", "MASTER_ITEM_VALIDATION"); if (status !== undefined && !STATUSES.has(status)) fail("status invalido.", "MASTER_ITEM_VALIDATION");
  const clauses = []; const values = [];
  if (family) { values.push(family); clauses.push(`family=$${values.length}`); }
  if (status) { values.push(status); clauses.push(`status=$${values.length}`); }
  if (query) { values.push(`%${String(query).trim()}%`); clauses.push(`(primary_sku ILIKE $${values.length} OR description ILIKE $${values.length})`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return withConnection(async (client) => { const total = Number((await client.query(`SELECT count(*)::int AS total FROM public.master_items ${where}`, values)).rows[0].total); values.push(pageSize, (currentPage - 1) * pageSize); const items = (await client.query(`SELECT * FROM public.master_items ${where} ORDER BY primary_sku_normalized,id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows; return { items, page: currentPage, limit: pageSize, total }; });
}
export async function listMasterItemAliases(itemId) { return withConnection(async (client) => (await client.query("SELECT * FROM public.item_aliases WHERE item_id=$1 ORDER BY namespace,normalized_code,id", [itemId])).rows); }
export async function resolveMasterItemCode(namespace, code) {
  const safeNamespace = requiredText(namespace, "namespace", 64); const safeCode = requiredText(code, "code", 120);
  return withConnection(async (client) => (await client.query("SELECT i.*, a.id AS alias_id, a.namespace, a.original_code AS alias_original_code, a.normalized_code AS alias_normalized_code, a.status AS alias_status FROM public.item_aliases a JOIN public.master_items i ON i.id=a.item_id WHERE a.namespace=$1 AND a.normalized_code=public.master_identifier_normalize($2)", [safeNamespace,safeCode])).rows[0] || null);
}
