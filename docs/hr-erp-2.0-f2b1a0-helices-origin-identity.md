# F2B.1A.0 — Identidade de origem de Hélices

## Decisão implementada

`hrn_modelos.id` continua sendo o identificador operacional legado: ele não é usado como identidade para futura associação ao Item Mestre. Cada modelo novo pode possuir `origin_uid`, um UUID imutável e independente de SKU, Item Mestre e ID operacional.

No catálogo-base, o UID nasce na coluna **T / Origin UID** da aba `Matriz` em `Catalogo_Atualizado.xlsx`. Os 86 valores foram atribuídos uma vez e ficaram gravados na fonte versionada. `scripts/generate-catalog-data.js` exige UUID válido e único e o propaga para `public/js/catalogo_data.js`; portanto, um seed posterior não gera outro UID. A coluna **U / SKU Bucha** também é fonte explícita do atributo técnico já existente, para que a geração não o descarte.

## Ciclo de vida

- Seed/reconstrução: só aceita `CATALOGO_DATA` com `origin_uid` válido; a fonte é copiada sem usar SKU, descrição, índice ou hash como identidade.
- Cadastro manual: gera um UUID uma única vez. Edição e mudança de SKU preservam o valor; tentativa de substituí-lo é rejeitada.
- Persistência: `saveModelos` aceita campos adicionais de `hrn_modelos`, valida UUIDs informados e rejeita duplicidade sem gravar a lista inválida.
- Legado: registro sem `origin_uid` permanece legível e editável, sem atribuição automática. A futura reconciliação deve ser explícita, auditável e humana.
- Importação: um UID válido informado é preservado; UID duplicado é rejeitado. Não há importador de modelos que possa inferir a origem por SKU nesta etapa.

## Invariantes comprovadas

O teste `scripts/test-helices-origin-identity.js` usa a fonte efetiva e armazenamento descartável para validar criação manual, edição, mudança de SKU, recarga, reconstrução com novo ID operacional, entrada com UID válido, colisão, imutabilidade e legado sem UID. `scripts/test-catalog.js` valida que o UID gerado corresponde à coluna T da planilha e que os atributos técnicos continuam preservados.

## Dependência para F2B.1A

F2B.1A ainda deve validar esta estabilidade no ambiente alvo e então criar a associação aditiva `legacy_catalog_master_links`. A futura associação deverá referenciar `origin_uid` como identificador legado de origem, nunca `hrn_modelos.id` ou SKU. Não houve backfill, vínculo com `master_items`, API HTTP, migration, alteração de OP, estoque ou Item Mestre nesta etapa.
