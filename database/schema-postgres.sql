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
