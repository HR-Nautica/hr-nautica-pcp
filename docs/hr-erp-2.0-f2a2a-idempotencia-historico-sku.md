# F2A.2A — Idempotência e Histórico de SKU

`V004__master_item_events_and_sku_history.sql` é aditiva e depende somente de V003. Não cria APIs, rotas, frontend, backfill, aliases automáticos, movimentos, saldos, OPs ou escrita nos agregados P0.

## Idempotência persistida

`master_item_idempotency_events` contém a operação, `event_key`, SHA-256 do payload canônico, `resource_item_id`, resultado JSON recuperável, ator e instante. O par `(operation, event_key)` é único; por isso uma chave pode ser reutilizada somente em outra operação. A FK ao Item Mestre é `ON DELETE RESTRICT` e há índice de recurso.

Na F2A.2B, a API autenticada deverá criar/consultar este evento na mesma transação do efeito de negócio. Para repetição, deverá recuperar o resultado e comparar o hash persistido; hash divergente deverá resultar em conflito. A tabela não possui estado "confirmado": a linha só se torna visível após o commit, de modo que rollback não deixa evento recuperável.

## Histórico de SKU

`master_item_sku_history` armazena item, SKU antigo/novo, representações normalizadas, versões CAS anterior/nova, ator e instante. A versão nova deve ser exatamente a anterior mais um, uma única vez por item/versão nova. O histórico possui FK restritiva, índice temporal por item e é imutável.

O constraint trigger diferido `master_items_sku_history_required` verifica no commit que toda alteração de `primary_sku` tem uma linha de histórico correspondente — item, SKU e normalização, versões e ator (`updated_by`). Assim, mudança e histórico permanecem na mesma transação, inclusive em SQL direto. O UUID permanece protegido por V003 e um SKU anterior não é promovido a alias.

## Dependências para F2A.2B

- rota de domínio autenticada, sem usar a escrita genérica de estado;
- serialização canônica e hash SHA-256 de payload;
- CAS em `master_items.version`, ator da sessão e respostas de conflito;
- recuperação do resultado da operação idempotente e tratamento de concorrência;
- definição operacional explícita sobre criação de alias para SKU histórico, se vier a ser necessária.
