CREATE TABLE public.master_item_idempotency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation character varying(64) NOT NULL,
  event_key character varying(160) NOT NULL,
  payload_hash character(64) NOT NULL,
  resource_item_id uuid NOT NULL,
  result jsonb NOT NULL,
  actor character varying(100) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT master_item_idempotency_events_operation_check CHECK (operation = btrim(operation) AND operation ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT master_item_idempotency_events_event_key_check CHECK (event_key = btrim(event_key) AND char_length(event_key) BETWEEN 1 AND 160),
  CONSTRAINT master_item_idempotency_events_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT master_item_idempotency_events_resource_item_id_fkey FOREIGN KEY (resource_item_id) REFERENCES public.master_items(id) ON DELETE RESTRICT,
  CONSTRAINT master_item_idempotency_events_result_check CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT master_item_idempotency_events_actor_check CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
  CONSTRAINT master_item_idempotency_events_operation_event_key_key UNIQUE (operation, event_key)
);

CREATE INDEX idx_master_item_idempotency_events_resource_item_id
  ON public.master_item_idempotency_events (resource_item_id);

CREATE TABLE public.master_item_sku_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  old_primary_sku text NOT NULL,
  old_primary_sku_normalized text NOT NULL,
  new_primary_sku text NOT NULL,
  new_primary_sku_normalized text NOT NULL,
  old_version integer NOT NULL,
  new_version integer NOT NULL,
  actor character varying(100) NOT NULL,
  changed_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT master_item_sku_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.master_items(id) ON DELETE RESTRICT,
  CONSTRAINT master_item_sku_history_old_sku_check CHECK (old_primary_sku = btrim(old_primary_sku) AND char_length(old_primary_sku) BETWEEN 1 AND 120),
  CONSTRAINT master_item_sku_history_new_sku_check CHECK (new_primary_sku = btrim(new_primary_sku) AND char_length(new_primary_sku) BETWEEN 1 AND 120),
  CONSTRAINT master_item_sku_history_old_normalized_check CHECK (old_primary_sku_normalized = public.master_identifier_normalize(old_primary_sku)),
  CONSTRAINT master_item_sku_history_new_normalized_check CHECK (new_primary_sku_normalized = public.master_identifier_normalize(new_primary_sku)),
  CONSTRAINT master_item_sku_history_version_check CHECK (old_version >= 1 AND new_version = old_version + 1),
  CONSTRAINT master_item_sku_history_actor_check CHECK (char_length(btrim(actor)) BETWEEN 1 AND 100),
  CONSTRAINT master_item_sku_history_item_new_version_key UNIQUE (item_id, new_version)
);

CREATE INDEX idx_master_item_sku_history_item_changed_at
  ON public.master_item_sku_history (item_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.master_item_sku_change_requires_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.master_item_sku_history history
    WHERE history.item_id = NEW.id
      AND history.old_primary_sku = OLD.primary_sku
      AND history.old_primary_sku_normalized = OLD.primary_sku_normalized
      AND history.new_primary_sku = NEW.primary_sku
      AND history.new_primary_sku_normalized = NEW.primary_sku_normalized
      AND history.old_version = OLD.version
      AND history.new_version = NEW.version
      AND history.actor = NEW.updated_by
  ) THEN
    RAISE EXCEPTION 'master_items.primary_sku change requires matching master_item_sku_history in the same transaction';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER master_items_sku_history_required
AFTER UPDATE OF primary_sku ON public.master_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.master_item_sku_change_requires_history();

CREATE OR REPLACE FUNCTION public.prevent_master_item_sku_history_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'master_item_sku_history is immutable';
END;
$$;

CREATE TRIGGER master_item_sku_history_immutable
BEFORE UPDATE OR DELETE ON public.master_item_sku_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_master_item_sku_history_change();
