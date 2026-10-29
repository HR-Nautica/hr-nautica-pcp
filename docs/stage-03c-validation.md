# Etapa 03C — evidências e pendências

Integração executada com `node tests/migrations/run-postgres17-integration.js --product-import`, PostgreSQL 17 e dados sintéticos descartáveis. Passou criação, prévia sem escrita, UUID preservado entre arquivos diferentes, KG preservado, alias inequívoco, mesmo checksum idempotente e bloqueio de conflito de unidade/status desconhecido/unidade ausente. Não cobre ainda rollback por falha injetada, concorrência entre importações, BOM suspeita em PostgreSQL ou navegador autenticado.

Pré-validação e confirmação usam o mesmo buffer; a API exige expectedChecksum e rejeita divergência. Clientes antigos precisam pré-validar e enviar esse campo. Nenhuma migration foi criada.

Auditoria somente leitura disponível em scripts/db/audit-product-foundation.sql. Contagens produtivas e conciliação dos 1.350 itens não verificadas: sem extrato autenticado e sem arquivo atual identificado. Não usar backup antigo como fonte vigente.

Classificação proposta: hélice usinada/helices, hélice bruta/brutos, bucha/buchas, caixa/componentes. Unidade deve vir da origem aprovada. Liga metálica, matéria-prima e revenda dependem de decisão de tipo/família; varchar de tipo comporta os textos, mas API/importador/UI ainda precisam de alteração aprovada. Não inferir natureza operacional nem consumo.

Procedimento produtivo futuro: backup recuperável; executar auditoria anterior; pré-validar lote e checksum; resolver conflitos e classificação; aprovar lote; autorizar importação; auditar após; conciliar criados/reutilizados/aliases e UUIDs; verificar BOM/roteiros/estoque/fornecedores; em falha transacional confirmar rollback, em resultado confirmado divergente interromper novos lotes e reconciliar antes de qualquer restauração.

Parecer: PENDENTE. Integração parcial aprovada; faltam arquivo/extrato real, testes transacionais adicionais e fluxo de navegador. Nenhuma carga produtiva autorizada ou executada.
