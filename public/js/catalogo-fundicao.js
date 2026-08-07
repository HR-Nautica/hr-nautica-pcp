/* ═══════════════════════════════════════════════════════════════
   catalogo-fundicao.js – Módulo do Catálogo de Fundição (Códigos Brutos e Aplicações)
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    editingId: null,
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

  function renderCatalogoFundicao() {
    if (typeof DB === 'undefined') return;

    DB.ensureFundicaoCatalogAtualizada();
    const catalog = DB.getFundicaoCatalog();
    const coquilhas = DB.getCoquilhasCatalog();

    // Popula filtro de Coquilhas
    const filterSelect = byId('cf-filter-coquilha');
    if (filterSelect && !filterSelect.dataset.populated) {
      const coqOptions = [...new Set([...coquilhas, ...catalog.map(c => c.coquilha)].filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));

      filterSelect.innerHTML = [
        '<option value="">Todas as coquilhas / códigos brutos</option>',
        ...coqOptions.map(coq => `<option value="${escapeHtml(coq)}">${escapeHtml(coq)}</option>`)
      ].join('');
      filterSelect.dataset.populated = 'true';
    }

    const search = String(byId('cf-search')?.value || '').trim().toLowerCase();
    const filterCoquilha = byId('cf-filter-coquilha')?.value || '';

    const filtrados = catalog.filter(item => {
      const matchSearch = !search || [item.coquilha, item.sku, item.descricao]
        .some(v => String(v || '').toLowerCase().includes(search));
      const matchCoquilha = !filterCoquilha || item.coquilha === filterCoquilha;
      return matchSearch && matchCoquilha;
    });

    // KPIs
    const totalCoquilhasUnicas = new Set(catalog.map(c => c.coquilha)).size;
    const totalAplicacoes = catalog.length;

    if (byId('kpi-cf-coquilhas')) byId('kpi-cf-coquilhas').textContent = `${totalCoquilhasUnicas} un`;
    if (byId('kpi-cf-aplicacoes')) byId('kpi-cf-aplicacoes').textContent = `${totalAplicacoes} skus`;
    if (byId('cf-count')) byId('cf-count').textContent = `${filtrados.length} de ${catalog.length} itens`;

    const tbody = byId('cf-grid');
    if (tbody) {
      if (!filtrados.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhum item de fundição encontrado com os filtros aplicados.</td></tr>';
      } else {
        tbody.innerHTML = filtrados.map(item => {
          const pesoFormatted = (parseFloat(item.peso) || 0).toFixed(3).replace('.', ',');
          return `
          <tr>
            <td><span class="chip chip--purple font-mono" style="font-weight:700;">${escapeHtml(item.coquilha)}</span></td>
            <td><strong class="helice-op-number">${escapeHtml(item.sku)}</strong></td>
            <td><strong>${escapeHtml(item.descricao)}</strong></td>
            <td><span class="font-mono text-muted" style="font-weight:600;">${pesoFormatted} kg</span></td>
            <td class="catalogo-actions-col" style="text-align: right;">
              <div class="catalogo-table-actions" style="justify-content: flex-end; gap: 0.4rem;">
                <button class="btn-secondary catalogo-icon-action" onclick="window.openEditCatalogoFundicao('${item.id}')" title="Editar Item">✏️</button>
                <button class="btn-secondary catalogo-icon-action" onclick="window.deleteCatalogoFundicao('${item.id}')" title="Excluir Item" style="color:var(--accent-red); border-color:var(--accent-red);">🗑️</button>
              </div>
            </td>
          </tr>
        `;
        }).join('');
      }
    }
  }

  function openNovoCatalogoFundicao() {
    state.editingId = null;
    if (byId('modal-cf-title')) byId('modal-cf-title').textContent = '➕ Novo Item do Catálogo de Fundição';
    if (byId('cf-form-id')) byId('cf-form-id').value = '';
    if (byId('cf-form-sku')) byId('cf-form-sku').value = '';
    if (byId('cf-form-coquilha')) byId('cf-form-coquilha').value = '';
    if (byId('cf-form-descricao')) byId('cf-form-descricao').value = '';
    if (byId('cf-form-peso')) byId('cf-form-peso').value = '0';

    // Popula sugestão de coquilhas no modal
    const datalist = byId('cf-coquilhas-list');
    if (datalist && typeof DB !== 'undefined') {
      const coqs = DB.getCoquilhasCatalog();
      datalist.innerHTML = coqs.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    }

    byId('modal-catalogo-fundicao')?.classList.remove('hidden');
  }

  function openEditCatalogoFundicao(id) {
    if (typeof DB === 'undefined') return;
    const catalog = DB.getFundicaoCatalog();
    const item = catalog.find(c => c.id === id);
    if (!item) return;

    state.editingId = id;
    if (byId('modal-cf-title')) byId('modal-cf-title').textContent = `✏️ Editar Item: ${item.sku}`;
    if (byId('cf-form-id')) byId('cf-form-id').value = item.id;
    if (byId('cf-form-sku')) byId('cf-form-sku').value = item.sku;
    if (byId('cf-form-coquilha')) byId('cf-form-coquilha').value = item.coquilha;
    if (byId('cf-form-descricao')) byId('cf-form-descricao').value = item.descricao;
    if (byId('cf-form-peso')) byId('cf-form-peso').value = item.peso !== undefined ? item.peso : 0;

    byId('modal-catalogo-fundicao')?.classList.remove('hidden');
  }

  function closeModalCatalogoFundicao() {
    byId('modal-catalogo-fundicao')?.classList.add('hidden');
    state.editingId = null;
  }

  function saveCatalogoFundicao() {
    const coquilha = byId('cf-form-coquilha')?.value.trim();
    const sku = byId('cf-form-sku')?.value.trim().toUpperCase();
    const descricao = byId('cf-form-descricao')?.value.trim();
    const peso = parseFloat(byId('cf-form-peso')?.value) || 0;

    if (!coquilha) {
      if (typeof showToast === 'function') showToast('Informe a Coquilha / Código Bruto.', 'error');
      return;
    }
    if (!sku) {
      if (typeof showToast === 'function') showToast('Informe o Código (SKU) da Hélice.', 'error');
      return;
    }
    if (!descricao) {
      if (typeof showToast === 'function') showToast('Informe a Descrição da Hélice.', 'error');
      return;
    }

    if (state.editingId) {
      DB.updateFundicaoCatalogItem(state.editingId, { coquilha, sku, descricao, peso });
      if (typeof showToast === 'function') showToast('Item do Catálogo de Fundição atualizado!', 'success');
    } else {
      DB.addFundicaoCatalogItem({ coquilha, sku, descricao, peso });
      if (typeof showToast === 'function') showToast('Item adicionado ao Catálogo de Fundição com sucesso!', 'success');
    }

    closeModalCatalogoFundicao();
    renderCatalogoFundicao();
  }

  function deleteCatalogoFundicao(id) {
    if (typeof DB === 'undefined') return;
    const catalog = DB.getFundicaoCatalog();
    const item = catalog.find(c => c.id === id);
    if (!item) return;

    if (confirm(`Tem certeza que deseja excluir o item ${item.sku} (${item.coquilha})?`)) {
      DB.deleteFundicaoCatalogItem(id);
      if (typeof showToast === 'function') showToast('Item removido do Catálogo de Fundição.', 'info');
      renderCatalogoFundicao();
    }
  }

  // Exposição global
  window.renderCatalogoFundicao = renderCatalogoFundicao;
  window.openNovoCatalogoFundicao = openNovoCatalogoFundicao;
  window.openEditCatalogoFundicao = openEditCatalogoFundicao;
  window.closeModalCatalogoFundicao = closeModalCatalogoFundicao;
  window.deleteCatalogoFundicao = deleteCatalogoFundicao;

  // DOM Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-novo-cf')?.addEventListener('click', openNovoCatalogoFundicao);
    byId('modal-cf-close')?.addEventListener('click', closeModalCatalogoFundicao);
    byId('btn-cancel-cf')?.addEventListener('click', closeModalCatalogoFundicao);
    byId('btn-save-cf')?.addEventListener('click', saveCatalogoFundicao);

    byId('cf-search')?.addEventListener('input', renderCatalogoFundicao);
    byId('cf-filter-coquilha')?.addEventListener('change', renderCatalogoFundicao);
    byId('cf-limpar-filtros')?.addEventListener('click', () => {
      if (byId('cf-search')) byId('cf-search').value = '';
      if (byId('cf-filter-coquilha')) byId('cf-filter-coquilha').value = '';
      renderCatalogoFundicao();
    });

    const modalOverlay = byId('modal-catalogo-fundicao');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModalCatalogoFundicao();
      });
    }
  });
})();
