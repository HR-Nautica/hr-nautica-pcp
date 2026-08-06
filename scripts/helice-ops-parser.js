import path from "node:path";
import fs from "node:fs";
import XLSX from "xlsx";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function quantity(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Math.max(0, Math.trunc(value));
  const parsed = Number.parseFloat(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeOperationName(value, index) {
  const normalized = text(value).replace(/\s+/g, " ");
  return normalized || `${index + 1} - Operação`;
}

export function parseHeliceProductionWorkbook(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true });
  const sourceSheet = workbook.SheetNames.find(name => /prod.*comp.*helice/i.test(name)) || workbook.SheetNames[0];
  if (!sourceSheet) throw new Error("A planilha não possui abas.");

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheet], {
    header: 1,
    defval: null,
    raw: true
  });
  const headerIndex = matrix.findIndex(row => text(row?.[3]).toLowerCase().includes("sku"));
  if (headerIndex < 0) throw new Error("Cabeçalho com SKU na coluna D não encontrado.");

  const operationNames = Array.from({ length: 9 }, (_, index) => normalizeOperationName(matrix[headerIndex]?.[5 + index], index));
  const sourceFile = path.basename(filePath);
  const orders = [];

  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex] || [];
    const sku = text(row[3]);
    const description = text(row[1]);
    if (!sku || !description) continue;

    const operations = operationNames.map((name, index) => ({
      code: String(index + 1).padStart(2, "0"),
      name,
      quantity: quantity(row[5 + index])
    }));
    const location = text(row[15]).replace(/\s+/g, " ");
    const locationOperation = Number.parseInt(location.match(/^(\d+)/)?.[1] || "", 10);
    const lastFilledIndex = operations.reduce((last, operation, index) => operation.quantity !== null ? index : last, -1);
    const currentIndex = Number.isInteger(locationOperation) && locationOperation >= 1 && locationOperation <= 9
      ? locationOperation - 1
      : Math.max(0, lastFilledIndex);
    const finalQuantity = operations[8]?.quantity;
    const finishedAt = isoDate(row[14]);
    const status = currentIndex === 8 || (finalQuantity !== null && finalQuantity > 0) || Boolean(finishedAt)
      ? "finalizada"
      : "em_producao";
    const trackedQuantity = quantity(row[17]);
    const operationMaximum = Math.max(0, ...operations.map(operation => operation.quantity || 0));

    orders.push({
      sourceKey: `${sourceFile}|${sourceSheet}|${rowIndex + 1}`,
      sourceFile,
      sourceSheet,
      sourceRow: rowIndex + 1,
      entryDate: isoDate(row[0]),
      description,
      priority: text(row[2]),
      sku,
      rawCode: text(row[4]),
      operations,
      currentOperation: String(currentIndex + 1).padStart(2, "0"),
      currentOperationName: operations[currentIndex]?.name || location,
      quantity: trackedQuantity ?? operationMaximum,
      spreadsheetLocation: location,
      elapsedTime: text(row[16]),
      status,
      finishedAt
    });
  }

  if (!orders.length) throw new Error("Nenhuma OP reconhecível foi encontrada na planilha.");
  return { sourceFile, sourceSheet, operationNames, orders };
}
