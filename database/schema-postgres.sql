-- Schema para PostgreSQL (Supabase)

CREATE TABLE IF NOT EXISTS app_revision (
  singleton VARCHAR(16) PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  state_key VARCHAR(100) NOT NULL,
  action VARCHAR(16) NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT,
  actor VARCHAR(100),
  created_at TIMESTAMP NOT NULL
);

-- Tabela de estágio: o lote mais recente substitui os dados da importação anterior.
CREATE TABLE IF NOT EXISTS temp_analise_producao (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  source_row INTEGER NOT NULL,
  sku VARCHAR(120),
  produto TEXT,
  codigo_bruto VARCHAR(120),
  saidas_previstas NUMERIC(14, 3) NOT NULL DEFAULT 0,
  estoque_fisico NUMERIC(14, 3) NOT NULL DEFAULT 0,
  media_mensal NUMERIC(14, 3) NOT NULL DEFAULT 0,
  imported_by VARCHAR(100),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temp_analise_producao_batch
  ON temp_analise_producao (batch_id, source_row);
