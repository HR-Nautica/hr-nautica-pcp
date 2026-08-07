/* ═══════════════════════════════════════════════════════════════
   estoque-buchas.js – Módulo de Estoque e Rastreio de Buchas
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    selectedOpId: null,
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

  function formatNum(val) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(val) || 0);
  }

  function formatDate(val) {
    if (!val) return '—';
    const d = new Date(`${String(val).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
  }

  function getStageBadge(stageCode) {
    switch (stageCode) {
      case 'op01': return '<span class="chip chip--orange">1 - Retrabalho</span>';
      case 'op02': return '<span class="chip chip--purple">2 - Vulcanização</span>';
      case 'op03': return '<span class="chip chip--green">3 - Estoque Final</span>';
      default: return '<span class="chip chip--blue">—</span>';
    }
  }

  function renderStageFlow(op) {
    const stages = [
      { code: 'op01', label: '1 - Retrabalho' },
      { code: 'op02', label: '2 - Vulcanização' },
      { code: 'op03', label: '3 - Estoque Final' }
    ];

    const currentIdx = stages.findIndex(s => s.code === op.currentStage);

    return `<div class="helice-op-flow" aria-label="Fluxo das três etapas de bucha">
      ${stages.map((st, idx) => {
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const cssClass = isPast ? 'is-complete' : isCurrent ? 'is-current' : '';
        const stData = (op.stages || []).find(s => s.code === st.code);
        const qty = stData && stData.quantity ? `${formatNum(stData.quantity)} un` : '0 un';
        return `<span class="helice-op-step ${cssClass}" title="${st.label}: ${qty}">${idx + 1}</span>`;
      }).join('')}
    </div>`;
  }

  function renderEstoqueBuchas() {
    if (typeof DB === 'undefined') return;

    const ops = DB.getBuchasOps();
    const search = String(byId('bucha-op-search')?.value || '').trim().toLowerCase();
    const filterStage = byId('bucha-op-filter-etapa')?.value || '';
    const filterStatus = byId('bucha-op-filter-status')?.value || '';

    // Filtragem
    const filtered = ops.filter(op => {
      const matchSearch = !search || [op.opNumber, op.sku, op.description, op.obs]
        .some(v => String(v || '').toLowerCase().includes(search));
      const matchStage = !filterStage || op.currentStage === filterStage;
      const matchStatus = !filterStatus || op.status === filterStatus;
      return matchSearch && matchStage && matchStatus;
    });

    // KPIs
    const emRetrabalho = ops.filter(o => o.status === 'em_producao' && o.currentStage === 'op01')
      .reduce((sum, o) => sum + (Number(o.quantity) || 0), 0);
    const emVulcanizacao = ops.filter(o => o.status === 'em_producao' && o.currentStage === 'op02')
      .reduce((sum, o) => sum + (Number(o.quantity) || 0), 0);
    const estoqueFinal = ops.filter(o => o.currentStage === 'op03' || o.status === 'finalizada')
      .reduce((sum, o) => sum + (Number(o.quantity) || 0), 0);
    const opsAtivas = ops.filter(o => o.status === 'em_producao').length;

    if (byId('kpi-eb-retrabalho')) byId('kpi-eb-retrabalho').textContent = `${formatNum(emRetrabalho)} un`;
    if (byId('kpi-eb-vulcanizacao')) byId('kpi-eb-vulcanizacao').textContent = `${formatNum(emVulcanizacao)} un`;
    if (byId('kpi-eb-final')) byId('kpi-eb-final').textContent = `${formatNum(estoqueFinal)} un`;
    if (byId('kpi-eb-ativas')) byId('kpi-eb-ativas').textContent = formatNum(opsAtivas);
    if (byId('bucha-op-count')) byId('bucha-op-count').textContent = `${filtered.length} de ${ops.length} OPs`;

    // Render Tabela
    const tbody = byId('bucha-op-grid');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Nenhuma OP de bucha encontrada para os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(op => {
      const isFinished = op.status === 'finalizada';
      const isRefugada = op.status === 'refugada';
      const statusChip = isFinished
        ? '<span class="chip chip--green">Estoque Final</span>'
        : isRefugada
        ? '<span class="chip chip--red">⚠️ Refugada</span>'
        : '<span class="chip chip--orange">Em produção</span>';

      return `<tr class="${isFinished ? 'helice-op-row--finished' : isRefugada ? 'helice-op-row--refugada' : ''}">
        <td><strong class="helice-op-number">${escapeHtml(op.opNumber)}</strong></td>
        <td><span class="chip chip--blue">${escapeHtml(op.sku)}</span></td>
        <td><strong>${escapeHtml(op.description)}</strong></td>
        <td><strong>${formatNum(op.quantity)} un</strong></td>
        <td><span class="helice-op-priority">${escapeHtml(op.priority || 'Normal')}</span></td>
        <td>${getStageBadge(op.currentStage)}</td>
        <td>${renderStageFlow(op)}</td>
        <td>${formatDate(op.entryDate)}</td>
        <td>${statusChip}</td>
        <td>
          <div style="display:flex;gap:6px;justify-content:center;">
            <button class="btn-secondary" onclick="window.openMovBuchaOp('${op.id}')" title="Avançar/Mover Etapa">
              ${isFinished || isRefugada ? 'Ver detalhes' : 'Avançar OP'}
            </button>
            <button class="btn-secondary catalogo-icon-action" onclick="window.openHistoricoBuchaOp('${op.id}')" title="Histórico">
              📜
            </button>
            <button class="btn-secondary catalogo-icon-action catalogo-delete-btn" onclick="window.deleteBuchaOpUI('${op.id}')" title="Excluir OP">
              🗑
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // --- Modal Nova OP de Bucha ---
  function openNovaBuchaOp() {
    const catalog = DB.getBuchas();
    const selectSku = byId('bucha-op-sku-select');
    if (selectSku) {
      selectSku.innerHTML = [
        '<option value="">— Selecione uma Bucha do Catálogo —</option>',
        ...catalog.map(b => `<option value="${escapeHtml(b.sku)}">${escapeHtml(b.sku)} - ${escapeHtml(b.descricao)}</option>`)
      ].join('');
    }
    if (byId('bucha-op-qty')) byId('bucha-op-qty').value = '100';
    if (byId('bucha-op-priority')) byId('bucha-op-priority').value = 'Normal';
    if (byId('bucha-op-obs')) byId('bucha-op-obs').value = '';

    byId('modal-nova-op-bucha')?.classList.remove('hidden');
  }

  function closeModalNovaBuchaOp() {
    byId('modal-nova-op-bucha')?.classList.add('hidden');
  }

  function saveNovaBuchaOp() {
    const sku = byId('bucha-op-sku-select')?.value;
    const qty = parseInt(byId('bucha-op-qty')?.value, 10);
    const priority = byId('bucha-op-priority')?.value || 'Normal';
    const obs = byId('bucha-op-obs')?.value.trim() || '';

    if (!sku) {
      if (typeof showToast === 'function') showToast('Selecione uma bucha do catálogo.', 'error');
      return;
    }
    if (!qty || qty <= 0) {
      if (typeof showToast === 'function') showToast('Informe uma quantidade válida maior que 0.', 'error');
      return;
    }

    DB.addBuchaOp({ sku, quantity: qty, priority, obs });
    if (typeof showToast === 'function') showToast('OP de Bucha criada com sucesso!');
    closeModalNovaBuchaOp();
    renderEstoqueBuchas();
  }

  // --- Modal Movimentar/Avançar OP de Bucha ---
  function openMovBuchaOp(id) {
    const ops = DB.getBuchasOps();
    const op = ops.find(o => o.id === id);
    if (!op) return;

    state.selectedOpId = id;
    const nextStage = op.currentStage === 'op01' ? 'op02' : 'op03';
    const stageNames = { op01: 'Retrabalho', op02: 'Vulcanização', op03: 'Estoque Final' };

    if (byId('mov-bucha-op-title')) byId('mov-bucha-op-title').textContent = `Mover OP ${op.opNumber} (${op.sku})`;
    if (byId('mov-bucha-current-stage')) byId('mov-bucha-current-stage').textContent = stageNames[op.currentStage] || op.currentStage;
    if (byId('mov-bucha-next-stage')) byId('mov-bucha-next-stage').textContent = stageNames[nextStage] || nextStage;
    if (byId('mov-bucha-total-qty')) byId('mov-bucha-total-qty').textContent = `${formatNum(op.quantity)} un`;
    if (byId('mov-bucha-qty-move')) byId('mov-bucha-qty-move').value = op.quantity;
    if (byId('mov-bucha-remaining-action')) byId('mov-bucha-remaining-action').value = 'split';

    byId('modal-mov-bucha')?.classList.remove('hidden');
  }

  function closeModalMovBuchaOp() {
    byId('modal-mov-bucha')?.classList.add('hidden');
    state.selectedOpId = null;
  }

  function saveMovBuchaOp() {
    if (!state.selectedOpId) return;
    const ops = DB.getBuchasOps();
    const op = ops.find(o => o.id === state.selectedOpId);
    if (!op) return;

    const qtyMove = parseInt(byId('mov-bucha-qty-move')?.value, 10);
    const action = byId('mov-bucha-remaining-action')?.value || 'split';

    if (!qtyMove || qtyMove <= 0 || qtyMove > op.quantity) {
      if (typeof showToast === 'function') showToast(`Qtd a mover deve ser entre 1 e ${op.quantity}.`, 'error');
      return;
    }

    const nextStage = op.currentStage === 'op01' ? 'op02' : 'op03';
    DB.advanceBuchaOp(state.selectedOpId, qtyMove, nextStage, action);

    if (typeof showToast === 'function') showToast(`OP ${op.opNumber} movida com sucesso!`);
    closeModalMovBuchaOp();
    renderEstoqueBuchas();
  }

  // --- Modal Histórico da OP de Bucha ---
  function openHistoricoBuchaOp(id) {
    const ops = DB.getBuchasOps();
    const op = ops.find(o => o.id === id);
    if (!op) return;

    if (byId('hist-bucha-op-title')) byId('hist-bucha-op-title').textContent = `Histórico da ${op.opNumber} (${op.sku})`;
    const list = byId('hist-bucha-op-list');
    if (list) {
      list.innerHTML = (op.history || []).map(h => `
        <div style="padding: 10px; border-left: 3px solid var(--accent-primary); background: var(--bg-tertiary); margin-bottom: 8px; border-radius: 4px;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-secondary);">
            <span>⏱ ${escapeHtml(h.date)}</span>
            <span>👤 ${escapeHtml(h.user || 'Operador')}</span>
          </div>
          <div style="font-weight:600; margin-top:4px;">${escapeHtml(h.stage || '')}: ${escapeHtml(h.action || '')}</div>
        </div>
      `).join('') || '<div class="empty-cell">Nenhum histórico gravado.</div>';
    }

    byId('modal-hist-bucha')?.classList.remove('hidden');
  }

  function closeModalHistoricoBuchaOp() {
    byId('modal-hist-bucha')?.classList.add('hidden');
  }

  function deleteBuchaOpUI(id) {
    const ops = DB.getBuchasOps();
    const op = ops.find(o => o.id === id);
    if (!op) return;

    if (!confirm(`Deseja realmente cancelar/excluir a OP de Bucha ${op.opNumber}?`)) return;

    DB.deleteBuchaOp(id);
    if (typeof showToast === 'function') showToast('OP de Bucha removida.', 'error');
    renderEstoqueBuchas();
  }

  // Exposição de API global
  window.renderEstoqueBuchas = renderEstoqueBuchas;
  window.openNovaBuchaOp = openNovaBuchaOp;
  window.openMovBuchaOp = openMovBuchaOp;
  window.openHistoricoBuchaOp = openHistoricoBuchaOp;
  window.deleteBuchaOpUI = deleteBuchaOpUI;

  // Listeners DOM
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-nova-op-bucha')?.addEventListener('click', openNovaBuchaOp);
    byId('modal-nova-bucha-op-close')?.addEventListener('click', closeModalNovaBuchaOp);
    byId('btn-cancel-nova-bucha-op')?.addEventListener('click', closeModalNovaBuchaOp);
    byId('btn-save-nova-bucha-op')?.addEventListener('click', saveNovaBuchaOp);

    byId('modal-mov-bucha-close')?.addEventListener('click', closeModalMovBuchaOp);
    byId('btn-cancel-mov-bucha')?.addEventListener('click', closeModalMovBuchaOp);
    byId('btn-save-mov-bucha')?.addEventListener('click', saveMovBuchaOp);

    byId('modal-hist-bucha-close')?.addEventListener('click', closeModalHistoricoBuchaOp);
    byId('btn-close-hist-bucha')?.addEventListener('click', closeModalHistoricoBuchaOp);

    byId('bucha-op-search')?.addEventListener('input', renderEstoqueBuchas);
    byId('bucha-op-filter-etapa')?.addEventListener('change', renderEstoqueBuchas);
    byId('bucha-op-filter-status')?.addEventListener('change', renderEstoqueBuchas);
    byId('bucha-op-limpar-filtros')?.addEventListener('click', () => {
      if (byId('bucha-op-search')) byId('bucha-op-search').value = '';
      if (byId('bucha-op-filter-etapa')) byId('bucha-op-filter-etapa').value = '';
      if (byId('bucha-op-filter-status')) byId('bucha-op-filter-status').value = '';
      renderEstoqueBuchas();
    });
  });
})();
