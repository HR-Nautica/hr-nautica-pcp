import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";

import { parseNormalizedProductWorkbook, ProductImportError } from "../../server/product-foundation-import.js";

function workbook({ duplicateSku = false, nested = false } = {}) {
  const wb = XLSX.utils.book_new();
  const items = [
    ["Cadastro de Itens Unificado"],
    [],
    ["ID_Item_Sistema","SKU","Descrição","Tipo_Item","Fonte_Origem","IDs_Origem","Status_Cadastro","Unidade"],
    ["SKU:PAI","PAI","Produto pai","Produto acabado / componente","BOM Componentes","L1","ATIVO","UN"],
    ["SKU:FILHO",duplicateSku ? "PAI" : "FILHO","Componente filho","Componente","BOM Componentes","L2","ATIVO","KG"],
    ...(nested ? [
      ["SKU:FILHO2","FILHO2","Segundo componente","Componente","BOM Componentes","L3","ATIVO","UN"],
      ["SKU:MAT","MAT","Material do componente","Componente","BOM Componentes","L4","ATIVO","UN"],
      ["SKU:FILHO3","FILHO3","Outro componente","Componente","BOM Componentes","L5","ATIVO","UN"]
    ] : [])
  ];
  const bom = [
    ["BOM Unificada"],
    [],
    ["ID_Linha_BOM","ID_Pai","ID_Filho","Quantidade","Quantidade_Origem","Unidade","Nível","Origem_BOM","Chave_Familia","Chave_Linha_Origem","Status_Vínculo","Observação","OP_Compras","OP_Usinagem","OP_Montagem"],
    ["BOM:1","SKU:PAI","SKU:FILHO",2,2,"UN","01","Componentes","F1","L1","OK",null,"Alberto","-","-"],
    ["BOM:2","SKU:PAI",null,null,"N/A","UN","01","Hélices","F1","L2","PENDENTE","Caixa ausente",null,null,null],
    ...(nested ? [
      ["BOM:3","SKU:PAI","SKU:FILHO2",1,1,"UN","01","Componentes","F2","F2-L001","OK",null,null,null,null],
      ["BOM:4","SKU:PAI","SKU:MAT",0.5,0.5,"UN","02","Componentes","F2","F2-L002","OK",null,null,null,null],
      ["BOM:5","SKU:PAI","SKU:FILHO3",2,2,"UN","01","Componentes","F2","F2-L003","OK",null,null,null,null],
      ["BOM:6","SKU:PAI","SKU:FILHO",1,1,"UN","01","Componentes","F3","F3-L001","OK",null,null,null,null],
      ["BOM:7","SKU:PAI","SKU:MAT",0.25,0.25,"UN","02","Componentes","F3","F3-L002","OK",null,null,null,null]
    ] : [])
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

test("usa o item anterior do nível imediatamente acima como pai da linha BOM", () => {
  const result = parseNormalizedProductWorkbook(workbook({ nested: true }));
  const material = result.bomLines.find(line => line.sourceLineId === "BOM:4");
  const siblingMaterial = result.bomLines.find(line => line.sourceLineId === "BOM:7");
  assert.equal(material.parentSourceId, "SKU:FILHO2");
  assert.equal(material.childSourceId, "SKU:MAT");
  assert.equal(siblingMaterial.parentSourceId, "SKU:FILHO");
});

test("rejeita SKU duplicado antes de qualquer gravacao", () => {
  assert.throws(
    () => parseNormalizedProductWorkbook(workbook({ duplicateSku: true })),
    error => error instanceof ProductImportError && error.status === 422 && error.details.some(issue => issue.code === "DUPLICATE_SKU")
  );
});
