# F2B.1A — Vínculo relacional de Hélices ao Item Mestre

`V005__legacy_catalog_master_links.sql` adiciona a tabela `legacy_catalog_master_links`, sem alterar catálogos, snapshots ou dados operacionais. O identificador legado é exclusivamente `legacy_origin_uid` (UUID de `hrn_modelos`); SKU e ID operacional não participam do vínculo.

O contrato registra família e namespace fixos (`helices` / `hrn_modelos`), Item Mestre, método e evidência de reconciliação, atores, datas, estado e versão. A FK para `master_items` usa `ON DELETE RESTRICT`. Índices únicos parciais impedem dois vínculos ativos para a mesma origem ou para o mesmo Item Mestre no catálogo.

Triggers exigem `master_items.family = 'helices'`, bloqueiam mudança de família enquanto houver histórico de vínculo e preservam a identidade/evidência do registro. Desvinculação é a única atualização permitida: `active` para `unlinked`, com próximo número de versão, ator, data e motivo. Uma nova associação cria uma nova linha; não reativa a anterior.

Não há API nesta fase. F2B.1B deve ser admin-only provisoriamente, validar que o `origin_uid` ainda existe no catálogo carregado e criar/desvincular registros por transação/CAS. Registros legados sem UID seguem sem vínculo até reconciliação controlada, auditável e confirmada. Não houve backfill, inferência por SKU, aliases ou criação automática de Item Mestre.
