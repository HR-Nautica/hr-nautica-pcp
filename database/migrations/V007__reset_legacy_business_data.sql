-- Corte autorizado em 2026-10-28: reinicia os dados de negocio e preserva
-- autenticacao, infraestrutura e o historico de migrations.
TRUNCATE TABLE
  public.product_catalog_import_issues,
  public.product_catalog_imports,
  public.product_supplier_links,
  public.product_routing_steps,
  public.product_bom_lines,
  public.product_stock_balances,
  public.product_suppliers,
  public.production_steps,
  public.legacy_catalog_master_links,
  public.master_item_sku_history,
  public.master_item_idempotency_events,
  public.item_aliases,
  public.master_items,
  public.helice_production_orders,
  public.temp_analise_producao,
  public.app_state,
  public.app_revision,
  public.app_schema,
  public.audit_log,
  public.users
RESTART IDENTITY CASCADE;
