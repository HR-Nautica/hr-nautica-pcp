CREATE TABLE public.legacy_catalog_master_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family character varying(32) NOT NULL DEFAULT 'helices',
  legacy_namespace character varying(64) NOT NULL DEFAULT 'hrn_modelos',
  legacy_origin_uid uuid NOT NULL,
  master_item_id uuid NOT NULL,
  status character varying(16) NOT NULL DEFAULT 'active',
  reconciliation_method character varying(32) NOT NULL,
  reconciliation_evidence text,
  linked_by character varying(100) NOT NULL,
  linked_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  unlinked_by character varying(100),
  unlinked_at timestamp with time zone,
  unlink_reason text,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT legacy_catalog_master_links_master_item_fkey FOREIGN KEY (master_item_id) REFERENCES public.master_items(id) ON DELETE RESTRICT,
  CONSTRAINT legacy_catalog_master_links_family_check CHECK (family = 'helices'),
  CONSTRAINT legacy_catalog_master_links_namespace_check CHECK (legacy_namespace = 'hrn_modelos'),
  CONSTRAINT legacy_catalog_master_links_status_check CHECK (status IN ('active', 'unlinked')),
  CONSTRAINT legacy_catalog_master_links_method_check CHECK (reconciliation_method = btrim(reconciliation_method) AND char_length(reconciliation_method) BETWEEN 1 AND 32),
  CONSTRAINT legacy_catalog_master_links_actor_check CHECK (char_length(btrim(linked_by)) BETWEEN 1 AND 100),
  CONSTRAINT legacy_catalog_master_links_version_check CHECK (version >= 1),
  CONSTRAINT legacy_catalog_master_links_unlink_check CHECK (
    (status = 'active' AND unlinked_by IS NULL AND unlinked_at IS NULL AND unlink_reason IS NULL)
    OR (status = 'unlinked' AND char_length(btrim(unlinked_by)) BETWEEN 1 AND 100 AND unlinked_at IS NOT NULL AND char_length(btrim(unlink_reason)) BETWEEN 1 AND 500)
  )
);

CREATE UNIQUE INDEX legacy_catalog_master_links_active_origin_uid_key
  ON public.legacy_catalog_master_links (legacy_namespace, legacy_origin_uid) WHERE status = 'active';
CREATE UNIQUE INDEX legacy_catalog_master_links_active_master_item_key
  ON public.legacy_catalog_master_links (family, legacy_namespace, master_item_id) WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.assert_helices_master_link_family()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.master_items WHERE id = NEW.master_item_id AND family = 'helices') THEN
    RAISE EXCEPTION 'legacy helices link requires master_items.family=helices';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_catalog_master_links_family_guard
BEFORE INSERT OR UPDATE OF master_item_id ON public.legacy_catalog_master_links
FOR EACH ROW EXECUTE FUNCTION public.assert_helices_master_link_family();

CREATE OR REPLACE FUNCTION public.prevent_linked_master_item_family_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.family IS DISTINCT FROM OLD.family AND EXISTS (SELECT 1 FROM public.legacy_catalog_master_links WHERE master_item_id = OLD.id) THEN
    RAISE EXCEPTION 'master_items.family cannot change while legacy catalog link history exists';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER master_items_linked_family_immutable
BEFORE UPDATE OF family ON public.master_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_linked_master_item_family_change();

CREATE OR REPLACE FUNCTION public.protect_legacy_catalog_master_link_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.family IS DISTINCT FROM OLD.family OR NEW.legacy_namespace IS DISTINCT FROM OLD.legacy_namespace OR NEW.legacy_origin_uid IS DISTINCT FROM OLD.legacy_origin_uid OR NEW.master_item_id IS DISTINCT FROM OLD.master_item_id OR NEW.reconciliation_method IS DISTINCT FROM OLD.reconciliation_method OR NEW.reconciliation_evidence IS DISTINCT FROM OLD.reconciliation_evidence OR NEW.linked_by IS DISTINCT FROM OLD.linked_by OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'legacy catalog link identity and reconciliation evidence are immutable';
  END IF;
  IF OLD.status = 'unlinked' THEN RAISE EXCEPTION 'legacy catalog link history cannot be reactivated or changed'; END IF;
  IF NEW.status <> 'unlinked' OR NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'legacy catalog link may only be unlinked with next version'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legacy_catalog_master_links_history_guard
BEFORE UPDATE ON public.legacy_catalog_master_links
FOR EACH ROW EXECUTE FUNCTION public.protect_legacy_catalog_master_link_history();
