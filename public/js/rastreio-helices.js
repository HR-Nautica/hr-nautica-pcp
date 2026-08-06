"use strict";

(() => {
  const state = {
    orders: [],
    loaded: false,
    loading: false,
    listenersInitialized: false
  };

  const byId = id => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
  }

  function currentOperation(order) {
    return (order.operations || []).find(operation => operation.code === order.currentOperation) || {
      code: order.currentOperation,
      name: order.currentOperationName || "Operação"
    };
  }

  function renderOperationFlow(order) {
    const current = Number.parseInt(order.currentOperation, 10) || 1;
    return `<div class="helice-op-flow" aria-label="Fluxo das nove operações">
      ${(order.operations || []).map((operation, index) => {
        const position = index + 1;
        const cssClass = position < current ? "is-complete" : position === current ? "is-current" : "";
        const qty = operation.quantity === null || operation.quantity === undefined ? "Sem registro" : `${formatNumber(operation.quantity)} peças`;
        return `<span class="helice-op-step ${cssClass}" title="${escapeHtml(operation.name)}: ${qty}">${position}</span>`;
      }).join("")}
    </div>`;
  }

  function filteredOrders() {
    const search = String(byId("fluxo-search")?.value || "").trim().toLowerCase();
    const operation = byId("fluxo-filter-op")?.value || "";
    const status = byId("fluxo-filter-status")?.value || "";
    return state.orders.filter(order => {
      const matchesSearch = !search || [order.opNumber, order.sku, order.description, order.rawCode]
        .some(value => String(value || "").toLowerCase().includes(search));
      return matchesSearch && (!operation || order.currentOperation === operation) && (!status || order.status === status);
    });
  }

  function updateKpis() {
    const active = state.orders.filter(order => order.status !== "finalizada");
    const finished = state.orders.filter(order => order.status === "finalizada");
    const uniqueSkus = new Set(active.map(order => order.sku)).size;
    const activeQuantity = active.reduce((sum, order) => sum + (Number(order.quantity) || 0), 0);
    if (byId("fkpi-total")) byId("fkpi-total").textContent = formatNumber(active.length);
    if (byId("fkpi-atencao")) byId("fkpi-atencao").textContent = formatNumber(finished.length);
    if (byId("fkpi-bloqueadas")) byId("fkpi-bloqueadas").textContent = formatNumber(uniqueSkus);
    if (byId("fkpi-concluidas")) byId("fkpi-concluidas").textContent = formatNumber(activeQuantity);
  }

  function renderRows() {
    const tbody = byId("fluxo-body");
    if (!tbody) return;
    const orders = filteredOrders();
    updateKpis();
    if (byId("fluxo-count-label")) byId("fluxo-count-label").textContent = `${orders.length} ${orders.length === 1 ? "OP" : "OPs"}`;

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Nenhuma OP encontrada para os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(order => {
      const operation = currentOperation(order);
      const finalized = order.status === "finalizada";
      return `<tr class="${finalized ? "helice-op-row--finished" : ""}">
        <td><strong class="helice-op-number">${escapeHtml(order.opNumber)}</strong></td>
        <td><span class="chip chip--blue helice-op-sku">${escapeHtml(order.sku)}</span></td>
        <td class="helice-op-description"><strong>${escapeHtml(order.description)}</strong><small>${escapeHtml(order.rawCode || "Sem código bruto")}</small></td>
        <td><strong>${formatNumber(order.quantity)}</strong></td>
        <td><span class="helice-op-priority">${escapeHtml(order.priority || "Normal")}</span></td>
        <td><span class="helice-current-operation"><b>${escapeHtml(operation.code)}</b>${escapeHtml(operation.name.replace(/^\d+\s*-\s*/, ""))}</span></td>
        <td>${renderOperationFlow(order)}</td>
        <td>${formatDate(order.entryDate)}</td>
        <td><span class="chip ${finalized ? "chip--green" : "chip--orange"}">${finalized ? "Finalizada" : "Em produção"}</span></td>
        <td>${finalized
          ? `<span class="helice-finished-label">✓ ${formatDate(order.finishedAt)}</span>`
          : `<button class="btn-primary helice-finalize-btn" data-order-id="${escapeHtml(order.id)}">Finalizar</button>`}
        </td>
      </tr>`;
    }).join("");
  }

  async function load(force = false) {
    if (state.loading || (state.loaded && !force)) return;
    state.loading = true;
    const tbody = byId("fluxo-body");
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Carregando OPs de hélices do Supabase...</td></tr>';
    try {
      const response = await fetch("/api/helice-ops", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar as OPs.");
      state.orders = Array.isArray(payload.orders) ? payload.orders : [];
      state.loaded = true;
      renderRows();
    } catch (error) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
      if (typeof showToast === "function") showToast(error.message, "error");
    } finally {
      state.loading = false;
    }
  }

  async function finalize(orderId) {
    const order = state.orders.find(item => String(item.id) === String(orderId));
    if (!order || order.status === "finalizada") return;
    if (!window.confirm(`Finalizar a ${order.opNumber} (${order.sku})?`)) return;
    try {
      const response = await fetch(`/api/helice-ops/${encodeURIComponent(orderId)}/finalize`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-PCP-User": window.PCP_CURRENT_USER || ""
        },
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível finalizar a OP.");
      state.orders = state.orders.map(item => String(item.id) === String(orderId) ? payload.order : item);
      renderRows();
      if (typeof showToast === "function") showToast(`${order.opNumber} finalizada com sucesso!`);
    } catch (error) {
      if (typeof showToast === "function") showToast(error.message, "error");
    }
  }

  function initListeners() {
    if (state.listenersInitialized) return;
    state.listenersInitialized = true;
    byId("btn-refresh-helice-ops")?.addEventListener("click", () => load(true));
    byId("fluxo-body")?.addEventListener("click", event => {
      const button = event.target.closest(".helice-finalize-btn");
      if (button) finalize(button.dataset.orderId);
    });
  }

  window.RastreioHelices = {
    render() {
      initListeners();
      if (!state.loaded) load();
      else renderRows();
    },
    load,
    finalize,
    _state: state
  };
})();
