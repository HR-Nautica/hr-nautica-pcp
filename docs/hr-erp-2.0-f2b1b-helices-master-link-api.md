# F2B.1B — API de vínculos de Hélices

Endpoints admin-only: `GET /api/catalog-links/helices/:originUid`, `POST /api/catalog-links/helices` e `POST /api/catalog-links/helices/:linkId/unlink`.

As escritas recebem `data` e `eventKey`; criação exige `originUid`, `masterItemId`, `reconciliationMethod` e `reason`; desvinculação exige `reason` e `expectedVersion`. O ator vem exclusivamente de `req.auth.username`.

Antes de criar, o serviço consulta `app_state.hrn_modelos` no PostgreSQL dentro da transação, exige UUID existente uma única vez e não usa SKU, `hrn_modelos.id` ou a planilha estática. Origem ausente retorna 404; fonte inexistente/inválida retorna 503; duplicidade retorna 409.

Idempotência reutiliza `master_item_idempotency_events`, com lock consultivo, hash canônico, operação separada e escopo de ator. A V005 mantém o histórico de desvinculação. Registros legados sem `origin_uid` permanecem não vinculáveis. O frontend F2B.1C deve apenas consumir esses endpoints, informar confirmação explícita e enviar CSRF/eventKey; não pode escrever `/api/state`.

Homologação HTTP PostgreSQL 17: `helices-master-links-http-postgres17.integration.test.js` executa contra Express e banco descartável reais. A cobertura confirma leitura sem vínculo e sem escrita no snapshot, criação pela origem persistida, idempotência, hash divergente, desvinculação histórica, repetição idempotente, origem ausente/duplicada, família incompatível, sessão e CSRF. Não há frontend, backfill ou alteração de `hrn_modelos`.
