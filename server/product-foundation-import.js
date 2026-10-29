import { createHash } from "node:crypto";
import XLSX from "xlsx";

import { transaction, withConnection } from "./database.js";
import { normalizeMasterSku, classifyImport } from './product-import-preflight.js';

const SOURCE_SCHEMA = "normalized_bom_v1";
const FAMILY_BY_TYPE = new Map([
  ["produto acabado / componente", "componentes"],
  ["componente", "componentes"],
  ["hélice usinada", "helices"],
  ["helice usinada", "helices"],
  ["hélice bruta", "brutos"],
  ["helice bruta", "brutos"],
  ["bucha", "buchas"],
  ["caixa", "componentes"]
]);

export class ProductImportError extends Error {
  constructor(message, code = "PRODUCT_IMPORT_INVALID", status = 400, details = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const clean = value => String(value ?? "").trim();
const key = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const normalizeSku = normalizeMasterSku;
const asObject = (headers, row) => Object.fromEntries(headers.map((header, index) => [key(header), row[index]]));

function rowsFromSheet(workbook, sheetName, firstHeader) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new ProductImportError(`Aba obrigatoria ausente: ${sheetName}.`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerIndex = rows.findIndex(row => key(row?.[0]) === key(firstHeader));
  if (headerIndex < 0) throw new ProductImportError(`Cabecalho nao encontrado na aba ${sheetName}.`);
  const headers = rows[headerIndex].map(key);
  return rows.slice(headerIndex + 1).filter(row => row.some(value => value !== null && clean(value) !== "")).map(row => asObject(headers, row));
}

function normalizedStatus(value) {
  const status = key(value);
  if (status === "ok") return "active";
  if (status === "pendente") return "pending";
  if (status === "revisar") return "review";
  return null;
}

function numericQuantity(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function parseNormalizedProductWorkbook(buffer) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: "buffer", cellDates: true }); }
  catch { throw new ProductImportError("Arquivo Excel invalido ou corrompido."); }

  const rawItems = rowsFromSheet(workbook, "Cadastro Unificado", "ID_Item_Sistema");
  const rawBom = rowsFromSheet(workbook, "BOM Unificada", "ID_Linha_BOM");
  const rawAudit = rowsFromSheet(workbook, "Auditoria", "Nº");
  const issues = [];
  const auditIssues = rawAudit.map((row, index) => ({
    sheet: "Auditoria",
    row: index + 1,
    code: key(row.classificacao) === "pendente" ? "SOURCE_PENDING" : "SOURCE_REVIEW",
    detail: clean(row.detalhe) || "Pendência registrada na auditoria da planilha.",
    sourcePayload: {
      classification: clean(row.classificacao),
      type: clean(row.tipo),
      reference: clean(row.referencia),
      parentSourceId: clean(row.id_pai),
      childSourceId: clean(row.id_filho)
    }
  }));
  const reviewIssues = [...auditIssues];
  const auditedReferences = new Set(auditIssues.map(issue => issue.sourcePayload.reference).filter(Boolean));
  const sourceIds = new Set();
  const skus = new Set();

  const items = rawItems.map((row, index) => {
    const sourceId = clean(row.id_item_sistema);
    const sku = clean(row.sku);
    const description = clean(row.descricao);
    const itemType = clean(row.tipo_item);
    const family = FAMILY_BY_TYPE.get(itemType.toLocaleLowerCase("pt-BR"));
    const unit=clean(row.unidade||row.unidade_medida);
    const statusMap={ativo:'active',inativo:'inactive',active:'active',inactive:'inactive'};
    const status=statusMap[key(row.status_cadastro)];
    if(!unit||unit.length>32||/[\x00-\x1f]/.test(unit))issues.push({sheet:'Cadastro Unificado',row:index+1,code:'INVALID_OR_MISSING_UNIT',sku});
    if(!status)issues.push({sheet:'Cadastro Unificado',row:index+1,code:'INVALID_STATUS',sku});
    const rowNumber = index + 1;
    if (!sourceId || !sku || !description || !family) issues.push({ sheet: "Cadastro Unificado", row: rowNumber, code: "INVALID_ITEM", sourceId, sku });
    if (sourceIds.has(sourceId)) issues.push({ sheet: "Cadastro Unificado", row: rowNumber, code: "DUPLICATE_SOURCE_ID", sourceId });
    if (skus.has(normalizeSku(sku))) issues.push({ sheet: "Cadastro Unificado", row: rowNumber, code: "DUPLICATE_SKU", sku });
    sourceIds.add(sourceId);
    skus.add(normalizeSku(sku));
    return {
      sourceId,
      sku,
      description,
      family,
      itemType,
      unit,
      status,
      aliasNamespace:clean(row.namespace_alias)||null,
      tinyImportEnabled: false,
      basicCharacteristics: {},
      sourceMetadata: {
        sourceSchema: SOURCE_SCHEMA,
        sourceId,
        sourceOrigin: clean(row.fonte_origem),
        sourceOriginIds: clean(row.ids_origem)
      }
    };
  });

  const bomLines = rawBom.map((row, index) => {
    const sourceLineId = clean(row.id_linha_bom);
    const parentSourceId = clean(row.id_pai);
    const childSourceId = clean(row.id_filho);
    const linkStatus = normalizedStatus(row.status_vinculo);
    const quantity = numericQuantity(row.quantidade);
    const rowNumber = index + 1;
    const unresolvedOptionalChild = Boolean(sourceLineId && sourceIds.has(parentSourceId) && !childSourceId && linkStatus && linkStatus !== "active");
    if (unresolvedOptionalChild) {
      if (!auditedReferences.has(sourceLineId)) reviewIssues.push({ sheet: "BOM Unificada", row: rowNumber, code: "UNRESOLVED_BOM_CHILD", detail: `Linha ${sourceLineId} preservada para revisao: item filho ausente.`, sourcePayload: row });
      return null;
    }
    if (!sourceLineId || !sourceIds.has(parentSourceId) || !sourceIds.has(childSourceId) || !linkStatus) {
      issues.push({ sheet: "BOM Unificada", row: rowNumber, code: "INVALID_BOM_IDENTITY", sourceLineId, parentSourceId, childSourceId });
    }
    if (linkStatus === "active" && !(quantity > 0)) issues.push({ sheet: "BOM Unificada", row: rowNumber, code: "INVALID_ACTIVE_QUANTITY", sourceLineId, value: row.quantidade });
    if (parentSourceId && parentSourceId === childSourceId) issues.push({ sheet: "BOM Unificada", row: rowNumber, code: "SELF_REFERENCE", sourceLineId });
    return {
      sourceLineId,
      parentSourceId,
      childSourceId,
      quantity,
      sourceQuantity: row.quantidade_origem,
      unit: clean(row.unidade) || null,
      levelCode: clean(row.nivel) || null,
      linkStatus,
      sourcePayload: {
        sourceSchema: SOURCE_SCHEMA,
        bomOrigin: clean(row.origem_bom),
        familyKey: clean(row.chave_familia),
        originLineKey: clean(row.chave_linha_origem),
        observation: clean(row.observacao),
        purchaseOperation: clean(row.op_compras),
        machiningOperation: clean(row.op_usinagem),
        assemblyOperation: clean(row.op_montagem),
        sourceQuantity: row.quantidade_origem
      }
    };
  }).filter(Boolean);

  if (issues.length) throw new ProductImportError("A planilha possui erros estruturais que impedem a carga.", "PRODUCT_IMPORT_VALIDATION", 422, issues);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  return {
    sourceSchema: SOURCE_SCHEMA,
    checksum,
    items,
    bomLines,
    reviewIssues,
    summary: {
      items: items.length,
      sourceBomLines: rawBom.length,
      bomLines: bomLines.length,
      activeBomLines: bomLines.filter(line => line.linkStatus === "active").length,
      pendingBomLines: bomLines.filter(line => line.linkStatus !== "active").length,
      reviewIssues: reviewIssues.length
    }
  };
}

export async function importNormalizedProductWorkbook(buffer, { sourceName, actor, expectedChecksum }) {
  const parsed = parseNormalizedProductWorkbook(buffer);
  if(expectedChecksum!==undefined&&expectedChecksum!==parsed.checksum)throw new ProductImportError('Arquivo diferente da pré-validação.','PRODUCT_IMPORT_CHECKSUM_CONFLICT',409);
  const safeName = clean(sourceName);
  const safeActor = clean(actor);
  if (!safeName || safeName.length > 300 || !safeActor || safeActor.length > 100) throw new ProductImportError("Nome da fonte ou usuario invalido.");

  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`product_catalog_import:${parsed.checksum}`]);
    const prior = (await client.query("SELECT * FROM public.product_catalog_imports WHERE checksum=$1", [parsed.checksum])).rows[0];
    if (prior) return { import: prior, summary: prior.result, idempotent: true };
    await client.query('LOCK TABLE public.master_items, public.item_aliases, public.product_bom_lines IN SHARE ROW EXCLUSIVE MODE');
    const preflight=await inspectImport(client,parsed);
    if(!preflight.canImport)throw new ProductImportError('Conflitos exigem revisão antes da importação.','PRODUCT_IMPORT_CONFLICT',409,preflight.issues);

    const itemIds = new Map();
    let createdItems = 0;
    for (const item of parsed.items) {
      const match=preflight.classifications.find(row=>row.sourceId===item.sourceId);
      if(match.productId){itemIds.set(item.sourceId,match.productId);continue;}
      let stored = (await client.query(
        `INSERT INTO public.master_items
          (primary_sku,family,description,unit,status,item_type,basic_characteristics,tiny_import_enabled,source_metadata,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$10)
         ON CONFLICT (primary_sku_normalized) DO NOTHING RETURNING id`,
        [item.sku,item.family,item.description,item.unit,item.status,item.itemType,JSON.stringify(item.basicCharacteristics),item.tinyImportEnabled,JSON.stringify(item.sourceMetadata),safeActor]
      )).rows[0];
      if (stored) createdItems += 1;
      else stored = (await client.query("SELECT id FROM public.master_items WHERE primary_sku_normalized=public.master_identifier_normalize($1)", [item.sku])).rows[0];
      if (!stored) throw new ProductImportError(`Falha ao reconciliar SKU ${item.sku}.`, "PRODUCT_IMPORT_CONFLICT", 409);
      itemIds.set(item.sourceId, stored.id);
      await client.query(
        "INSERT INTO public.product_stock_balances (product_id,stock_authority,updated_by) VALUES ($1,$2,$3) ON CONFLICT (product_id) DO NOTHING",
        [stored.id, item.tinyImportEnabled ? "tiny_import" : "erp", safeActor]
      );
    }

    let createdBomLines = 0;
    for (const line of parsed.bomLines) {
      const inserted = await client.query(
        `INSERT INTO public.product_bom_lines
          (parent_product_id,child_product_id,quantity,unit,level_code,link_status,source_line_id,source_payload,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)
         ON CONFLICT (source_line_id) DO NOTHING RETURNING id`,
        [itemIds.get(line.parentSourceId),itemIds.get(line.childSourceId),line.quantity,line.unit,line.levelCode,line.linkStatus,line.sourceLineId,JSON.stringify(line.sourcePayload),safeActor]
      );
      if (inserted.rowCount) createdBomLines += 1;
    }

    const result = { ...parsed.summary, createdItems, reusedItems: parsed.items.length - createdItems, createdBomLines, reusedBomLines: parsed.bomLines.length - createdBomLines };
    const imported = (await client.query(
      `INSERT INTO public.product_catalog_imports
        (checksum,source_name,source_schema,status,item_count,bom_line_count,active_bom_line_count,pending_bom_line_count,imported_by,result)
       VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,$9::jsonb) RETURNING *`,
      [parsed.checksum,safeName,parsed.sourceSchema,parsed.summary.items,parsed.summary.sourceBomLines,parsed.summary.activeBomLines,parsed.summary.pendingBomLines + parsed.summary.reviewIssues,safeActor,JSON.stringify(result)]
    )).rows[0];
    for (const issue of parsed.reviewIssues) {
      await client.query(
        `INSERT INTO public.product_catalog_import_issues
          (import_id,source_sheet,source_row,issue_code,detail,source_payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [imported.id,issue.sheet,issue.row,issue.code,issue.detail,JSON.stringify(issue.sourcePayload)]
      );
    }
    return { import: imported, summary: result, idempotent: false };
  });
}

async function inspectImport(client,parsed){
  const products=(await client.query('SELECT id,primary_sku,primary_sku_normalized,description,unit,family,item_type,status FROM public.master_items')).rows;
  const aliases=(await client.query('SELECT item_id,namespace,normalized_code,status FROM public.item_aliases')).rows;
  const bom=(await client.query('SELECT parent_product_id,child_product_id,quantity,unit,link_status,source_line_id FROM public.product_bom_lines')).rows;
  return classifyImport(parsed,products,aliases,bom);
}
export async function preflightNormalizedProductWorkbook(buffer){const parsed=parseNormalizedProductWorkbook(buffer);return withConnection(async client=>({checksum:parsed.checksum,summary:parsed.summary,reviewIssues:parsed.reviewIssues,...await inspectImport(client,parsed)}));}
