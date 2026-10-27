# F2A — Catálogo Mestre: resumo de homologação

O Catálogo Mestre é aditivo: V003 cria `master_items` e `item_aliases`; V004 acrescenta eventos idempotentes e histórico imutável de SKU. A identidade é UUID, SKU principal normalizado de forma conservadora e único, e alias único por namespace/código normalizado. Não houve backfill nem alteração de catálogos, estoques, OPs ou snapshots existentes.

As APIs oficiais em `/api/master-items` oferecem criação, consulta, busca paginada, atualização CAS, aliases e resolução de código. Escritas exigem `eventKey`; atualizações exigem `expectedVersion`. Sessão, proxy secret e CSRF existentes são obrigatórios. Até a decisão D-005, o acesso é restrito no backend a `admin` e outro ator não pode recuperar evento idempotente alheio.

Homologação F2A.2D: integrações PostgreSQL 17 de Item Mestre HTTP (3), schema/serviço (15), Rastreio (3), Buchas (7) e Inventário (3), além de `test:ci` e build, aprovadas. A cobertura inclui idempotência, CAS, histórico de SKU, aliases, leituras sem efeito colateral, concorrência, autorização e ausência de escrita em agregados legados.

Para F2B permanecem pendentes a decisão D-005 de autorização operacional e qualquer definição explícita de migração gradual de catálogos/aliases. O Git continua com trabalho local não publicado; não houve commit, push, merge ou deploy.
