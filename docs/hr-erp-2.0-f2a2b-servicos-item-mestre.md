# F2A.2B — Serviços transacionais do Item Mestre

O módulo `server/master-items.js` disponibiliza serviços internos, sem rota HTTP: `createMasterItem`, `getMasterItem`, `listMasterItems`, `updateMasterItem`, `addMasterItemAlias`, `listMasterItemAliases` e `resolveMasterItemCode`.

As escritas usam `transaction` e as leituras usam `withConnection` existentes. Cada escrita exige ator confiável e `eventKey`; o serviço toma um advisory lock transacional PostgreSQL em `(operation,eventKey)`, consulta a persistência de V004 e confirma item/alias, evento e `audit_log` na mesma transação. A repetição do mesmo ator e hash recupera o recurso sem nova versão; hash diferente retorna `MASTER_ITEM_EVENT_CONFLICT`. Uma chave pertencente a outro ator retorna `MASTER_ITEM_EVENT_FORBIDDEN`; a rota F2A.2C deverá obter o ator exclusivamente da sessão autenticada.

O hash SHA-256 usa uma serialização JSON canônica: chaves de objetos são ordenadas recursivamente, arrays preservam ordem e somente os campos validados e efetivamente persistidos participam. Datas e outros valores voláteis não participam. Strings são exigidas sem espaços externos conforme V003; ausência de `status` equivale a `active`.

Atualização exige `expectedVersion` e bloqueia a linha. Campos permitidos são SKU principal, família, descrição, unidade e situação. Versão obsoleta gera `MASTER_ITEM_VERSION_CONFLICT`. Mudança de SKU insere o histórico antes do commit, satisfazendo o trigger diferido de V004; não cria alias do SKU anterior. Associar alias não altera a versão do Item Mestre, pois não altera seus campos cadastrais; a operação é idempotente e a FK/trigger de V003 impede transferência.

Erros de domínio: `MASTER_ITEM_VALIDATION`, `MASTER_ITEM_NOT_FOUND`, `MASTER_ITEM_SKU_CONFLICT`, `MASTER_ITEM_ALIAS_CONFLICT`, `MASTER_ITEM_VERSION_CONFLICT`, `MASTER_ITEM_EVENT_CONFLICT` e `MASTER_ITEM_EVENT_FORBIDDEN`.

## Dependências para F2A.2C

- rotas autenticadas que extraiam ator de `req.auth`, apliquem autorização operacional e mapeiem erros para HTTP;
- contrato HTTP explícito para paginação, `eventKey`, `expectedVersion` e códigos 409/403;
- proteção CSRF já existente e testes de autorização por papel;
- nenhuma rota pode usar `/api/state` para este domínio.
