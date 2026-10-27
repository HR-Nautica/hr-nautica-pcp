/* ═══════════════════════════════════════════════════════════════
   rastreio-fundicao.js – Acompanhamento e Finalização de OPs de Fundição
   Controle de ciclo de vida: Em aberto -> Finalizar OP -> Fundido
   Entrada atômica no Estoque Físico da coquilha ao concluir
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    search: '',
    statusFilter: '',
    ops: [],
    isLoading: false,
    initialized: false
  };

  const byId = id => document.getElementById(id);

  function escapeHtml(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateBR(dateStr) {
    if (!dateStr) return '—';
    try {
      const parts = String(dateStr).split('T')[0].split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleDateString('pt-BR');
    } catch (_) {
      return String(dateStr);
    }
  }

  function getProductDescription(coquilha) {
    if (!coquilha) return '—';
    try {
      if (typeof DB !== 'undefined' && typeof DB.getFundicaoCatalog === 'function') {
        const item = DB.getFundicaoCatalog().find(c =>
          String(c.coquilha || '').trim().toUpperCase() === String(coquilha).trim().toUpperCase()
        );
        if (item && item.descricao) return item.descricao;
      }
    } catch (_) {}
    return `Peça bruta ${coquilha}`;
  }

  function cacheServerOrders(result) {
    if (!Array.isArray(result?.orders)) return;
    if (typeof window.applyFundicaoServerState === 'function') {
      window.applyFundicaoServerState(result);
    } else if (typeof RemoteStorage !== 'undefined' && typeof RemoteStorage.applyServerState === 'function') {
      RemoteStorage.applyServerState('hrn_fundicoes', result.orders, result.version, result.revision);
    }
  }

  async function readApiResult(response) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Falha na comunicação com o servidor (HTTP ${response.status}).`);
    return result;
  }

  /**
   * Busca as OPs no backend Postgres (ou localStorage se offline)
   */
  async function loadOpsFromBackend() {
    state.isLoading = true;
    try {
      const res = await fetch('/api/fundicao-ops', {
        headers: { 'X-PCP-User': window.PCP_CURRENT_USER || '' }
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.orders)) {
          state.ops = json.orders;
          // O backend é a fonte oficial das OPs; aqui apenas atualizamos o cache.
          cacheServerOrders(json);
          return;
        }
      }
    } catch (err) {
      console.warn('[Rastreio Fundição] Servidor indisponível, lendo do cache local:', err);
    } finally {
      state.isLoading = false;
    }

    // Fallback: carregar do DB local
    if (typeof DB !== 'undefined' && typeof DB.getFundicoes === 'function') {
      state.ops = DB.getFundicoes();
    } else {
      state.ops = [];
    }
  }

  /**
   * Renderiza a página inteira de Rastreio de Fundição
   */
  async function renderRastreioFundicao() {
    await loadOpsFromBackend();

    const tbody = byId('rf-table-body');
    const countEl = byId('rf-count');
    const kpiAbertas = byId('kpi-rf-abertas');
    const kpiPecasPlan = byId('kpi-rf-pecas-planejadas');
    const kpiFundidas = byId('kpi-rf-fundidas');
    const kpiPecasProd = byId('kpi-rf-pecas-produzidas');

    const ops = state.ops || [];

    // 1. Atualizar KPIs com o conjunto completo de OPs
    let abertasCount = 0;
    let pecasPlanTotal = 0;
    let fundidasCount = 0;
    let pecasProdTotal = 0;

    ops.forEach(op => {
      const status = (op.status || 'Em aberto').trim();
      const isFundido = status === 'Fundido' || status === 'Concluído' || op.finalizada === true;
      const planQty = parseInt(op.qtyPlanejada || op.qty || op.quantidade || 0, 10);
      const prodQty = parseInt(op.qtyProduzida || op.quantidadeProduzida || planQty, 10);

      if (isFundido) {
        fundidasCount++;
        pecasProdTotal += prodQty;
      } else {
        abertasCount++;
        pecasPlanTotal += planQty;
      }
    });

    if (kpiAbertas) kpiAbertas.textContent = String(abertasCount);
    if (kpiPecasPlan) kpiPecasPlan.textContent = `${pecasPlanTotal.toLocaleString('pt-BR')} un`;
    if (kpiFundidas) kpiFundidas.textContent = String(fundidasCount);
    if (kpiPecasProd) kpiPecasProd.textContent = `${pecasProdTotal.toLocaleString('pt-BR')} un`;

    // 2. Filtrar para a tabela
    const searchTerm = (state.search || '').trim().toLowerCase();
    const statusFilter = (state.statusFilter || '').trim();

    const filtered = ops.filter(op => {
      const status = (op.status || 'Em aberto').trim();
      const isFundido = status === 'Fundido' || status === 'Concluído' || op.finalizada === true;
      const normalizedStatus = isFundido ? 'Fundido' : 'Em aberto';

      if (statusFilter && normalizedStatus !== statusFilter) {
        return false;
      }

      if (searchTerm) {
        const text = [
          op.numero || op.lote || '',
          op.coquilha || op.produto || op.modelo || '',
          getProductDescription(op.coquilha || op.produto),
          op.responsavel || '',
          op.responsavelConclusao || '',
          normalizedStatus
        ].join(' ').toLowerCase();

        if (!text.includes(searchTerm)) return false;
      }

      return true;
    });

    // Ordenar: Em aberto primeiro, depois por data decrescente
    filtered.sort((a, b) => {
      const isFundidoA = (a.status === 'Fundido' || a.status === 'Concluído' || a.finalizada);
      const isFundidoB = (b.status === 'Fundido' || b.status === 'Concluído' || b.finalizada);
      if (isFundidoA !== isFundidoB) return isFundidoA ? 1 : -1;

      const dateA = new Date(a.criadoEm || a.data || a.dataPrevista || 0).getTime();
      const dateB = new Date(b.criadoEm || b.data || b.dataPrevista || 0).getTime();
      return dateB - dateA;
    });

    if (countEl) {
      countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'ordem listada' : 'ordens listadas'}`;
    }

    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" class="empty-cell" style="padding: 2.5rem 1rem; text-align: center;">
            <strong style="color: var(--text-primary); display:block; font-size: 1rem;">Nenhuma Ordem de Produção encontrada</strong>
            <span style="color: var(--text-muted); font-size: 0.85rem;">
              ${searchTerm || statusFilter ? 'Tente ajustar os termos de busca ou filtros.' : 'Clique em "Nova OP Fundição" para programar um lote.'}
            </span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(op => {
      const status = (op.status || 'Em aberto').trim();
      const isFundido = status === 'Fundido' || status === 'Concluído' || op.finalizada === true;
      const numOP = op.numero || op.lote || `OP-FND-${op.id}`;
      const produto = op.coquilha || op.produto || op.modelo || '—';
      const desc = getProductDescription(produto);
      const planQty = parseInt(op.qtyPlanejada || op.qty || op.quantidade || 0, 10);
      const prodQty = isFundido ? parseInt(op.qtyProduzida || op.quantidadeProduzida || planQty, 10) : null;
      const dataCriacao = formatDateBR(op.criadoEm || op.data || op.dataPrevista);
      const dataFinalizacao = isFundido ? formatDateBR(op.dataFinalizacao || op.finalizadoEm) : '—';
      const resp = (isFundido && op.responsavelConclusao) ? op.responsavelConclusao : (op.responsavel || '—');

      const statusBadge = isFundido
        ? '<span class="chip chip--green">Fundido</span>'
        : '<span class="chip chip--orange">Em aberto</span>';

      const acoesHtml = isFundido
        ? `<div style="display:flex; gap:8px; justify-content:flex-end; align-items:center;">
             <span style="font-size:0.8rem; color:#4ade80; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
               Concluída
             </span>
           </div>`
        : `<div class="hr-row-actions">
             <button type="button" class="btn-secondary btn-sm btn-finalizar-op hr-table-cta" data-id="${escapeHtml(op.id)}" title="Confirmar produção e creditar peças no Estoque Físico">Finalizar</button>
             <details class="hr-action-menu">
               <summary aria-label="Mais ações para ${escapeHtml(numOP)}" title="Mais ações">•••</summary>
               <div class="hr-action-menu-popover">
                 <button type="button" class="hr-action-danger btn-delete-op" data-id="${escapeHtml(op.id)}">Excluir OP</button>
               </div>
             </details>
           </div>`;

      return `
        <tr data-op-id="${escapeHtml(op.id)}">
          <td>
            <span class="chip font-mono" style="font-weight:800; font-size:0.85rem; background:rgba(30,41,59,0.85); border:1px solid rgba(148,163,184,0.25); color:#f8fafc; padding:3px 8px;">
              ${escapeHtml(numOP)}
            </span>
          </td>
          <td>
            <strong style="color:var(--text-primary); font-size:0.92rem;">${escapeHtml(produto)}</strong>
          </td>
          <td style="color:var(--text-secondary); font-size:0.85rem;" title="${escapeHtml(desc)}">
            ${escapeHtml(desc)}
          </td>
          <td style="text-align:center; font-weight:700; font-family:var(--font-mono); font-size:0.92rem;">
            ${planQty.toLocaleString('pt-BR')} un
          </td>
          <td style="text-align:center; font-family:var(--font-mono); font-size:0.92rem;">
            ${prodQty !== null
              ? `<span style="color:#4ade80; font-weight:800;">${prodQty.toLocaleString('pt-BR')} un</span>`
              : `<span style="color:var(--text-muted); opacity:0.6;">—</span>`}
          </td>
          <td style="font-size:0.83rem; color:var(--text-secondary);">${escapeHtml(dataCriacao)}</td>
          <td style="font-size:0.83rem; color:var(--text-secondary);">${escapeHtml(dataFinalizacao)}</td>
          <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(resp)}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:right;">${acoesHtml}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Abre o modal de finalização de OP
   */
  function openModalFinalizarOp(opId) {
    const op = (state.ops || []).find(o => String(o.id) === String(opId));
    if (!op) {
      if (typeof showToast === 'function') showToast('Ordem de Produção não encontrada.', 'error');
      return;
    }

    const modal = byId('modal-finalizar-op-fundicao');
    if (!modal) return;

    const numOP = op.numero || op.lote || `OP-FND-${op.id}`;
    const produto = op.coquilha || op.produto || op.modelo || '—';
    const planQty = parseInt(op.qtyPlanejada || op.qty || op.quantidade || 0, 10);
    const dataCriacao = formatDateBR(op.criadoEm || op.data || op.dataPrevista);

    const inputId = byId('fop-finish-id');
    const resumoNum = byId('fop-resumo-numero');
    const resumoProd = byId('fop-resumo-produto');
    const resumoDet = byId('fop-resumo-detalhes');
    const inputQty = byId('fop-qty-produzida');
    const inputData = byId('fop-data-finalizacao');
    const inputResp = byId('fop-responsavel-conclusao');
    const inputObs = byId('fop-obs-finalizacao');

    if (inputId) inputId.value = op.id;
    if (resumoNum) resumoNum.textContent = numOP;
    if (resumoProd) resumoProd.textContent = produto;
    if (resumoDet) resumoDet.textContent = `Qtd. Planejada: ${planQty.toLocaleString('pt-BR')} peças | Aberta em: ${dataCriacao}`;
    if (inputQty) inputQty.value = planQty > 0 ? planQty : 50;
    if (inputData) inputData.value = new Date().toISOString().split('T')[0];
    if (inputResp) inputResp.value = window.PCP_CURRENT_USER || op.responsavel || '';
    if (inputObs) inputObs.value = '';

    modal.classList.remove('hidden');
    if (inputQty) {
      inputQty.focus();
      inputQty.select();
    }
  }

  function closeModalFinalizarOp() {
    const modal = byId('modal-finalizar-op-fundicao');
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Confirma a finalização da OP e dá entrada no estoque
   */
  async function confirmarFinalizarOp() {
    const opId = byId('fop-finish-id')?.value;
    if (!opId) return;

    const qtyInput = byId('fop-qty-produzida');
    const qty = parseInt(qtyInput?.value, 10);
    if (isNaN(qty) || qty <= 0) {
      if (typeof showToast === 'function') showToast('Informe uma quantidade produzida válida maior que zero.', 'error');
      qtyInput?.focus();
      return;
    }

    const dataFinalizacao = byId('fop-data-finalizacao')?.value || new Date().toISOString().split('T')[0];
    const responsavel = byId('fop-responsavel-conclusao')?.value.trim() || window.PCP_CURRENT_USER || '';
    const obs = byId('fop-obs-finalizacao')?.value.trim() || '';

    const btnConfirmar = byId('btn-confirmar-finalizar-fop');
    const originalText = btnConfirmar ? btnConfirmar.innerHTML : '';
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.innerHTML = 'Gravando e Atualizando Estoque...';
    }

    const payload = {
      qtyProduzida: qty,
      dataFinalizacao,
      responsavel,
      obs,
      actor: window.PCP_CURRENT_USER || 'operador'
    };

    try {
      const response = await fetch(`/api/fundicao-ops/${encodeURIComponent(opId)}/finalizar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PCP-User': window.PCP_CURRENT_USER || ''
        },
        body: JSON.stringify(payload)
      });
      const result = await readApiResult(response);
      cacheServerOrders(result);

      // Finalização e entrada em estoque ocorrem em uma única transação no servidor.
      if (typeof window.refreshRawStock === 'function') await window.refreshRawStock();
      closeModalFinalizarOp();
      if (typeof showToast === 'function') {
        showToast(`OP finalizada. +${qty} peças creditadas no estoque físico de brutos.`, 'success');
      }
      await renderRastreioFundicao();
      if (typeof window.renderProgramacaoFundicao === 'function') window.renderProgramacaoFundicao();
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message || 'Não foi possível finalizar a OP.', 'error');
    } finally {
      if (btnConfirmar) {
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = originalText;
      }
    }
  }

  /**
   * Exclui ou cancela uma OP
   */
  async function deleteOpFundicao(opId) {
    const op = (state.ops || []).find(o => String(o.id) === String(opId));
    const numOP = op ? (op.numero || op.lote || `OP-${opId}`) : `OP-${opId}`;

    if (!confirm(`Tem certeza que deseja excluir a ordem de produção ${numOP}?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/fundicao-ops/${encodeURIComponent(opId)}`, {
        method: 'DELETE',
        headers: { 'X-PCP-User': window.PCP_CURRENT_USER || '' }
      });
      cacheServerOrders(await readApiResult(response));
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message || 'Não foi possível excluir a OP.', 'error');
      return;
    }

    if (typeof showToast === 'function') {
      showToast(`Ordem de produção ${numOP} excluída.`, 'info');
    }

    await renderRastreioFundicao();
  }

  /**
   * Inicialização dos Event Listeners
   */
  function initRastreioFundicao() {
    if (state.initialized) return;
    state.initialized = true;

    // Busca e Filtros
    const searchInput = byId('rf-search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        state.search = e.target.value;
        renderRastreioFundicao();
      });
    }

    const statusFilter = byId('rf-filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', e => {
        state.statusFilter = e.target.value;
        renderRastreioFundicao();
      });
    }

    const btnRefresh = byId('rf-btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        renderRastreioFundicao();
      });
    }

    // Botão Nova OP
    const btnNovaOp = byId('btn-nova-op-rastreio');
    if (btnNovaOp) {
      btnNovaOp.addEventListener('click', () => {
        if (typeof window.openNovaFundicao === 'function') {
          window.openNovaFundicao();
        }
      });
    }

    // Modal Finalizar OP
    const modalClose = byId('modal-finalizar-fop-close');
    if (modalClose) modalClose.addEventListener('click', closeModalFinalizarOp);

    const btnCancel = byId('btn-cancel-finalizar-fop');
    if (btnCancel) btnCancel.addEventListener('click', closeModalFinalizarOp);

    const btnConfirmar = byId('btn-confirmar-finalizar-fop');
    if (btnConfirmar) btnConfirmar.addEventListener('click', confirmarFinalizarOp);

    // Fechar ao clicar fora
    const modalFinalizar = byId('modal-finalizar-op-fundicao');
    if (modalFinalizar) {
      modalFinalizar.addEventListener('click', e => {
        if (e.target === modalFinalizar) closeModalFinalizarOp();
      });
    }

    // Delegação de eventos na tabela
    const tbody = byId('rf-table-body');
    if (tbody) {
      tbody.addEventListener('click', e => {
        const btnFinalizar = e.target.closest('.btn-finalizar-op');
        if (btnFinalizar) {
          const id = btnFinalizar.getAttribute('data-id');
          if (id) openModalFinalizarOp(id);
          return;
        }

        const btnDelete = e.target.closest('.btn-delete-op');
        if (btnDelete) {
          const id = btnDelete.getAttribute('data-id');
          if (id) deleteOpFundicao(id);
          return;
        }
      });
    }
  }

  // Exportar para escopo global
  window.initRastreioFundicao = initRastreioFundicao;
  window.renderRastreioFundicao = renderRastreioFundicao;
  window.openModalFinalizarOp = openModalFinalizarOp;
  window.closeModalFinalizarOp = closeModalFinalizarOp;

  // Auto-inicializar quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRastreioFundicao);
  } else {
    initRastreioFundicao();
  }
})();
