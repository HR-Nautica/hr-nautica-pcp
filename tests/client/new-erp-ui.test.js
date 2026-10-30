import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("nova interface expõe apenas os quatro módulos da base", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const page of ["Produtos", "Estoque Geral", "Etapas de Produção", "Fornecedores"]) assert.match(html, new RegExp(page));
  for (const legacy of ["V.I.N.I.", "Programação de Fundição", "OPs de Hélices"]) assert.doesNotMatch(html, new RegExp(legacy));
  assert.match(html, /class="brand-logo" src="\/logo\.png"/);
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
  assert.match(app, /Árvore da lista de materiais/);
  assert.match(app, /bom-tree-toggle/);
  assert.match(app, /class="bom-product-link" data-product-id="\$\{escapeHtml\(line\.child_product_id\)\}"/);
  assert.match(app, /showProductDetail\(button\.dataset\.productId,"general"\)/);
  assert.match(app, /Expandir tudo/);
  assert.doesNotMatch(app, /Importar etapas CO/);
  assert.doesNotMatch(app, /query-import-routing/);
  assert.match(app, /itens já existem e serão preservados/);
  assert.match(app, /novos itens serão incluídos/);
  assert.match(app, /novos itens incluídos/);
  assert.match(service, /WITH RECURSIVE bom_tree/);
  assert.match(service, /tree\.depth<30/);
  assert.match(app, /Nenhuma etapa disponível/);
  assert.match(app, /aria-selected/);
  assert.match(app, /role="tablist"/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /setPageBusy/);
  assert.match(app, /setPageError/);
  assert.doesNotMatch(app, /product-detail__hero/);
  assert.match(app, /routing-add/);
  assert.match(app, /Não informado/);
  assert.match(app, /class="routing-table"/);
  assert.match(app, /request\("\/api\/catalog\/steps"\)/);
  assert.match(routes, /products\/:id\/routing/);
  assert.match(service, /product_routing_steps/);
  assert.match(service, /ROUTING_VERSION_CONFLICT/);
});

test("interface compartilhada possui feedback acessível e movimento reduzido", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("public/css/table-fixes.css", root), "utf8")
  ]);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /aria-labelledby="modal-title"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /button:focus-visible/);
});
