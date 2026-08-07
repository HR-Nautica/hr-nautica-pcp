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
    const catalog = getCombinedFundicaoItems();
    const coquilhas = DB.getCoquilhasCatalog();
    const all = [...new Set([...coquilhas, ...catalog.map(c => c.coquilha)].filter(Boolean))];
    all.forEach(c => state.expandedCoquilhas.add(c));
    renderCatalogoFundicao();
  }

  function collapseAllCoquilhas() {
    state.expandedCoquilhas.clear();
    renderCatalogoFundicao();
  }

  function promptSetCoquilhaPeso(coquilha) {
    if (typeof DB === 'undefined') return;
    const currentPeso = DB.getCoquilhaPeso(coquilha);
    const input = prompt(`Informe o Peso da ${coquilha} em quilos (kg):\n\n(Ex: 1.850)`, currentPeso ? String(currentPeso) : '0');
    if (input === null) return;
    const val = parseFloat(input.replace(',', '.'));
    if (isNaN(val) || val < 0) {
      if (typeof showToast === 'function') showToast('Informe um valor numérico válido para o peso.', 'error');
      return;
    }
    DB.saveCoquilhaPeso(coquilha, val);
    if (typeof showToast === 'function') showToast(`Peso da ${coquilha} atualizado para ${val.toFixed(3).replace('.', ',')} kg!`, 'success');
    renderCatalogoFundicao();
  }

  function getCombinedFundicaoItems() {
    if (typeof DB === 'undefined') return [];
    DB.ensureFundicaoCatalogAtualizada();
    const catalog = DB.getFundicaoCatalog();
    const modelos = DB.getModelos();

    const itemsMap = new Map();

    // 1. Prioridade para modelos do Catálogo de Hélices com código bruto / coquilha
    modelos.forEach(m => {
      if (m.codigoBruto) {
        const itemObj = {
          id: m.id,
          modeloId: m.id,
          sku: m.sku,
          descricao: m.nome,
          coquilha: String(m.codigoBruto).trim(),
          isModelo: true
        };
        itemsMap.set(`${itemObj.coquilha}|${itemObj.sku}`, itemObj);
      }
    });

    // 2. Legado do catálogo de fundição (caso haja algum item não cadastrado em modelos)
    catalog.forEach(c => {
      const key = `${c.coquilha}|${c.sku}`;
      if (!itemsMap.has(key)) {
        itemsMap.set(key, {
          id: c.id,
          modeloId: null,
          sku: c.sku,
          descricao: c.descricao,
          coquilha: c.coquilha,
          isModelo: false
        });
      }
    });

    return Array.from(itemsMap.values());
  }

  function renderCatalogoFundicao() {
    if (typeof DB === 'undefined') return;

    const catalog = getCombinedFundicaoItems();
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

      // Peso referente à Coquilha
      const pesoCoquilha = DB.getCoquilhaPeso(coquilhaName);
      const pesoCoquilhaFormatted = pesoCoquilha ? `${pesoCoquilha.toFixed(3).replace('.', ',')} kg` : '0,000 kg';

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
          <td>
            <span class="chip chip--purple font-mono" style="font-weight:700; font-size:0.88rem;">${pesoCoquilhaFormatted}</span>
          </td>
          <td class="catalogo-actions-col" style="text-align: right;" onclick="event.stopPropagation();">
            <div class="catalogo-table-actions" style="justify-content: flex-end; gap: 0.4rem;">
              <button class="btn-secondary" onclick="window.promptSetCoquilhaPeso('${escapeHtml(coquilhaName)}')" style="font-size:0.8rem; padding:4px 8px;" title="Editar Peso da Coquilha">⚖️ Peso Coquilha</button>
              <button class="btn-secondary" onclick="window.openNovoModelo('${escapeHtml(coquilhaName)}')" style="font-size:0.8rem; padding:4px 10px; font-weight:600;" title="Cadastrar nova hélice no Catálogo">➕ Add Hélice</button>
            </div>
          </td>
        </tr>
      `;

      // Linhas dos Modelos (Sub-itens quando expandido)
      if (isExpanded) {
        if (!items.length) {
          html += `
            <tr class="coquilha-child-row">
              <td colspan="5" class="text-muted" style="padding-left: 2.2rem; font-style: italic; font-size:0.85rem;">
                Nenhum modelo cadastrado para a ${escapeHtml(coquilhaName)}. Clique no botão "+ Add Hélice" à direita para vincular.
              </td>
            </tr>
          `;
        } else {
          items.forEach(item => {
            const editOnClick = item.isModelo 
              ? `window.openEditModelo('${item.id}')` 
              : `window.openEditCatalogoFundicao('${item.id}')`;
            const deleteOnClick = item.isModelo 
              ? `window.deleteModelo('${item.id}')` 
              : `window.deleteCatalogoFundicao('${item.id}')`;

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
                <td><span class="font-mono text-muted" style="font-size:0.82rem;">(Coquilha: ${pesoCoquilhaFormatted})</span></td>
                <td class="catalogo-actions-col" style="text-align: right;">
                  <div class="catalogo-table-actions" style="justify-content: flex-end; gap: 0.4rem;">
                    <button class="btn-secondary catalogo-icon-action" onclick="${editOnClick}" title="Editar Hélice no Catálogo">✏️</button>
                    <button class="btn-secondary catalogo-icon-action" onclick="${deleteOnClick}" title="Excluir Hélice do Catálogo" style="color:var(--accent-red); border-color:var(--accent-red);">🗑️</button>
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
    if (typeof window.openNovoModelo === 'function') {
      window.openNovoModelo(prefilledCoquilha);
    }
  }

  function openEditCatalogoFundicao(id) {
    if (typeof window.openEditModelo === 'function') {
      window.openEditModelo(id);
    }
  }

  function deleteCatalogoFundicao(id) {
    if (typeof DB === 'undefined') return;
    const item = getCombinedFundicaoItems().find(c => c.id === id);
    if (!item) return;

    if (item.isModelo && typeof window.deleteModelo === 'function') {
      window.deleteModelo(id);
      return;
    }

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
  window.promptSetCoquilhaPeso = promptSetCoquilhaPeso;
  window.openNovoCatalogoFundicao = openNovoCatalogoFundicao;
  window.openEditCatalogoFundicao = openEditCatalogoFundicao;
  window.deleteCatalogoFundicao = deleteCatalogoFundicao;

  // DOM Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-novo-cf')?.addEventListener('click', () => openNovoCatalogoFundicao());

    byId('cf-expand-all')?.addEventListener('click', expandAllCoquilhas);
    byId('cf-collapse-all')?.addEventListener('click', collapseAllCoquilhas);

    byId('cf-search')?.addEventListener('input', renderCatalogoFundicao);
    byId('cf-filter-coquilha')?.addEventListener('change', renderCatalogoFundicao);
    byId('cf-limpar-filtros')?.addEventListener('click', () => {
      if (byId('cf-search')) byId('cf-search').value = '';
      if (byId('cf-filter-coquilha')) byId('cf-filter-coquilha').value = '';
      renderCatalogoFundicao();
    });
  });
})();


