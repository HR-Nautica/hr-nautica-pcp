import { createHash } from "node:crypto";
import XLSX from "xlsx";

import { transaction, withConnection } from "./database.js";

const OPERATIONS = [
  { column: "op_01_compras", sequence: 1, code: "CO - OP 01" },
  { column: "op_02_usinagem", sequence: 2, code: "CO - OP 02" },
  { column: "op_05_montagem", sequence: 5, code: "CO - OP 05" }
];

export class ComponentRoutingImportError extends Error {
  constructor(message, code = "COMPONENT_ROUTING_IMPORT_INVALID", status = 400, details = []) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).replace(/[a-z]/g, letter => letter.toUpperCase());
const key = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const activeValue = value => {
  const normalized = clean(value).toLocaleLowerCase("pt-BR");
  return normalized && !["-", "—", "–", "n/a", "na", "não", "nao"].includes(normalized);
};

export function parseComponentRoutingWorkbook(buffer) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: "buffer" }); }
  catch { throw new ComponentRoutingImportError("Arquivo Excel inválido ou corrompido."); }

  const sheet = workbook.Sheets["BOM Componentes"];
  if (!sheet) throw new ComponentRoutingImportError("Aba obrigatória ausente: BOM Componentes.");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerIndex = rows.findIndex(row => key(row?.[0]) === "posicao" && key(row?.[1]) === "sku");
  if (headerIndex < 0) throw new ComponentRoutingImportError("Cabeçalho de posição e SKU não encontrado na aba BOM Componentes.");

  const headers = rows[headerIndex].map(key);
  const headerSet = new Set(headers);
  const missingColumns = ["op_01_compras", "op_02_usinagem", "op_05_montagem"].filter(column => !headerSet.has(column));
  if (missingColumns.length) throw new ComponentRoutingImportError("A planilha não contém todas as colunas de operações CO esperadas.", "COMPONENT_ROUTING_COLUMNS_MISSING", 422, missingColumns);

  const items = new Map();
  const issues = [];
  let sourceRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const values = rows[index];
    if (!values?.some(value => value !== null && clean(value))) continue;
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const sku = clean(row.sku);
    const position = clean(row.posicao);
    sourceRows += 1;
    if (!sku || !/^\d{2}$/.test(position)) {
      issues.push({ row: index + 1, code: "INVALID_COMPONENT_ROW", sku, position });
      continue;
    }

    const normalizedSku = normalize(sku);
    const item = items.get(normalizedSku) || { sku, normalizedSku, rows: [] };
    if (item.sku !== sku) issues.push({ row: index + 1, code: "SKU_CASE_VARIANT", sku, canonicalSku: item.sku });
    const operations = OPERATIONS.flatMap(operation => {
      const responsible = clean(row[operation.column]);
      return activeValue(responsible) ? [{ sequence: operation.sequence, code: operation.code, responsible }] : [];
    });
    item.rows.push({ position, familyKey: clean(row.chave_familia), lineKey: clean(row.chave_linha), description: clean(row.descricao), operations });
    items.set(normalizedSku, item);
  }

  if (!sourceRows) throw new ComponentRoutingImportError("A aba BOM Componentes não possui linhas de produto.");
  if (issues.length) throw new ComponentRoutingImportError("A planilha contém linhas com identidade inválida.", "COMPONENT_ROUTING_VALIDATION", 422, issues);

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const parsedItems = [...items.values()].map(item => {
    const signatures = new Set(item.rows.map(row => row.operations.map(operation => operation.sequence).join(",")));
    const assignments = new Map();
    for (const row of item.rows) for (const operation of row.operations) {
      const current = assignments.get(operation.sequence) || { ...operation, responsibles: new Set() };
      current.responsibles.add(operation.responsible);
      assignments.set(operation.sequence, current);
    }
    return {
      sku: item.sku,
      normalizedSku: item.normalizedSku,
      rows: item.rows,
      conflictingRoute: signatures.size > 1,
      operations: [...assignments.values()].map(operation => ({ ...operation, responsibles: [...operation.responsibles].sort() })).sort((a, b) => a.sequence - b.sequence)
    };
  });

  return {
    checksum,
    sourceRows,
    items: parsedItems,
    summary: {
      sourceRows,
      uniqueSkus: parsedItems.length,
      conflictingSkus: parsedItems.filter(item => item.conflictingRoute).length,
      operationColumns: OPERATIONS.map(({ code }) => code)
    }
  };
}

function stepNumber(code) {
  const match = /^CO\s*-\s*OP\s*0*(\d+)$/i.exec(clean(code));
  return match ? Number(match[1]) : null;
}

export function planComponentRoutings(parsed, products, steps, existingRoutes) {
  const blocking = [];
  const warnings = [];
  const plan = [];
  const stepBySequence = new Map();
  const neededSequences = new Set(OPERATIONS.map(operation => operation.sequence));
  for (const step of steps) {
    const sequence = stepNumber(step.code);
    if (sequence === null || !neededSequences.has(sequence)) continue;
    if (step.status !== "active") {
      blocking.push({ code: "COMPONENT_STEP_INACTIVE", stepCode: step.code });
      continue;
    }
    if (stepBySequence.has(sequence)) blocking.push({ code: "DUPLICATE_COMPONENT_STEP", sequence, stepCode: step.code });
    stepBySequence.set(sequence, step);
  }

  const productBySku = new Map();
  for (const product of products) {
    const sku = normalize(product.primary_sku_normalized || product.primary_sku);
    const candidates = productBySku.get(sku) || [];
    candidates.push(product);
    productBySku.set(sku, candidates);
  }
  const routesByProduct = new Map();
  for (const route of existingRoutes) {
    const rows = routesByProduct.get(route.product_id) || [];
    rows.push(route);
    routesByProduct.set(route.product_id, rows);
  }

  let matchedProducts = 0;
  let alreadyLinked = 0;
  for (const item of parsed.items) {
    if (item.conflictingRoute) {
      warnings.push({ code: "SKU_ROUTE_CONFLICT", sku: item.sku, rows: item.rows.map(row => ({ position: row.position, familyKey: row.familyKey, operations: row.operations.map(operation => operation.code) })) });
      continue;
    }
    const matches = productBySku.get(item.normalizedSku) || [];
    if (matches.length !== 1) {
      blocking.push({ code: matches.length ? "AMBIGUOUS_PRODUCT_SKU" : "PRODUCT_NOT_FOUND", sku: item.sku, matches: matches.length });
      continue;
    }
    const product = matches[0];
    if (product.family !== "componentes") {
      blocking.push({ code: "PRODUCT_FAMILY_MISMATCH", sku: item.sku, family: product.family });
      continue;
    }
    matchedProducts += 1;
    const existing = routesByProduct.get(product.id) || [];
    const missingOperations = item.operations.filter(operation => !existing.some(route => route.production_step_id === stepBySequence.get(operation.sequence)?.id));
    const conflicts = missingOperations.filter(operation => existing.some(route => Number(route.sequence) === operation.sequence));
    if (conflicts.length) {
      blocking.push({ code: "ROUTING_SEQUENCE_CONFLICT", sku: item.sku, sequences: conflicts.map(operation => operation.sequence) });
      continue;
    }
    const available = missingOperations.map(operation => {
      const step = stepBySequence.get(operation.sequence);
      if (!step) {
        blocking.push({ code: "COMPONENT_STEP_NOT_FOUND", sku: item.sku, stepCode: operation.code });
        return null;
      }
      const responsibles = operation.responsibles;
      return {
        productId: product.id,
        sku: item.sku,
        stepId: step.id,
        stepCode: step.code,
        sequence: operation.sequence,
        instructions: responsibles.length ? `Responsável indicado na planilha: ${responsibles.join(", ")}` : null
      };
    }).filter(Boolean);
    const existingCount = item.operations.length - available.length;
    alreadyLinked += existingCount;
    plan.push(...available);
  }

  return {
    canImport: blocking.length === 0,
    plan,
    issues: blocking,
    warnings,
    summary: {
      ...parsed.summary,
      matchedProducts,
      plannedProducts: new Set(plan.map(item => item.productId)).size,
      routingsToAdd: plan.length,
      alreadyLinked,
      missingProducts: blocking.filter(issue => issue.code === "PRODUCT_NOT_FOUND").length,
      sequenceConflicts: blocking.filter(issue => issue.code === "ROUTING_SEQUENCE_CONFLICT").length,
      missingSteps: blocking.filter(issue => issue.code === "COMPONENT_STEP_NOT_FOUND").length,
      warnings: warnings.length
    }
  };
}

async function inspect(client, parsed) {
  const products = await client.query("SELECT id,primary_sku,primary_sku_normalized,family,item_type FROM public.master_items");
  const steps = await client.query("SELECT id,code,status FROM public.production_steps WHERE code ILIKE 'CO%'");
  const routes = await client.query("SELECT product_id,production_step_id,sequence,status FROM public.product_routing_steps");
  return planComponentRoutings(parsed, products.rows, steps.rows, routes.rows);
}

export async function preflightComponentRoutingWorkbook(buffer) {
  const parsed = parseComponentRoutingWorkbook(buffer);
  return withConnection(async client => ({ checksum: parsed.checksum, ...await inspect(client, parsed) }));
}

export async function importComponentRoutingWorkbook(buffer, { sourceName, expectedChecksum, actor }) {
  const parsed = parseComponentRoutingWorkbook(buffer);
  if (expectedChecksum !== parsed.checksum) throw new ComponentRoutingImportError("O arquivo mudou após a pré-validação.", "COMPONENT_ROUTING_CHECKSUM_CONFLICT", 409);
  if (!clean(sourceName) || clean(sourceName).length > 300 || !clean(actor) || clean(actor).length > 100) throw new ComponentRoutingImportError("Nome da planilha ou usuário inválido.");

  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`component_routing_import:${parsed.checksum}`]);
    await client.query("LOCK TABLE public.master_items,public.production_steps,public.product_routing_steps IN SHARE ROW EXCLUSIVE MODE");
    const preflight = await inspect(client, parsed);
    if (!preflight.canImport) throw new ComponentRoutingImportError("Pré-validação encontrou produtos, etapas ou sequências que precisam de revisão. Nenhuma etapa foi gravada.", "COMPONENT_ROUTING_CONFLICT", 409, preflight.issues);

    let created = 0;
    for (const item of preflight.plan) {
      await client.query(`INSERT INTO public.product_routing_steps
        (product_id,production_step_id,sequence,instructions,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$5)`, [item.productId,item.stepId,item.sequence,item.instructions,clean(actor)]);
      created += 1;
    }
    return {
      idempotent: created === 0,
      sourceName: clean(sourceName),
      checksum: parsed.checksum,
      summary: { ...preflight.summary, createdRoutings: created },
      warnings: preflight.warnings
    };
  });
}
