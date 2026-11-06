# Refinamento visual da BOM — 06/11/2026

Escopo exclusivamente de apresentação em `public/js/helice-analysis-ui.js` e `public/css/new-erp.css`. Nenhuma fórmula, API, permissão, saldo ou OP alterada; sem migration.

O detalhe da hélice mantém um único resumo de estoque/produção. A BOM passa a apresentar uma lista comparativa com descrição e SKU agrupados, quantidade por pai, estoque físico/fonte e saldo após vendido. Componentes começam recolhidos, mas seus saldos principais ficam visíveis na linha; abrir revela ficha, roteiro e subitens. Contagem de materiais refere-se aos componentes diretos do produto pai.

Negativos permanecem destacados. Valor ausente aparece como “Não informado”, sem unidade falsa. Roteiro cadastrado e etapa de execução continuam separados; OPs antigas não são consultadas. Layout estreito reorganiza os valores com rótulos locais e mantém rolagem da tabela.

Validação: suíte CI e build; prévia local com dados fictícios, bruto sem posição e bucha com saldo, abrir componente e roteiro, recarga e largura 390 (painel de 280 px sem transbordamento interno). Revisão Visual/Quality: menos repetição, hierarquia consistente, fronteiras do domínio preservadas. Sem testes transacionais adicionais porque não há mudança de escrita. Rollback: reverter commit.
