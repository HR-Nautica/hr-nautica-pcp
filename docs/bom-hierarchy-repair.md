# Correção de hierarquia da BOM

## Regra

Em cada família de BOM, nível 01 é filho do produto raiz; nível 02 é filho da linha nível 01 imediatamente anterior; níveis seguintes apontam para a linha imediatamente anterior do nível acima. A família e a ordem da linha de origem definem a sequência. Quantidade, situação, unidade, etapas de produção e demais dados não são alterados.

## Aplicação

`V009__correct_nested_bom_parent_links.sql` corrige somente linhas importadas pelo esquema `normalized_bom_v1` com nível maior que 01. A migração falha sem alterações se uma linha não possuir pai identificado no nível anterior. Cada vínculo alterado é registrado em `product_bom_parent_repair_audit` com o pai anterior e o corrigido.

O pipeline de publicação não executa migrations. Após a publicação aprovada, aplique a migração pelo procedimento administrativo documentado em `database/migrations/README.md`, usando `npm run db:migrate:dry-run` e depois `npm run db:migrate` no ambiente do banco correto. Não cole credenciais no terminal compartilhado ou no chat.

## Reversão imediata

Somente se não houver alterações manuais nos vínculos desde a migração, execute a reversão abaixo dentro de uma transação administrativa:

```sql
BEGIN;

UPDATE public.product_bom_lines line
SET parent_product_id = audit.previous_parent_product_id,
    version = line.version + 1,
    updated_at = clock_timestamp(),
    updated_by = 'rollback:V009'
FROM public.product_bom_parent_repair_audit audit
WHERE audit.line_id = line.id
  AND line.parent_product_id = audit.corrected_parent_product_id;

COMMIT;
```

O histórico de reparo permanece para auditoria. Não remova os registros de migração nem a tabela de auditoria manualmente.
