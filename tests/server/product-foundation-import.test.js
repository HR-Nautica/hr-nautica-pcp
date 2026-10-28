import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";

import { parseNormalizedProductWorkbook, ProductImportError } from "../../server/product-foundation-import.js";

function workbook({ duplicateSku = false } = {}) {
  const wb = XLSX.utils.book_new();
  const items = [
    ["Cadastro de Itens Unificado"],
    [],
    ["ID_Item_Sistema","SKU","Descrição","Tipo_Item","Fonte_Origem","IDs_Origem","Status_Cadastro"],
    ["SKU:PAI","PAI","Produto pai","Produto acabado / componente","BOM Componentes","L1","ATIVO"],
    ["SKU:FILHO",duplicateSku ? "PAI" : "FILHO","Componente filho","Componente","BOM Componentes","L2","ATIVO"]
  ];
  const bom = [
    ["BOM Unificada"],
    [],
    ["ID_Linha_BOM","ID_Pai","ID_Filho","Quantidade","Quantidade_Origem","Unidade","Nível","Origem_BOM","Chave_Familia","Chave_Linha_Origem","Status_Vínculo","Observação","OP_Compras","OP_Usinagem","OP_Montagem"],
    ["BOM:1","SKU:PAI","SKU:FILHO",2,2,"UN","01","Componentes","F1","L1","OK",null,"Alberto","-","-"],
    ["BOM:2","SKU:PAI",null,null,"N/A","UN","01","Hélices","F1","L2","PENDENTE","Caixa ausente",null,null,null]
  ];
  const audit = [
    ["Auditoria de Carga"],
    [],
    ["Nº","Classificação","Tipo","Referência","Detalhe","ID_Pai","ID_Filho"],
    [1,"PENDENTE","BOM","BOM:2","Filho ainda não identificado","SKU:PAI",null]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(items), "Cadastro Unificado");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bom), "BOM Unificada");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(audit), "Auditoria");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

test("normaliza cadastro, BOM ativa e pendencia sem inventar item", () => {
  const result = parseNormalizedProductWorkbook(workbook());
  assert.deepEqual(result.summary, {
    items: 2,
    sourceBomLines: 2,
    bomLines: 1,
    activeBomLines: 1,
    pendingBomLines: 0,
    reviewIssues: 1
  });
  assert.equal(result.items[0].tinyImportEnabled, false);
  assert.equal(result.items[0].family, "componentes");
  assert.equal(result.bomLines[0].quantity, 2);
  assert.equal(result.reviewIssues[0].code, "SOURCE_PENDING");
});

test("rejeita SKU duplicado antes de qualquer gravacao", () => {
  assert.throws(
    () => parseNormalizedProductWorkbook(workbook({ duplicateSku: true })),
    error => error instanceof ProductImportError && error.status === 422 && error.details.some(issue => issue.code === "DUPLICATE_SKU")
  );
});
