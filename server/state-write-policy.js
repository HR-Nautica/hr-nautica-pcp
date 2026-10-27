const WRITE_RULES = new Map([
  ["hrn_analise_cobertura_alvo", new Set(["PUT"])],
  ["hrn_analise_op_sugerida", new Set(["PUT"])],
  ["hrn_atividades", new Set(["PUT"])],
  ["hrn_buchas", new Set(["PUT"])],
  ["hrn_coquilhas_catalog", new Set(["PUT"])],
  ["hrn_coquilhas_pesos", new Set(["PUT"])],
  ["hrn_earv_estoque", new Set(["PUT"])],
  ["hrn_earv_meta", new Set(["PUT"])],
  ["hrn_earv_quantidades_usuario", new Set(["PUT"])],
  ["hrn_earv_saidas_periodo", new Set(["PUT"])],
  ["hrn_earv_saidas_previstas", new Set(["PUT"])],
  ["hrn_estoque_arvore", new Set(["PUT"])],
  ["hrn_fundicao_catalog", new Set(["PUT"])],
  ["hrn_manutencoes", new Set(["PUT"])],
  ["hrn_modelos", new Set(["PUT"])],
  ["hrn_pedidos", new Set(["PUT"])],
  ["hrn_prod_comp_entradas", new Set(["DELETE"])],
  ["hrn_prod_comp_ops", new Set(["PUT"])],
  ["hrn_solicitacoes_acesso", new Set(["PUT"])],
  ["hrn_vini_entradas", new Set(["PUT", "DELETE"])],
  ["hrn_vini_expanded_comps", new Set(["PUT"])],
  ["hrn_vini_expanded_items", new Set(["PUT"])],
  ["hrn_vini_fabri_data", new Set(["PUT"])],
  ["hrn_vini_fornecedores_map", new Set(["PUT"])],
  ["hrn_vini_inativados", new Set(["PUT"])],
  ["hrn_vini_materiais_usuario", new Set(["PUT"])],
  ["hrn_vini_necessidades", new Set(["PUT"])],
]);

export const PROTECTED_STATE_KEYS = Object.freeze({
  hrn_ops: "/api/production-ops",
  hrn_materiais: "/api/inventory/materials",
  hrn_movimentos: "/api/inventory/movements",
  hrn_fundicoes: "/api/fundicao-ops",
  hrn_buchas_ops: null,
  hrn_buchas_entradas: "/api/buchas/entries",
  hrn_buchas_saidas: "/api/buchas/outputs",
  hrn_pecas: "/api/production-tracking/reconcile",
  hrn_config: null,
});

export function genericStateWriteDecision(key, method) {
  const normalizedMethod = String(method || "").toUpperCase();
  const allowed = WRITE_RULES.get(String(key));
  if (allowed?.has(normalizedMethod)) return { allowed: true };
  return { allowed: false, code: "GENERIC_STATE_WRITE_FORBIDDEN", specificApi: PROTECTED_STATE_KEYS[key] || null };
}

export function assertGenericStateWriteAllowed(key, method) {
  const decision = genericStateWriteDecision(key, method);
  if (decision.allowed) return;
  const error = new Error("Escrita generica proibida para esta chave.");
  error.status = 403;
  error.code = decision.code;
  error.specificApi = decision.specificApi;
  throw error;
}
