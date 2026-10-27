# F2A.2C — API HTTP do Item Mestre

Rotas autenticadas em `/api/master-items`: `POST /`, `GET /`, `GET /resolve`, `GET /:id`, `PATCH /:id`, `GET /:id/aliases` e `POST /:id/aliases`. Escritas recebem `{ data, eventKey }`; atualização inclui `expectedVersion`. Respostas usam `{ ok: true, ... }` ou `{ ok: false, code, error, currentVersion? }`.

O router é montado após `authSystem.protectBusiness`, portanto usa sessão, proxy secret, troca obrigatória de senha e CSRF existentes. Além disso, aplica autorização provisória `req.auth.role === "admin"`; cliente não fornece ator, papel ou usuário. V002 só permite `admin`, então o caso de papel não autorizado é testado por contexto Express isolado, sem novo papel, migration ou ampliação de permissão de produção. D-005 continua pendente para substituir essa restrição por autorização operacional aprovada.

O router delega exclusivamente para `server/master-items.js`; não contém SQL ou regra de domínio. Erros de validação retornam 400, autenticação/CSRF usam os middlewares existentes (401/403), autorização retorna 403, item ausente 404, conflitos CAS/SKU/alias/eventKey 409 e indisponibilidade PostgreSQL conhecida 503. A repetição idempotente retorna 200; criação efetiva retorna 201.
