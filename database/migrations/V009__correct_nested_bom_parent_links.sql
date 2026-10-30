DO $$
DECLARE
  unresolved_count integer;
BEGIN
  WITH bom_lines AS (
    SELECT id, child_product_id, source_payload->>'familyKey' AS family_key,
      substring(source_payload->>'originLineKey' FROM '-L([0-9]+)$')::integer AS line_order,
      level_code::integer AS level
    FROM public.product_bom_lines
    WHERE source_payload->>'sourceSchema' = 'normalized_bom_v1'
      AND COALESCE(source_payload->>'familyKey', '') <> ''
      AND source_payload->>'originLineKey' ~ '-L[0-9]+$'
      AND level_code ~ '^[0-9]+$'
  )
  SELECT count(*)::integer INTO unresolved_count
  FROM bom_lines child
  WHERE child.level > 1
    AND NOT EXISTS (
      SELECT 1 FROM bom_lines parent
      WHERE parent.family_key = child.family_key
        AND parent.level = child.level - 1
        AND parent.line_order < child.line_order
        AND parent.child_product_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM bom_lines reset
          WHERE reset.family_key = child.family_key
            AND reset.line_order > parent.line_order
            AND reset.line_order < child.line_order
            AND reset.level < parent.level
        )
    );

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'BOM nesting repair blocked: % nested source lines have no preceding parent at the previous level.', unresolved_count;
  END IF;
END;
$$;

CREATE TABLE public.product_bom_parent_repair_audit (
  line_id uuid PRIMARY KEY REFERENCES public.product_bom_lines(id) ON DELETE RESTRICT,
  source_line_id text NOT NULL UNIQUE,
  previous_parent_product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  corrected_parent_product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  previous_version integer NOT NULL,
  repaired_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  repaired_by character varying(100) NOT NULL DEFAULT 'migration:V009',
  CONSTRAINT product_bom_parent_repair_version_check CHECK (previous_version >= 1),
  CONSTRAINT product_bom_parent_repair_actor_check CHECK (char_length(btrim(repaired_by)) BETWEEN 1 AND 100)
);

WITH bom_lines AS (
  SELECT id, parent_product_id, child_product_id, source_line_id, version,
    source_payload->>'familyKey' AS family_key,
    substring(source_payload->>'originLineKey' FROM '-L([0-9]+)$')::integer AS line_order,
    level_code::integer AS level
  FROM public.product_bom_lines
  WHERE source_payload->>'sourceSchema' = 'normalized_bom_v1'
    AND COALESCE(source_payload->>'familyKey', '') <> ''
    AND source_payload->>'originLineKey' ~ '-L[0-9]+$'
    AND level_code ~ '^[0-9]+$'
), corrections AS (
  SELECT child.id, child.parent_product_id AS previous_parent_product_id,
    parent.child_product_id AS corrected_parent_product_id,
    child.source_line_id, child.version AS previous_version
  FROM bom_lines child
  JOIN LATERAL (
    SELECT candidate.child_product_id
    FROM bom_lines candidate
    WHERE candidate.family_key = child.family_key
      AND candidate.level = child.level - 1
      AND candidate.line_order < child.line_order
      AND candidate.child_product_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bom_lines reset
        WHERE reset.family_key = child.family_key
          AND reset.line_order > candidate.line_order
          AND reset.line_order < child.line_order
          AND reset.level < candidate.level
      )
    ORDER BY candidate.line_order DESC
    LIMIT 1
  ) parent ON true
  WHERE child.level > 1
    AND child.parent_product_id IS DISTINCT FROM parent.child_product_id
)
INSERT INTO public.product_bom_parent_repair_audit
  (line_id, source_line_id, previous_parent_product_id, corrected_parent_product_id, previous_version)
SELECT id, source_line_id, previous_parent_product_id, corrected_parent_product_id, previous_version
FROM corrections;

UPDATE public.product_bom_lines line
SET parent_product_id = audit.corrected_parent_product_id,
    version = line.version + 1,
    updated_at = clock_timestamp(),
    updated_by = 'migration:V009'
FROM public.product_bom_parent_repair_audit audit
WHERE audit.line_id = line.id
  AND line.parent_product_id = audit.previous_parent_product_id;
