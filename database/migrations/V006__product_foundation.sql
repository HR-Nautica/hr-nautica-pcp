ALTER TABLE public.master_items
  ADD COLUMN item_type character varying(64),
  ADD COLUMN basic_characteristics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN tiny_import_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.master_items
  ADD CONSTRAINT master_items_item_type_check CHECK (
    item_type IS NULL OR (item_type = btrim(item_type) AND char_length(item_type) BETWEEN 1 AND 64)
  ),
  ADD CONSTRAINT master_items_basic_characteristics_check CHECK (jsonb_typeof(basic_characteristics) = 'object'),
  ADD CONSTRAINT master_items_source_metadata_check CHECK (jsonb_typeof(source_metadata) = 'object');

CREATE TABLE public.product_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  tax_id text,
  email text,
  phone text,
  notes text,
  status character varying(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL,
  updated_by character varying(100) NOT NULL,
  CONSTRAINT product_suppliers_legal_name_check CHECK (legal_name = btrim(legal_name) AND char_length(legal_name) BETWEEN 1 AND 300),
  CONSTRAINT product_suppliers_trade_name_check CHECK (trade_name IS NULL OR char_length(btrim(trade_name)) BETWEEN 1 AND 300),
  CONSTRAINT product_suppliers_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT product_suppliers_version_check CHECK (version >= 1),
  CONSTRAINT product_suppliers_actor_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100 AND char_length(btrim(updated_by)) BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX product_suppliers_tax_id_key
  ON public.product_suppliers (public.master_identifier_normalize(tax_id))
  WHERE tax_id IS NOT NULL AND btrim(tax_id) <> '';

CREATE TABLE public.production_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  code_normalized text GENERATED ALWAYS AS (public.master_identifier_normalize(code)) STORED,
  name text NOT NULL,
  description text,
  status character varying(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL,
  updated_by character varying(100) NOT NULL,
  CONSTRAINT production_steps_code_check CHECK (code = btrim(code) AND char_length(code) BETWEEN 1 AND 80),
  CONSTRAINT production_steps_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT production_steps_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT production_steps_version_check CHECK (version >= 1),
  CONSTRAINT production_steps_actor_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100 AND char_length(btrim(updated_by)) BETWEEN 1 AND 100),
  CONSTRAINT production_steps_code_normalized_key UNIQUE (code_normalized)
);

CREATE TABLE public.product_routing_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  production_step_id uuid NOT NULL REFERENCES public.production_steps(id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  instructions text,
  setup_minutes numeric(14,4),
  run_minutes numeric(14,4),
  status character varying(16) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL,
  updated_by character varying(100) NOT NULL,
  CONSTRAINT product_routing_steps_sequence_check CHECK (sequence >= 1),
  CONSTRAINT product_routing_steps_time_check CHECK ((setup_minutes IS NULL OR setup_minutes >= 0) AND (run_minutes IS NULL OR run_minutes >= 0)),
  CONSTRAINT product_routing_steps_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT product_routing_steps_version_check CHECK (version >= 1),
  CONSTRAINT product_routing_steps_actor_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100 AND char_length(btrim(updated_by)) BETWEEN 1 AND 100),
  CONSTRAINT product_routing_steps_product_sequence_key UNIQUE (product_id, sequence)
);

CREATE TABLE public.product_bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  child_product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  quantity numeric(20,8),
  unit character varying(32),
  level_code character varying(32),
  link_status character varying(16) NOT NULL DEFAULT 'active',
  source_line_id text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL,
  updated_by character varying(100) NOT NULL,
  CONSTRAINT product_bom_lines_no_self_reference CHECK (parent_product_id <> child_product_id),
  CONSTRAINT product_bom_lines_quantity_check CHECK ((link_status = 'active' AND quantity > 0) OR (link_status IN ('pending', 'review', 'inactive') AND (quantity IS NULL OR quantity > 0))),
  CONSTRAINT product_bom_lines_unit_check CHECK (unit IS NULL OR char_length(btrim(unit)) BETWEEN 1 AND 32),
  CONSTRAINT product_bom_lines_status_check CHECK (link_status IN ('active', 'pending', 'review', 'inactive')),
  CONSTRAINT product_bom_lines_source_id_check CHECK (source_line_id = btrim(source_line_id) AND char_length(source_line_id) BETWEEN 1 AND 240),
  CONSTRAINT product_bom_lines_source_payload_check CHECK (jsonb_typeof(source_payload) = 'object'),
  CONSTRAINT product_bom_lines_version_check CHECK (version >= 1),
  CONSTRAINT product_bom_lines_actor_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100 AND char_length(btrim(updated_by)) BETWEEN 1 AND 100),
  CONSTRAINT product_bom_lines_source_line_id_key UNIQUE (source_line_id)
);

CREATE INDEX idx_product_bom_lines_parent_status ON public.product_bom_lines (parent_product_id, link_status);
CREATE INDEX idx_product_bom_lines_child_status ON public.product_bom_lines (child_product_id, link_status);

CREATE TABLE public.product_supplier_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.master_items(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.product_suppliers(id) ON DELETE RESTRICT,
  supplier_sku text,
  lead_time_days integer,
  preferred boolean NOT NULL DEFAULT false,
  status character varying(16) NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by character varying(100) NOT NULL,
  CONSTRAINT product_supplier_links_lead_time_check CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  CONSTRAINT product_supplier_links_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT product_supplier_links_actor_check CHECK (char_length(btrim(created_by)) BETWEEN 1 AND 100),
  CONSTRAINT product_supplier_links_product_supplier_key UNIQUE (product_id, supplier_id)
);

CREATE TABLE public.product_stock_balances (
  product_id uuid PRIMARY KEY REFERENCES public.master_items(id) ON DELETE RESTRICT,
  physical_quantity numeric(20,8),
  stock_authority character varying(24) NOT NULL DEFAULT 'erp',
  source_position_at timestamp with time zone,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by character varying(100) NOT NULL,
  CONSTRAINT product_stock_balances_authority_check CHECK (stock_authority IN ('erp', 'tiny_import')),
  CONSTRAINT product_stock_balances_version_check CHECK (version >= 1),
  CONSTRAINT product_stock_balances_actor_check CHECK (char_length(btrim(updated_by)) BETWEEN 1 AND 100)
);

CREATE TABLE public.product_catalog_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checksum character(64) NOT NULL,
  source_name text NOT NULL,
  source_schema character varying(64) NOT NULL,
  status character varying(16) NOT NULL,
  item_count integer NOT NULL,
  bom_line_count integer NOT NULL,
  active_bom_line_count integer NOT NULL,
  pending_bom_line_count integer NOT NULL,
  imported_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  imported_by character varying(100) NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT product_catalog_imports_checksum_check CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT product_catalog_imports_source_name_check CHECK (char_length(btrim(source_name)) BETWEEN 1 AND 300),
  CONSTRAINT product_catalog_imports_source_schema_check CHECK (source_schema = btrim(source_schema) AND char_length(source_schema) BETWEEN 1 AND 64),
  CONSTRAINT product_catalog_imports_status_check CHECK (status IN ('completed', 'failed')),
  CONSTRAINT product_catalog_imports_counts_check CHECK (item_count >= 0 AND bom_line_count >= 0 AND active_bom_line_count >= 0 AND pending_bom_line_count >= 0),
  CONSTRAINT product_catalog_imports_actor_check CHECK (char_length(btrim(imported_by)) BETWEEN 1 AND 100),
  CONSTRAINT product_catalog_imports_result_check CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT product_catalog_imports_checksum_key UNIQUE (checksum)
);

CREATE TABLE public.product_catalog_import_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.product_catalog_imports(id) ON DELETE RESTRICT,
  source_sheet text NOT NULL,
  source_row integer,
  issue_code character varying(64) NOT NULL,
  detail text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT product_catalog_import_issues_sheet_check CHECK (char_length(btrim(source_sheet)) BETWEEN 1 AND 120),
  CONSTRAINT product_catalog_import_issues_row_check CHECK (source_row IS NULL OR source_row >= 1),
  CONSTRAINT product_catalog_import_issues_code_check CHECK (issue_code = btrim(issue_code) AND issue_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT product_catalog_import_issues_detail_check CHECK (char_length(btrim(detail)) BETWEEN 1 AND 1000),
  CONSTRAINT product_catalog_import_issues_payload_check CHECK (jsonb_typeof(source_payload) = 'object')
);

CREATE INDEX idx_product_catalog_import_issues_import ON public.product_catalog_import_issues (import_id, issue_code);
