-- Schema equivalente no Microsoft Access.
-- As tabelas sao criadas automaticamente por scripts/init-db.js via ODBC,
-- porque Access nao suporta CREATE TABLE IF NOT EXISTS da mesma forma que PostgreSQL.

app_revision(singleton TEXT PRIMARY KEY, revision INTEGER, updated_at DATETIME)
app_state(key TEXT PRIMARY KEY, value LONGTEXT, version INTEGER, updated_at DATETIME)
audit_log(id AUTOINCREMENT PRIMARY KEY, state_key TEXT, action TEXT, version INTEGER, payload LONGTEXT, actor TEXT, created_at DATETIME)
