CREATE OR REPLACE FUNCTION public.master_identifier_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT translate(btrim(input), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
$$;

CREATE TABLE public.master_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_sku text NOT NULL,
  primary_sku_normalized text GENERATED ALWAYS AS (public.master_identifier_normalize(primary_sku)) STORED,
  family character varying(32) NOT NULL,
  description text NOT NULL,
  unit character varying(32) NOT NULL,
  status character varying(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL DEFAULT 'system',
  updated_by character varying(100) NOT NULL DEFAULT 'system',
  CONSTRAINT master_items_primary_sku_not_blank CHECK (primary_sku = btrim(primary_sku) AND char_length(primary_sku) BETWEEN 1 AND 120),
  CONSTRAINT master_items_primary_sku_normalized_not_blank CHECK (char_length(primary_sku_normalized) >= 1),
  CONSTRAINT master_items_family_check CHECK (family IN ('helices', 'componentes', 'buchas', 'brutos')),
  CONSTRAINT master_items_description_check CHECK (description = btrim(description) AND char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT master_items_unit_check CHECK (unit = btrim(unit) AND char_length(unit) BETWEEN 1 AND 32),
  CONSTRAINT master_items_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT master_items_version_check CHECK (version >= 1),
  CONSTRAINT master_items_created_by_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100),
  CONSTRAINT master_items_updated_by_check CHECK (char_length(btrim(updated_by)) BETWEEN 1 AND 100),
  CONSTRAINT master_items_primary_sku_normalized_key UNIQUE (primary_sku_normalized)
);

CREATE INDEX idx_master_items_family_status ON public.master_items (family, status);

CREATE OR REPLACE FUNCTION public.prevent_master_item_id_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'master_items.id is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER master_items_id_immutable BEFORE UPDATE ON public.master_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_master_item_id_change();

CREATE TABLE public.item_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  namespace character varying(64) NOT NULL,
  original_code text NOT NULL,
  normalized_code text GENERATED ALWAYS AS (public.master_identifier_normalize(original_code)) STORED,
  status character varying(16) NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL DEFAULT 'system',
  CONSTRAINT item_aliases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.master_items(id) ON DELETE RESTRICT,
  CONSTRAINT item_aliases_namespace_check CHECK (namespace = btrim(namespace) AND namespace ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT item_aliases_original_code_not_blank CHECK (char_length(btrim(original_code)) BETWEEN 1 AND 120),
  CONSTRAINT item_aliases_normalized_code_not_blank CHECK (char_length(normalized_code) >= 1),
  CONSTRAINT item_aliases_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT item_aliases_created_by_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100),
  CONSTRAINT item_aliases_namespace_normalized_code_key UNIQUE (namespace, normalized_code)
);

CREATE INDEX idx_item_aliases_item_id ON public.item_aliases (item_id);

CREATE OR REPLACE FUNCTION public.prevent_item_alias_identity_transfer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'item_aliases.id is immutable'; END IF;
  IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN RAISE EXCEPTION 'item_aliases.item_id is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_aliases_identity_immutable BEFORE UPDATE ON public.item_aliases
FOR EACH ROW EXECUTE FUNCTION public.prevent_item_alias_identity_transfer();
