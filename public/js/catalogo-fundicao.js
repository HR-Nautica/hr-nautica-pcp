/* ═══════════════════════════════════════════════════════════════
   catalogo-fundicao.js – Módulo do Catálogo de Fundição (Códigos Brutos e Aplicações)
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    editingId: null,
    expandedCoquilhas: new Set(),
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

  function toggleCoquilhaExpand(coquilha) {
    if (state.expandedCoquilhas.has(coquilha)) {
      state.expandedCoquilhas.delete(coquilha);
    } else {
      state.expandedCoquilhas.add(coquilha);
    }
    renderCatalogoFundicao();
  }

  function expandAllCoquilhas() {
    if (typeof DB === 'undefined') return;
    const catalog = DB.getFundicaoCatalog();
    const coquilhas = DB.getCoquilhasCatalog();
    const all = [...new Set([...coquilhas, ...catalog.map(c => c.coquilha)].filter(Boolean))];
    all.forEach(c => state.expandedCoquilhas.add(c));
    renderCatalogoFundicao();
  }

  function collapseAllCoquilhas() {
    state.expandedCoquilhas.clear();
    renderCatalogoFundicao();
  }

  function renderCatalogoFundicao() {
    if (typeof DB === 'undefined') return;

    DB.ensureFundicaoCatalogAtualizada();
    const catalog = DB.getFundicaoCatalog();
    const coquilhas = DB.getCoquilhasCatalog();

    // Lista única de coquilhas registradas e catalogadas
    const allCoquilhas = [...new Set([...coquilhas, ...catalog.map(c => c.coquilha)].filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));

    // Popula filtro de Coquilhas no toolbar
    const filterSelect = byId('cf-filter-coquilha');
    if (filterSelect && !filterSelect.dataset.populated) {
      filterSelect.innerHTML = [
        '<option value="">Todas as coquilhas / códigos brutos</option>',
        ...allCoquilhas.map(coq => `<option value="${escapeHtml(coq)}">${escapeHtml(coq)}</option>`)
      ].join('');
      filterSelect.dataset.populated = 'true';
    }

    const search = String(byId('cf-search')?.value || '').trim().toLowerCase();
    const filterCoquilha = byId('cf-filter-coquilha')?.value || '';

    // Agrupa itens por coquilha
    const groupedMap = new Map();
    allCoquilhas.forEach(c => groupedMap.set(c, []));
    catalog.forEach(item => {
      if (item.coquilha) {
        if (!groupedMap.has(item.coquilha)) groupedMap.set(item.coquilha, []);
        groupedMap.get(item.coquilha).push(item);
      }
    });

    // Filtra coquilhas e seus modelos correspondentes
    let coquilhasFiltradas = allCoquilhas;
    if (filterCoquilha) {
      coquilhasFiltradas = coquilhasFiltradas.filter(c => c === filterCoquilha);
    }

    if (search) {
      coquilhasFiltradas = coquilhasFiltradas.filter(coquilhaName => {
        const matchCoquilhaName = coquilhaName.toLowerCase().includes(search);
        const items = groupedMap.get(coquilhaName) || [];
        const matchItem = items.some(i => 
          String(i.sku || '').toLowerCase().includes(search) || 
          String(i.descricao || '').toLowerCase().includes(search)
        );
        return matchCoquilhaName || matchItem;
      });
    }

    // KPIs
    const totalCoquilhasUnicas = allCoquilhas.length;
    const totalAplicacoes = catalog.length;

    if (byId('kpi-cf-coquilhas')) byId('kpi-cf-coquilhas').textContent = `${totalCoquilhasUnicas} un`;
    if (byId('kpi-cf-aplicacoes')) byId('kpi-cf-aplicacoes').textContent = `${totalAplicacoes} skus`;
    
    // Total de SKUs visíveis
    let skusVisiveis = 0;
    coquilhasFiltradas.forEach(c => {
      const items = groupedMap.get(c) || [];
      if (search) {
        skusVisiveis += items.filter(i => 
          c.toLowerCase().includes(search) ||
          String(i.sku || '').toLowerCase().includes(search) ||
          String(i.descricao || '').toLowerCase().includes(search)
        ).length;
      } else {
        skusVisiveis += items.length;
      }
    });

    if (byId('cf-count')) byId('cf-count').textContent = `${coquilhasFiltradas.length} coquilha(s) (${skusVisiveis} skus)`;

    const tbody = byId('cf-grid');
    if (!tbody) return;

    if (!coquilhasFiltradas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhuma coquilha ou aplicação encontrada com os filtros informados.</td></tr>';
      return;
    }

    let html = '';

    coquilhasFiltradas.forEach(coquilhaName => {
      let items = groupedMap.get(coquilhaName) || [];
      if (search && !coquilhaName.toLowerCase().includes(search)) {
        items = items.filter(i => 
          String(i.sku || '').toLowerCase().includes(search) || 
          String(i.descricao || '').toLowerCase().includes(search)
        );
      }

      // Se houver busca ativa, auto-expande para mostrar o resultado diretamente ao usuário
      const isExpanded = search ? true : state.expandedCoquilhas.has(coquilhaName);
      const skusPreview = items.map(i => i.sku).slice(0, 5).join(', ');
      const previewText = skusPreview ? (items.length > 5 ? `${skusPreview}...` : skusPreview) : 'Sem modelos vinculados';

      // Linha Principal da Coquilha
      html += `
        <tr class="coquilha-group-header ${isExpanded ? 'expanded' : ''}" onclick="window.toggleCoquilhaExpand('${escapeHtml(coquilhaName)}')">
          <td>
            <button type="button" class="coquilha-toggle-btn" title="Clique para expandir/recolher modelos">
              <span class="coquilha-arrow">▶</span>
              <span class="chip chip--purple font-mono" style="font-weight:700; font-size:0.9rem; padding:4px 10px;">${escapeHtml(coquilhaName)}</span>
            </button>
          </td>
          <td>
            <span class="chip chip--blue font-mono" style="font-weight:600;">${items.length} ${items.length === 1 ? 'modelo' : 'modelos'}</span>
          </td>
          <td class="text-muted" style="font-size:0.85rem; font-weight:500;">
            ${escapeHtml(previewText)}
          </td>
          <td><span class="text-muted font-mono" style="font-size:0.85rem;">—</span></td>
          <td class="catalogo-actions-col" style="text-align: right;" onclick="event.stopPropagation();">
            <button class="btn-secondary" onclick="window.openNovoCatalogoFundicao('${escapeHtml(coquilhaName)}')" style="font-size:0.8rem; padding:4px 10px; font-weight:600;">➕ Add Modelo</button>
          </td>
        </tr>
      `;

      // Linhas dos Modelos (Sub-itens quando expandido)
      if (isExpanded) {
        if (!items.length) {
          html += `
            <tr class="coquilha-child-row">
              <td colspan="5" class="text-muted" style="padding-left: 2.2rem; font-style: italic; font-size:0.85rem;">
                Nenhum modelo cadastrado para a ${escapeHtml(coquilhaName)}. Clique no botão "+ Add Modelo" à direita para vincular um SKU.
              </td>
            </tr>
          `;
        } else {
          items.forEach(item => {
            const pesoFormatted = (parseFloat(item.peso) || 0).toFixed(3).replace('.', ',');
            html += `
              <tr class="coquilha-child-row">
                <td style="padding-left: 1.5rem;">
                  <div style="display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:0.85rem;">
                    <span style="color:var(--accent-blue); font-weight:bold;">↳</span>
                    <span style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em;">Modelo Hélice</span>
                  </div>
                </td>
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
          });
        }
      }
    });

    tbody.innerHTML = html;
  }

  function openNovoCatalogoFundicao(prefilledCoquilha = '') {
    state.editingId = null;
    if (byId('modal-cf-title')) byId('modal-cf-title').textContent = '➕ Novo Item do Catálogo de Fundição';
    if (byId('cf-form-id')) byId('cf-form-id').value = '';
    if (byId('cf-form-sku')) byId('cf-form-sku').value = '';
    if (byId('cf-form-coquilha')) byId('cf-form-coquilha').value = typeof prefilledCoquilha === 'string' ? prefilledCoquilha : '';
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

    // Auto-expande a coquilha adicionada/editada para o usuário visualizar
    state.expandedCoquilhas.add(coquilha);

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
  window.toggleCoquilhaExpand = toggleCoquilhaExpand;
  window.expandAllCoquilhas = expandAllCoquilhas;
  window.collapseAllCoquilhas = collapseAllCoquilhas;
  window.openNovoCatalogoFundicao = openNovoCatalogoFundicao;
  window.openEditCatalogoFundicao = openEditCatalogoFundicao;
  window.closeModalCatalogoFundicao = closeModalCatalogoFundicao;
  window.deleteCatalogoFundicao = deleteCatalogoFundicao;

  // DOM Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-novo-cf')?.addEventListener('click', () => openNovoCatalogoFundicao());
    byId('modal-cf-close')?.addEventListener('click', closeModalCatalogoFundicao);
    byId('btn-cancel-cf')?.addEventListener('click', closeModalCatalogoFundicao);
    byId('btn-save-cf')?.addEventListener('click', saveCatalogoFundicao);

    byId('cf-expand-all')?.addEventListener('click', expandAllCoquilhas);
    byId('cf-collapse-all')?.addEventListener('click', collapseAllCoquilhas);

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

