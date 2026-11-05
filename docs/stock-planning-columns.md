# Colunas do Estoque Geral

Regra solicitada pelo usuário em 05/11/2026:

`Estoque 1 = Estoque físico - Saídas previstas (vendido)`.

Ordem visual: SKU, Produto, Entradas, Saídas previstas (vendido), Estoque físico, Estoque 1, Estoque virtual, Saídas do período, Média mensal, Fonte. Tipo e Unidade foram removidos da tabela, permanecendo no cadastro.

A planilha Tiny fornece Entradas previstas (G), Saídas previstas (H), Estoque físico (I), Estoque virtual (J), Saídas do período (M) e Média mensal (N). Os cabeçalhos identificam as informações de planejamento; não se recalcula estoque virtual ou média mensal. Estoque 1 é calculado na visualização com os dois valores disponíveis, preservando negativos e sem gravar uma movimentação.

A sincronização mantém a regra de produtos ativos com Tiny habilitado. Os valores de planejamento são persistidos junto às linhas de alterações do snapshot auditado, na mesma transação do saldo físico. A leitura usa somente o último snapshot confirmado por produto, nunca somando importações. Físico e métricas são consultados no mesmo snapshot SQL para impedir mistura durante uma sincronização concorrente.

Importações anteriores a esta etapa não contêm as informações adicionais: é necessário importar novamente o arquivo. Campo não fornecido significa não informado, nunca zero presumido. Se um snapshot posterior não fornecer o campo, a leitura não reutiliza métricas antigas.
