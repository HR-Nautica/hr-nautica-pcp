# F2A.1 — Schema do Item Mestre e Aliases

V003__master_items_and_aliases.sql adiciona somente a identidade relacional. Não cria APIs, backfill, vínculos automáticos, movimentos, saldos, OPs, reservas nem alterações em chaves legadas.

## Estrutura

- master_items: UUID gerado pelo PostgreSQL, SKU principal e normalizado, família (helices, componentes, buchas, brutos), descrição, unidade, status (active, inactive), versão CAS e autoria/data.
- item_aliases: UUID, FK restritiva para o item, namespace, código original, código normalizado, status e autoria/data.

SKU normalizado e alias normalizado são colunas geradas por master_identifier_normalize(text): remove apenas espaços externos e converte apenas a-z ASCII para A-Z. Zeros, prefixos, espaços internos e pontuação são preservados. Assim, 00123 e 123 são distintos; ab-01 e AB-01 conflitam.

O SKU normalizado é único na instalação única. Alias é único em namespace e código normalizado, inclusive inativo; o mesmo código em namespace diferente é permitido. Namespace é minúsculo ASCII com números e _. FK usa ON DELETE RESTRICT. Triggers impedem alterar UUID e transferir alias entre itens, sem efeito colateral operacional.

version inicia em 1 para CAS da F2A.2. A API futura deverá usar rotas autenticadas de domínio, ator, CAS, auditoria e 409; não poderá escrever pelo endpoint genérico de estado.

## Compatibilidade

A migration é aditiva e não altera materiais, movimentos, OPs, peças, Buchas, Fundição, catálogos legados, snapshots ou V.I.N.I.
