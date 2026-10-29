import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("nova interface expõe apenas os quatro módulos da base", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const page of ["Produtos", "Estoque Geral", "Etapas de Produção", "Fornecedores"]) assert.match(html, new RegExp(page));
  for (const legacy of ["V.I.N.I.", "Programação de Fundição", "OPs de Hélices"]) assert.doesNotMatch(html, new RegExp(legacy));
});

test("cadastro possui características, Tiny, BOM e exclusão administrativa", async () => {
  const app = await readFile(new URL("public/js/new-erp.js", root), "utf8");
  assert.match(app, /Características básicas/);
  assert.match(app, /Atualizado pela planilha Tiny/);
  assert.match(app, /BOM do produto/);
  assert.match(app, /method:\"DELETE\"/);
});

test("produto abre ficha com BOM e roteiro baseado em etapas cadastradas", async () => {
  const [app, routes, service] = await Promise.all([
    readFile(new URL("public/js/new-erp.js", root), "utf8"),
    readFile(new URL("server/routes/catalog.js", root), "utf8"),
    readFile(new URL("server/product-catalog.js", root), "utf8")
  ]);
  assert.match(app, /Dados gerais/);
  assert.match(app, /Etapas de produção/);
  assert.match(app, /Nenhum componente vinculado/);
  assert.match(app, /Nenhuma etapa disponível/);
  assert.match(app, /aria-selected/);
  assert.doesNotMatch(app, /product-detail__hero/);
  assert.match(app, /request\("\/api\/catalog\/steps"\)/);
  assert.match(routes, /products\/:id\/routing/);
  assert.match(service, /product_routing_steps/);
  assert.match(service, /ROUTING_VERSION_CONFLICT/);
});
