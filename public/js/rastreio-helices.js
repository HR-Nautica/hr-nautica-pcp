"use strict";

(() => {
  const state = {
    orders: [],
    loaded: false,
    loading: false,
    listenersInitialized: false,
    selectedOrderId: null,
    savingMovement: false
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

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
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
      return `<tr class="helice-op-row ${finalized ? "helice-op-row--finished" : ""}" data-order-id="${escapeHtml(order.id)}" tabindex="0">
        <td><strong class="helice-op-number">${escapeHtml(order.opNumber)}</strong></td>
        <td><span class="chip chip--blue helice-op-sku">${escapeHtml(order.sku)}</span></td>
        <td class="helice-op-description"><strong>${escapeHtml(order.description)}</strong><small>${escapeHtml(order.rawCode || "Sem código bruto")}</small></td>
        <td><strong>${formatNumber(order.quantity)}</strong></td>
        <td><span class="helice-op-priority">${escapeHtml(order.priority || "Normal")}</span></td>
        <td><span class="helice-current-operation"><b>${escapeHtml(operation.code)}</b>${escapeHtml(operation.name.replace(/^\d+\s*-\s*/, ""))}</span></td>
        <td>${renderOperationFlow(order)}</td>
        <td>${formatDate(order.entryDate)}</td>
        <td><span class="chip ${finalized ? "chip--green" : "chip--orange"}">${finalized ? "Finalizada" : "Em produção"}</span></td>
        <td><button class="btn-secondary helice-details-btn" data-order-id="${escapeHtml(order.id)}">${finalized ? "Ver histórico" : "Abrir OP"}</button></td>
      </tr>`;
    }).join("");
  }

  function selectedOrder() {
    return state.orders.find(order => String(order.id) === String(state.selectedOrderId));
  }

  function renderDetailModal() {
    const order = selectedOrder();
    if (!order) return;
    const currentIndex = Math.max(0, Number.parseInt(order.currentOperation, 10) - 1);
    const finalized = order.status === "finalizada";
    byId("helice-op-modal-number").textContent = order.opNumber;
    byId("helice-op-modal-title").textContent = order.description;
    byId("helice-op-modal-sku").textContent = `${order.sku} · ${formatNumber(order.quantity)} peças na última operação`;

    byId("helice-operation-stepper").innerHTML = (order.operations || []).map((operation, index) => {
      const registered = operation.quantity !== null && operation.quantity !== undefined;
      const cssClass = index < currentIndex || finalized ? "is-complete" : index === currentIndex ? "is-current" : "";
      return `<div class="helice-operation-card ${cssClass}">
        <span class="helice-operation-index">${index + 1}</span>
        <div><strong>${escapeHtml(operation.name.replace(/^\d+\s*-\s*/, ""))}</strong><small>${registered ? `${formatNumber(operation.quantity)} peças` : "Aguardando"}</small></div>
      </div>`;
    }).join("");

    const operation = currentOperation(order);
    byId("helice-current-operation-title").textContent = `${operation.code} – ${operation.name.replace(/^\d+\s*-\s*/, "")}`;
    byId("helice-current-quantity").textContent = `${formatNumber(order.quantity)} peças`;
    const movementPanel = byId("helice-movement-panel");
    const nextButton = byId("helice-op-next-button");
    movementPanel.classList.toggle("hidden", finalized || currentIndex >= 8);
    nextButton.classList.toggle("hidden", finalized);
    nextButton.textContent = currentIndex >= 8 ? "Finalizar OP" : "Próxima operação";
    nextButton.disabled = state.savingMovement;
    const forwardInput = byId("helice-forward-quantity");
    forwardInput.max = String(Math.max(0, Number(order.quantity) || 0));
    forwardInput.value = String(Math.max(0, Number(order.quantity) || 0));
    byId("helice-scrap-quantity").value = "0";

    const history = Array.isArray(order.operationHistory) ? order.operationHistory : [];
    byId("helice-operation-history").innerHTML = history.length
      ? history.slice().reverse().map(event => event.type === "finish"
        ? `<div class="helice-history-event is-finish"><span>✓</span><div><strong>OP finalizada com ${formatNumber(event.quantity)} peças</strong><small>${formatDateTime(event.at)} · ${escapeHtml(event.actor || "Usuário")}</small></div></div>`
        : `<div class="helice-history-event"><span>${escapeHtml(event.toOperation)}</span><div><strong>${formatNumber(event.forwardedQuantity)} avançaram · ${formatNumber(event.scrapQuantity)} de refugo</strong><small>${escapeHtml(event.fromOperationName)} → ${escapeHtml(event.toOperationName)} · ${formatDateTime(event.at)} · ${escapeHtml(event.actor || "Usuário")}</small></div></div>`
      ).join("")
      : '<div class="helice-history-empty">Nenhuma movimentação manual registrada. As quantidades acima vieram da planilha inicial.</div>';
  }

  function openDetail(orderId) {
    state.selectedOrderId = String(orderId);
    renderDetailModal();
    byId("modal-helice-op-flow")?.classList.remove("hidden");
  }

  function closeDetail() {
    byId("modal-helice-op-flow")?.classList.add("hidden");
    state.selectedOrderId = null;
  }

  function updateScrapPreview() {
    const order = selectedOrder();
    if (!order) return;
    const forwarded = Math.max(0, Number.parseInt(byId("helice-forward-quantity")?.value, 10) || 0);
    byId("helice-scrap-quantity").value = String(Math.max(0, (Number(order.quantity) || 0) - forwarded));
  }

  function notifyOrdersUpdated() {
    window.dispatchEvent(new CustomEvent("helice-ops-updated"));
  }

  async function advanceSelectedOrder() {
    const order = selectedOrder();
    if (!order || state.savingMovement) return;
    if (Number.parseInt(order.currentOperation, 10) >= 9) {
      await finalize(order.id);
      return;
    }

    const forwardQuantity = Math.max(0, Number.parseInt(byId("helice-forward-quantity")?.value, 10) || 0);
    if (forwardQuantity > Number(order.quantity)) {
      showToast(`A quantidade não pode superar ${formatNumber(order.quantity)} peças.`, "error");
      return;
    }
    const scrap = Number(order.quantity) - forwardQuantity;
    if (!window.confirm(`Avançar ${forwardQuantity} peças e registrar ${scrap} de refugo?`)) return;

    state.savingMovement = true;
    renderDetailModal();
    try {
      const response = await fetch(`/api/helice-ops/${encodeURIComponent(order.id)}/advance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-PCP-User": window.PCP_CURRENT_USER || "" },
        body: JSON.stringify({ forwardQuantity })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível avançar a OP.");
      state.orders = state.orders.map(item => String(item.id) === String(order.id) ? payload.order : item);
      renderRows();
      notifyOrdersUpdated();
      showToast(`${order.opNumber}: ${forwardQuantity} peças enviadas à próxima operação.`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      state.savingMovement = false;
      renderDetailModal();
    }
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
      notifyOrdersUpdated();
      if (state.selectedOrderId) renderDetailModal();
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
      const row = event.target.closest(".helice-op-row");
      if (row) openDetail(row.dataset.orderId);
    });
    byId("fluxo-body")?.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target.closest(".helice-op-row")) {
        event.preventDefault();
        openDetail(event.target.closest(".helice-op-row").dataset.orderId);
      }
    });
    byId("helice-op-modal-close")?.addEventListener("click", closeDetail);
    byId("helice-op-modal-cancel")?.addEventListener("click", closeDetail);
    byId("helice-forward-quantity")?.addEventListener("input", updateScrapPreview);
    byId("helice-op-next-button")?.addEventListener("click", advanceSelectedOrder);
  }

  window.RastreioHelices = {
    render() {
      initListeners();
      if (!state.loaded) load();
      else renderRows();
    },
    load,
    finalize,
    openDetail,
    _state: state
  };
})();
