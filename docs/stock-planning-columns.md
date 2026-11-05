# Colunas do Estoque Geral — fontes e cálculos

Definição atualizada pelo usuário em 05/11/2026:

| Coluna | Fonte / regra |
| --- | --- |
| Entradas previstas (em Produção) | ERP: soma das quantidades das OPs abertas para o item, quando o novo fluxo de OPs for implementado. |
| Saídas previstas (vendido) | Tiny, conforme seleção do produto. |
| Estoque físico | Tiny, conforme seleção do produto; desmarcado preserva o controle interno. |
| Estoque 1 | Estoque físico menos saídas previstas (vendido). |
| Estoque virtual | Estoque físico menos saídas previstas (vendido) mais entradas previstas (em Produção). |
| Saídas do período | Tiny, conforme seleção do produto. |
| Média mensal | Tiny, conforme seleção do produto; não recalcular a média exportada. |

SKU e Produto permanecem no início; Fonte identifica a origem do físico. Tipo e Unidade permanecem no cadastro, fora da tabela.

Enquanto as novas OPs não estão implementadas, Entradas previstas fica vazia e produção contribui com zero para o virtual, conforme confirmação expressa do usuário. Não conectar ordens legadas por suposição. A futura implementação deverá definir as quantidades em aberto/fragmentadas sem dupla contagem e usar a fonte oficial de OPs do novo fluxo.

Entradas e Estoque virtual da planilha Tiny são ignorados, inclusive nos snapshots antigos; os campos deixam de ser selecionáveis no cadastro. As permissões legadas desses dois campos são desconsideradas. Campos externos ausentes não viram zero: sem físico ou vendido informado, Estoque 1 e virtual permanecem não informados. Negativos são preservados.

O snapshot auditado transacional guarda apenas as métricas externas. As colunas calculadas não geram movimentação nem alteram o físico. A leitura utiliza a última posição confirmada por produto, sem somar importações.
