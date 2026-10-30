import assert from "node:assert/strict";
import test from "node:test";
import { buildBomTree } from "../../server/bom-tree.js";

test("monta filhos na posição 02 sob o 01 anterior e preserva irmãos 01", () => {
  const rows = [
    { id: "a", depth: 1, child_sku: "CORPO" },
    { id: "b", depth: 2, child_sku: "LATÃO" },
    { id: "c", depth: 1, child_sku: "CAPA" },
    { id: "d", depth: 2, child_sku: "LATÃO 7/8" },
    { id: "e", depth: 1, child_sku: "MOLA" }
  ];

  const tree = buildBomTree(rows);
  assert.deepEqual(tree.map(node => [node.child_sku, node.children.map(child => child.child_sku)]), [
    ["CORPO", ["LATÃO"]],
    ["CAPA", ["LATÃO 7/8"]],
    ["MOLA", []]
  ]);
});

test("ignora níveis inválidos sem anexar filhos ao ramo errado", () => {
  const tree = buildBomTree([
    { id: "a", depth: 1, child_sku: "CORPO" },
    { id: "bad", depth: 0, child_sku: "RAIZ DUPLICADA" },
    { id: "b", depth: 2, child_sku: "LATÃO" }
  ]);
  assert.deepEqual(tree.map(node => node.child_sku), ["CORPO"]);
  assert.deepEqual(tree[0].children.map(node => node.child_sku), ["LATÃO"]);
});

test("usa a posição da planilha para reconstruir linhas importadas sob o produto raiz", () => {
  const rows = [
    { id: "a", parent_product_id: "root", depth: 1, level_code: "01", child_sku: "CORPO" },
    { id: "b", parent_product_id: "root", depth: 1, level_code: "02", child_sku: "LATÃO" },
    { id: "c", parent_product_id: "root", depth: 1, level_code: "01", child_sku: "CAPA" },
    { id: "d", parent_product_id: "root", depth: 1, level_code: "02", child_sku: "LATÃO 7/8" }
  ];
  const tree = buildBomTree(rows, "root");
  assert.deepEqual(tree.map(node => [node.child_sku, node.children.map(child => child.child_sku)]), [
    ["CORPO", ["LATÃO"]],
    ["CAPA", ["LATÃO 7/8"]]
  ]);
});
