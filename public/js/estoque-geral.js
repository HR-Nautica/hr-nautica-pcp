"use strict";

const ESTOQUE_GERAL = { items: [], summary: null, page: 1, pageSize: 25, sort: "code", direction: "asc", initialized: false };
const eg = (id) => document.getElementById(id);
const egEscape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const egNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value)) : "Não configurado";
const egDate = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Não informado";

function egSourceGroup(source) {
  const value = String(source || "").toLocaleLowerCase("pt-BR");
  if (value.includes("excel")) return "excel";
  if (value.includes("movimenta")) return "erp";
  return "pending";
}
function egStatus(item) {
  if (item.identityStatus === "ambiguous") return ["Atenção", "warning", "Identidade precisa de reconciliação"];
  if (item.catalogStatus === "reconciliation_pending") return ["Sem catálogo", "warning", "Registro de saldo sem cadastro confirmado"];
  if (item.stockStatus === "pending") return ["Fonte pendente", "muted", "Saldo físico não configurado"];
  if (item.stockStatus === "zero") return ["Físico zero", "danger", "Saldo físico confirmado como zero"];
  return ["Saldo físico", "success", "Saldo físico confirmado"];
}
function egFiltered() {
  const query = String(eg("estoque-geral-search")?.value || "").trim().toLocaleLowerCase("pt-BR");
  const family = eg("estoque-geral-family")?.value || "";
  const type = eg("estoque-geral-type")?.value || "";
  const stockStatus = eg("estoque-geral-stock-status")?.value || "";
  const source = eg("estoque-geral-source")?.value || "";
  const filtered = ESTOQUE_GERAL.items.filter((item) => {
    const searchable = [item.code, item.description, item.sourceIdentifier, item.familyLabel, item.typeLabel, ...(item.bom || []).map(line => `${line.role} ${line.code}`)].join(" ").toLocaleLowerCase("pt-BR");
    return (!query || searchable.includes(query)) && (!family || item.family === family) && (!type || (item.itemTypes || []).includes(type)) && (!stockStatus || item.stockStatus === stockStatus) && (!source || egSourceGroup(item.source) === source);
  });
  return filtered.sort((a, b) => {
    let av = a[ESTOQUE_GERAL.sort]; let bv = b[ESTOQUE_GERAL.sort];
    if (ESTOQUE_GERAL.sort === "physicalStock") { av = av === null ? Number.NEGATIVE_INFINITY : Number(av); bv = bv === null ? Number.NEGATIVE_INFINITY : Number(bv); return (av - bv) * (ESTOQUE_GERAL.direction === "asc" ? 1 : -1); }
    return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR", { numeric: true, sensitivity: "base" }) * (ESTOQUE_GERAL.direction === "asc" ? 1 : -1);
  });
}
function egRenderPagination(total) {
  const root = eg("estoque-geral-pagination"); if (!root) return;
  const pages = Math.max(1, Math.ceil(total / ESTOQUE_GERAL.pageSize));
  ESTOQUE_GERAL.page = Math.min(ESTOQUE_GERAL.page, pages);
  root.innerHTML = `<span>Página ${ESTOQUE_GERAL.page} de ${pages}</span><div><button class="btn-secondary" type="button" data-eg-page="prev" ${ESTOQUE_GERAL.page === 1 ? "disabled" : ""}>Anterior</button><button class="btn-secondary" type="button" data-eg-page="next" ${ESTOQUE_GERAL.page === pages ? "disabled" : ""}>Próxima</button></div>`;
  root.querySelectorAll("button[data-eg-page]").forEach((button) => button.addEventListener("click", () => { ESTOQUE_GERAL.page += button.dataset.egPage === "next" ? 1 : -1; egRender(); }));
}
function egRender() {
  const tbody = eg("estoque-geral-body"); if (!tbody) return;
  const items = egFiltered(); const start = (ESTOQUE_GERAL.page - 1) * ESTOQUE_GERAL.pageSize; const pageItems = items.slice(start, start + ESTOQUE_GERAL.pageSize);
  eg("estoque-geral-count").textContent = `${items.length} produto${items.length === 1 ? "" : "s"} encontrado${items.length === 1 ? "" : "s"}`;
  if (!pageItems.length) tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Nenhum produto corresponde aos filtros aplicados.</td></tr>';
  else tbody.innerHTML = pageItems.map((item) => {
    const [label, tone, tip] = egStatus(item);
    return `<tr><td class="estoque-geral-code">${egEscape(item.code || "—")}</td><td><strong>${egEscape(item.description)}</strong><small>${egEscape(item.source || "Fonte pendente")}</small></td><td>${egEscape(item.familyLabel)}</td><td>${egEscape(item.typeLabel || "Não classificado")}</td><td class="estoque-geral-number">${egNumber(item.physicalStock)}</td><td class="estoque-geral-number estoque-geral-unknown">Não configurado</td><td class="estoque-geral-number estoque-geral-unknown">Não configurado</td><td>${egEscape(item.unit)}</td><td><span class="estoque-geral-status estoque-geral-status--${tone}" title="${egEscape(tip)}">${label}</span></td><td><button type="button" class="btn-ghost estoque-geral-detail" data-eg-id="${egEscape(item.id)}">Detalhes</button></td></tr>`;
  }).join("");
  tbody.querySelectorAll("[data-eg-id]").forEach((button) => button.addEventListener("click", () => egOpenDetail(button.dataset.egId)));
  egRenderPagination(items.length);
}
function egOpenDetail(id) {
  const item = ESTOQUE_GERAL.items.find((row) => row.id === id); if (!item) return;
  const modal = eg("modal-estoque-geral");
  eg("estoque-geral-modal-family").textContent = item.familyLabel;
  eg("estoque-geral-modal-title").textContent = item.description;
  const master = item.masterItemId ? egEscape(item.masterItemId) : "Não vinculado";
  const authority = item.authorityMode === "sync" ? "Sincronizar Estoque" : "Gerenciado pelo ERP";
  const blockers = (item.sourceSwitchBlockers || []).map(reason => `<li>${egEscape(reason)}</li>`).join("");
  const sourceControl = `<section class="estoque-geral-bom"><h3>Gestão do saldo</h3><p>Modo atual: <strong>${authority}</strong>. A troca por item será habilitada quando a identidade, a transferência do saldo e os fluxos de escrita estiverem preparados.</p>${blockers ? `<p>Pendências deste item:</p><ul>${blockers}</ul>` : ""}</section>`;
  const bom = (item.bom || []).length ? `<section class="estoque-geral-bom"><h3>Estrutura técnica</h3><p>Relações do cadastro para consulta; ainda não são uma BOM publicada. Quantidade aparece apenas quando registrada na árvore.</p><ul>${item.bom.map(line => `<li><span><strong>${egEscape(line.role)}</strong><small>${egEscape(line.code)} · ${line.quantity === null ? "Quantidade não informada" : `${egNumber(line.quantity)} ${egEscape(line.unit || item.unit)}`}</small></span>${line.targetId ? `<button type="button" class="btn-ghost estoque-geral-detail" data-eg-target="${egEscape(line.targetId)}">Ver item</button>` : `<span class="estoque-geral-bom__pending">${line.status === "ambiguous" ? "Vínculo ambíguo" : "Sem cadastro correspondente"}</span>`}</li>`).join("")}</ul></section>` : `<p class="estoque-geral-detail-note">Nenhuma relação técnica cadastrada para este item.</p>`;
  eg("estoque-geral-modal-body").innerHTML = `<dl class="estoque-geral-detail-grid"><div><dt>Código principal</dt><dd>${egEscape(item.code || "—")}</dd></div><div><dt>Tipo</dt><dd>${egEscape(item.typeLabel || "Não classificado")}</dd></div><div><dt>Catálogo</dt><dd>${egEscape(item.catalogSource || item.familyLabel)}</dd></div><div><dt>Unidade</dt><dd>${egEscape(item.unit)}</dd></div><div><dt>Identificador de origem</dt><dd>${egEscape(item.sourceIdentifier || "Não informado")}</dd></div><div><dt>Item Mestre</dt><dd>${master}</dd></div><div><dt>Estoque físico</dt><dd>${egNumber(item.physicalStock)}</dd></div><div><dt>Reservado</dt><dd>Não configurado</dd></div><div><dt>Disponível</dt><dd>Não configurado</dd></div><div><dt>Fonte do saldo</dt><dd>${egEscape(item.source || "Fonte pendente")}</dd></div><div><dt>Última atualização</dt><dd>${egDate(item.updatedAt)}</dd></div><div><dt>Localização</dt><dd>${egEscape(item.location || "Não informado")}</dd></div><div><dt>Identidade</dt><dd>${item.identityStatus === "confirmed" ? "Confirmada na fonte" : "Requer reconciliação"}</dd></div></dl>${sourceControl}${bom}`;
  eg("estoque-geral-modal-body").querySelectorAll("[data-eg-target]").forEach(button => button.addEventListener("click", () => egOpenDetail(button.dataset.egTarget)));
  modal?.classList.remove("hidden"); modal?.setAttribute("aria-hidden", "false"); eg("estoque-geral-modal-close")?.focus();
}
function egCloseDetail() { const modal = eg("modal-estoque-geral"); modal?.classList.add("hidden"); modal?.setAttribute("aria-hidden", "true"); }
async function egLoad() {
  const state = eg("estoque-geral-state"); if (state) state.textContent = "Atualizando fontes oficiais…";
  try {
    const response = await fetch("/api/estoque-geral", { cache: "no-store" }); const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o Estoque Geral.");
    ESTOQUE_GERAL.items = Array.isArray(payload.items) ? payload.items : []; ESTOQUE_GERAL.summary = payload.summary || {};
    eg("estoque-geral-total").textContent = payload.summary?.totalActive ?? "—";
    eg("estoque-geral-known").textContent = payload.summary?.physicalKnown ?? "—";
    eg("estoque-geral-zero").textContent = payload.summary?.physicalZero ?? "—";
    eg("estoque-geral-pending").textContent = payload.summary?.balancePending ?? "—";
    const unmatched = payload.summary?.unmatchedSourceRows || {};
    const unmatchedTotal = Object.values(unmatched).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const notice = eg("estoque-geral-notice");
    if (notice) notice.textContent = `Os catálogos definem os itens e seus vínculos técnicos. O saldo vem da fonte oficial de cada família. Reservado e disponível aguardam fonte configurada.${unmatchedTotal ? ` ${unmatchedTotal} posição(ões) de saldo sem cadastro correspondente permanecem fora desta lista e aguardam reconciliação.` : ""}`;
    ESTOQUE_GERAL.page = 1; egRender(); if (state) state.textContent = "";
  } catch (error) {
    if (state) state.textContent = error.message; const body = eg("estoque-geral-body"); if (body) body.innerHTML = `<tr><td colspan="10" class="empty-cell">${egEscape(error.message)}</td></tr>`;
  }
}
function initEstoqueGeral() {
  if (!ESTOQUE_GERAL.initialized) {
    ESTOQUE_GERAL.initialized = true;
    ["estoque-geral-search", "estoque-geral-family", "estoque-geral-type", "estoque-geral-stock-status", "estoque-geral-source"].forEach((id) => eg(id)?.addEventListener(id === "estoque-geral-search" ? "input" : "change", () => { ESTOQUE_GERAL.page = 1; egRender(); }));
    eg("estoque-geral-clear")?.addEventListener("click", () => { ["estoque-geral-search", "estoque-geral-family", "estoque-geral-type", "estoque-geral-stock-status", "estoque-geral-source"].forEach((id) => { if (eg(id)) eg(id).value = ""; }); ESTOQUE_GERAL.page = 1; egRender(); });
    eg("estoque-geral-refresh")?.addEventListener("click", egLoad);
    document.querySelectorAll("[data-estoque-geral-sort]").forEach((button) => button.addEventListener("click", () => { const field = button.dataset.estoqueGeralSort; ESTOQUE_GERAL.direction = ESTOQUE_GERAL.sort === field && ESTOQUE_GERAL.direction === "asc" ? "desc" : "asc"; ESTOQUE_GERAL.sort = field; egRender(); }));
    ["estoque-geral-modal-close", "estoque-geral-modal-done"].forEach((id) => eg(id)?.addEventListener("click", egCloseDetail));
    eg("modal-estoque-geral")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) egCloseDetail(); });
  }
  return egLoad();
}
window.initEstoqueGeral = initEstoqueGeral;
