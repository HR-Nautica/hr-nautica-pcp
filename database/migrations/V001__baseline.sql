-- Baseline canônico derivado de database/schema-atual-ubuntu.sql (PostgreSQL 17.6).
-- Não executar este arquivo para adoção de bancos existentes; use db:baseline.

COMMENT ON SCHEMA public IS 'standard public schema';

CREATE TABLE public.app_revision (
  singleton character varying(16) NOT NULL,
  revision integer NOT NULL,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.app_schema (
  id character varying(255) NOT NULL,
  content text NOT NULL,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.app_state (
  key character varying(100) NOT NULL,
  value text NOT NULL,
  version integer NOT NULL,
  updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.audit_log (
  id integer NOT NULL,
  state_key character varying(100) NOT NULL,
  action character varying(16) NOT NULL,
  version integer NOT NULL,
  payload text,
  actor character varying(100),
  created_at timestamp without time zone NOT NULL
);

CREATE SEQUENCE public.audit_log_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

CREATE SEQUENCE public.helice_op_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE public.helice_production_orders (
  id bigint NOT NULL,
  op_number character varying(24) DEFAULT ('OPH-'::text || lpad((nextval('public.helice_op_number_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
  source_key character varying(255) NOT NULL,
  source_file text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL,
  entry_date date,
  description text NOT NULL,
  priority text,
  sku character varying(120) NOT NULL,
  raw_code character varying(120),
  operations jsonb DEFAULT '[]'::jsonb NOT NULL,
  current_operation character varying(2) DEFAULT '01'::character varying NOT NULL,
  current_operation_name text,
  quantity integer DEFAULT 0 NOT NULL,
  spreadsheet_location text,
  elapsed_time text,
  status character varying(24) DEFAULT 'em_producao'::character varying NOT NULL,
  finished_at timestamp with time zone,
  imported_by character varying(100),
  imported_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_by character varying(100),
  operation_history jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE SEQUENCE public.helice_production_orders_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.helice_production_orders_id_seq OWNED BY public.helice_production_orders.id;

CREATE TABLE public.temp_analise_producao (
  id bigint NOT NULL,
  batch_id uuid NOT NULL,
  source_row integer NOT NULL,
  sku character varying(120),
  produto text,
  codigo_bruto character varying(120),
  saidas_previstas numeric(14,3) DEFAULT 0 NOT NULL,
  estoque_fisico numeric(14,3) DEFAULT 0 NOT NULL,
  media_mensal numeric(14,3) DEFAULT 0 NOT NULL,
  imported_by character varying(100),
  imported_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.temp_analise_producao_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.temp_analise_producao_id_seq OWNED BY public.temp_analise_producao.id;

CREATE TABLE public.users (
  id bigint NOT NULL,
  email text NOT NULL,
  name text,
  created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.users_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);
ALTER TABLE ONLY public.helice_production_orders ALTER COLUMN id SET DEFAULT nextval('public.helice_production_orders_id_seq'::regclass);
ALTER TABLE ONLY public.temp_analise_producao ALTER COLUMN id SET DEFAULT nextval('public.temp_analise_producao_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

ALTER TABLE ONLY public.app_revision ADD CONSTRAINT app_revision_pkey PRIMARY KEY (singleton);
ALTER TABLE ONLY public.app_schema ADD CONSTRAINT app_schema_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_state ADD CONSTRAINT app_state_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.helice_production_orders ADD CONSTRAINT helice_production_orders_op_number_key UNIQUE (op_number);
ALTER TABLE ONLY public.helice_production_orders ADD CONSTRAINT helice_production_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.helice_production_orders ADD CONSTRAINT helice_production_orders_source_key_key UNIQUE (source_key);
ALTER TABLE ONLY public.temp_analise_producao ADD CONSTRAINT temp_analise_producao_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_log_state_key ON public.audit_log USING btree (state_key);
CREATE INDEX idx_helice_production_orders_status ON public.helice_production_orders USING btree (status, current_operation, op_number);
CREATE INDEX idx_temp_analise_producao_batch ON public.temp_analise_producao USING btree (batch_id, source_row);
