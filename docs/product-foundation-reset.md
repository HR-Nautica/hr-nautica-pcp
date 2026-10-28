# Nova base de produtos, BOM e estoque

## Escopo desta etapa

Esta etapa cria uma fundacao aditiva para reconstruir o ERP sem apagar os catalogos, saldos, movimentacoes ou ordens existentes. A planilha `BOMs_normalizadas_unificadas.xlsx` e a fonte inicial do cadastro; ela nao substitui automaticamente as fontes oficiais de saldo do sistema atual.

## Fluxo de dados

1. O administrador envia a planilha normalizada.
2. A API valida estrutura, identidades, quantidades, autorreferencias e duplicidades antes de gravar.
3. Uma transacao unica cria ou reconcilia produtos por SKU, grava a BOM e registra a auditoria da carga.
4. Linhas `OK` tornam-se vinculos ativos. Linhas `PENDENTE` e `REVISAR` permanecem fora da BOM ativa.
5. O saldo inicial continua nulo: a carga de cadastro nao inventa nem copia saldo fisico.

## Entidades

- `master_items`: cadastro mestre, tipo, caracteristicas basicas e flag de atualizacao pelo Tiny.
- `product_bom_lines`: relacoes pai/filho versionadas por linha de origem.
- `production_steps` e `product_routing_steps`: cadastro de etapas e roteiro por produto.
- `product_suppliers` e `product_supplier_links`: fornecedores e seus vinculos com produtos.
- `product_stock_balances`: posicao de estoque ligada ao produto e sua autoridade (`erp` ou `tiny_import`).
- `product_catalog_imports` e `product_catalog_import_issues`: rastreabilidade e pendencias da carga.

## Flag de importacao Tiny

A caixa `Atualizado pela planilha Tiny` pertence ao produto. Quando desmarcada, a autoridade de saldo e o ERP; quando marcada, a autoridade e a importacao Tiny. A planilha normalizada nao declara essa escolha, portanto todos os produtos entram desmarcados. A troca futura deve ser explicita, auditada e reconciliar o saldo atual em uma transacao.

## Resultado validado da fonte inicial

- 577 produtos unicos.
- 1.359 linhas de BOM na origem.
- 1.088 vinculos ativos.
- 252 vinculos pendentes ou em revisao que possuem pai e filho identificados.
- 19 linhas sem filho identificado, preservadas apenas na auditoria.
- 272 apontamentos preservados da aba `Auditoria`.

As colunas `OP_Compras`, `OP_Usinagem` e `OP_Montagem` ficam guardadas como metadados de origem. Elas nao geram etapas de producao porque os valores atuais nao definem inequivocamente um roteiro.

## Corte e reversao

Esta migration e somente expansiva. A interface antiga permanece operacional ate que as novas telas, leituras e escritas sejam homologadas. Reverter a aplicacao nao exige apagar as novas tabelas; elas podem permanecer sem consumidores. Qualquer corte definitivo ou limpeza das estruturas antigas requer uma etapa separada, backup verificado e autorizacao explicita.
