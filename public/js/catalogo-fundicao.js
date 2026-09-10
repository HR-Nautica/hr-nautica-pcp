/* ═══════════════════════════════════════════════════════════════
   catalogo-fundicao.js – Cadastro e Ficha Técnica dos Produtos de Fundição
   CRUD de Peças Brutas, Coquilhas e Especificações Metalúrgicas
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    editingId: null,
    isViewing: false,
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

  function formatKg(num) {
    const val = parseFloat(num) || 0;
    return `${val.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
  }

  function getCombinedCatalog() {
    if (typeof DB === 'undefined') return [];
    if (typeof DB.ensureFundicaoCatalogAtualizada === 'function') {
      DB.ensureFundicaoCatalogAtualizada();
    }

    const catalog = typeof DB.getFundicaoCatalog === 'function' ? DB.getFundicaoCatalog() : [];
    const coquilhas = typeof DB.getCoquilhasCatalog === 'function' ? DB.getCoquilhasCatalog() : [];
    const modelos = typeof DB.getModelos === 'function' ? DB.getModelos() : [];

    const itemsMap = new Map();

    // 1. Itens explícitos do catálogo de fundição
    catalog.forEach(c => {
      const coq = String(c.coquilha || c.sku || '').trim();
      if (!coq) return;
      const key = c.id || coq;
      itemsMap.set(key, {
        id: c.id || `fnd_${coq}`,
        coquilha: coq,
        descricao: c.descricao || `Peça bruta para coquilha ${coq}`,
        sku: c.sku || coq,
        liga: c.liga || 'Alumínio AlMg5',
        peso: parseFloat(c.peso) || (typeof DB.getCoquilhaPeso === 'function' ? DB.getCoquilhaPeso(coq) : 0),
        aplicacoes: Array.isArray(c.aplicacoes) ? c.aplicacoes : (c.aplicacoes ? String(c.aplicacoes).split(',').map(s => s.trim()).filter(Boolean) : (c.sku ? [c.sku] : [])),
        ativo: c.ativo !== undefined ? Boolean(c.ativo) : true,
        obs: c.obs || '',
        origem: 'catalogo'
      });
    });

    // 2. Coquilhas registradas e códigos brutos presentes nos modelos de hélice.
    // Um modelo vinculado a um bruto também deve aparecer aqui, mesmo quando o
    // cadastro detalhado ainda não foi preenchido.
    const rawCodes = [...new Set([
      ...coquilhas,
      ...modelos.map(modelo => modelo.codigoBruto)
    ].map(value => String(value || '').trim()).filter(Boolean))];

    rawCodes.forEach(coq => {
      const coqStr = String(coq || '').trim();
      if (!coqStr) return;
      const existing = Array.from(itemsMap.values()).find(item => item.coquilha.toUpperCase() === coqStr.toUpperCase());
      if (!existing) {
        // Busca se há modelos de hélice vinculados
        const linkedSkus = modelos
          .filter(m => String(m.codigoBruto || '').trim().toUpperCase() === coqStr.toUpperCase())
          .map(m => m.sku);

        const peso = typeof DB.getCoquilhaPeso === 'function' ? DB.getCoquilhaPeso(coqStr) : 0;
        const id = `fnd_${coqStr.replace(/\s+/g, '_')}`;

        itemsMap.set(id, {
          id: id,
          coquilha: coqStr,
          descricao: `Fundição bruta molde ${coqStr}`,
          sku: coqStr,
          liga: 'Alumínio AlMg5',
          peso: peso,
          aplicacoes: linkedSkus,
          ativo: true,
          obs: '',
          origem: 'coquilha'
        });
      } else {
        // As aplicações preenchidas manualmente são preservadas e os modelos
        // vinculados pelo campo codigoBruto são acrescentados automaticamente.
        const linkedSkus = modelos
          .filter(m => String(m.codigoBruto || '').trim().toUpperCase() === coqStr.toUpperCase())
          .map(m => m.sku);
        if (linkedSkus.length) existing.aplicacoes = [...new Set([...(existing.aplicacoes || []), ...linkedSkus])];
      }
    });

    return Array.from(itemsMap.values()).sort((a, b) => 
      a.coquilha.localeCompare(b.coquilha, 'pt-BR', { numeric: true })
    );
  }

  function renderCatalogoFundicao() {
    if (typeof DB === 'undefined') return;

    const items = getCombinedCatalog();
    const search = String(byId('cf-search')?.value || '').trim().toLowerCase();
    const statusFilter = byId('cf-filter-status')?.value || '';
    const coquilhaFilter = byId('cf-filter-coquilha')?.value || '';

    // Popula filtro de coquilhas
    const filterSelect = byId('cf-filter-coquilha');
    if (filterSelect && !filterSelect.dataset.populated) {
      const uniqueCoquilhas = [...new Set(items.map(i => i.coquilha))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      filterSelect.innerHTML = [
        '<option value="">Todas as coquilhas</option>',
        ...uniqueCoquilhas.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      ].join('');
      filterSelect.dataset.populated = 'true';
    }

    // Filtros
    let filtered = items;
    if (statusFilter === 'ativo') {
      filtered = filtered.filter(i => i.ativo !== false);
    } else if (statusFilter === 'inativo') {
      filtered = filtered.filter(i => i.ativo === false);
    }

    if (coquilhaFilter) {
      filtered = filtered.filter(i => i.coquilha === coquilhaFilter);
    }

    if (search) {
      filtered = filtered.filter(i => 
        i.coquilha.toLowerCase().includes(search) ||
        String(i.descricao || '').toLowerCase().includes(search) ||
        String(i.liga || '').toLowerCase().includes(search) ||
        (i.aplicacoes && i.aplicacoes.some(a => String(a).toLowerCase().includes(search)))
      );
    }

    // KPIs
    const totalCount = items.length;
    const ativosCount = items.filter(i => i.ativo !== false).length;
    const uniqueCoqCount = new Set(items.map(i => i.coquilha)).size;
    const pesosValid = items.map(i => i.peso).filter(p => p > 0);
    const pesoMedio = pesosValid.length ? (pesosValid.reduce((a, b) => a + b, 0) / pesosValid.length) : 0;

    if (byId('kpi-cf-total')) byId('kpi-cf-total').textContent = String(totalCount);
    if (byId('kpi-cf-ativos')) byId('kpi-cf-ativos').textContent = String(ativosCount);
    if (byId('kpi-cf-coquilhas')) byId('kpi-cf-coquilhas').textContent = String(uniqueCoqCount);
    if (byId('kpi-cf-peso-medio')) byId('kpi-cf-peso-medio').textContent = formatKg(pesoMedio);
    if (byId('cf-count')) byId('cf-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'produto' : 'produtos'}`;

    const tbody = byId('cf-grid');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhum produto de fundição encontrado para os filtros selecionados.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const isAtivo = item.ativo !== false;
      const statusChip = isAtivo
        ? '<span class="chip chip--green font-mono" style="font-size:0.78rem; font-weight:700;">Ativo</span>'
        : '<span class="chip chip--gray font-mono" style="font-size:0.78rem;">Inativo</span>';

      const appsChips = (item.aplicacoes || []).slice(0, 4).map(app => 
        `<span class="chip chip--blue font-mono" style="font-size:0.75rem; padding:2px 6px;">${escapeHtml(app)}</span>`
      ).join(' ');
      const extraAppsCount = (item.aplicacoes || []).length > 4 ? ` <small class="text-muted">+${item.aplicacoes.length - 4}</small>` : '';

      return `
        <tr style="${!isAtivo ? 'opacity:0.6;' : ''}">
          <td>
            <span class="chip chip--purple font-mono" style="font-weight:700; font-size:0.88rem; padding:4px 8px;">
              ${escapeHtml(item.coquilha)}
            </span>
          </td>
          <td>
            <strong style="color:var(--text-primary); font-size:0.92rem;">${escapeHtml(item.descricao)}</strong>
            ${item.obs ? `<div class="text-muted" style="font-size:0.78rem; margin-top:2px;">${escapeHtml(item.obs)}</div>` : ''}
          </td>
          <td>
            <span class="text-muted" style="font-size:0.85rem; font-weight:600;">${escapeHtml(item.liga || 'Alumínio AlMg5')}</span>
          </td>
          <td>
            <span class="font-mono" style="font-weight:700; color:#cbd5e1; font-size:0.88rem;">${formatKg(item.peso)}</span>
          </td>
          <td>
            <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
              ${appsChips || '<span class="text-muted" style="font-size:0.8rem; font-style:italic;">Nenhuma hélice vinculada</span>'}
              ${extraAppsCount}
            </div>
          </td>
          <td style="text-align: center;">
            ${statusChip}
          </td>
          <td class="catalogo-actions-col" style="text-align: right;">
            <div class="catalogo-table-actions" style="justify-content: flex-end; gap: 4px;">
              <button class="btn-secondary catalogo-icon-action" onclick="window.openViewProdutoFundicao('${escapeHtml(item.id)}')" title="Visualizar ficha técnica"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/></svg></button>
              <button class="btn-secondary catalogo-icon-action" onclick="window.openEditProdutoFundicao('${escapeHtml(item.id)}')" title="Editar produto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>
              <button class="btn-secondary catalogo-icon-action" onclick="window.toggleStatusProdutoFundicao('${escapeHtml(item.id)}')" title="${isAtivo ? 'Inativar produto' : 'Ativar produto'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${isAtivo ? '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>' : '<polygon points="7 4 20 12 7 20 7 4"/>'}</svg></button>
              <button class="btn-danger catalogo-icon-action" onclick="window.deleteProdutoFundicao('${escapeHtml(item.id)}')" title="Excluir produto"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m3 0V4h8v2"/></svg></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openNovoProdutoFundicao() {
    state.editingId = null;
    state.isViewing = false;

    if (byId('modal-produto-fundicao-title')) byId('modal-produto-fundicao-title').textContent = 'Novo Produto de Fundição';
    if (byId('mpf-id')) byId('mpf-id').value = '';
    if (byId('mpf-coquilha')) { byId('mpf-coquilha').value = ''; byId('mpf-coquilha').disabled = false; }
    if (byId('mpf-descricao')) { byId('mpf-descricao').value = ''; byId('mpf-descricao').disabled = false; }
    if (byId('mpf-liga')) { byId('mpf-liga').value = 'Alumínio AlMg5'; byId('mpf-liga').disabled = false; }
    if (byId('mpf-peso')) { byId('mpf-peso').value = ''; byId('mpf-peso').disabled = false; }
    if (byId('mpf-status')) { byId('mpf-status').value = 'true'; byId('mpf-status').disabled = false; }
    if (byId('mpf-aplicacoes')) { byId('mpf-aplicacoes').value = ''; byId('mpf-aplicacoes').disabled = false; }
    if (byId('mpf-obs')) { byId('mpf-obs').value = ''; byId('mpf-obs').disabled = false; }

    const saveBtn = byId('btn-save-produto-fundicao');
    if (saveBtn) saveBtn.style.display = 'inline-flex';

    byId('modal-produto-fundicao')?.classList.remove('hidden');
  }

  function openEditProdutoFundicao(id) {
    const item = getCombinedCatalog().find(i => i.id === id);
    if (!item) return;

    state.editingId = id;
    state.isViewing = false;

    if (byId('modal-produto-fundicao-title')) byId('modal-produto-fundicao-title').textContent = `Editar Produto: ${item.coquilha}`;
    if (byId('mpf-id')) byId('mpf-id').value = id;
    if (byId('mpf-coquilha')) { byId('mpf-coquilha').value = item.coquilha; byId('mpf-coquilha').disabled = false; }
    if (byId('mpf-descricao')) { byId('mpf-descricao').value = item.descricao; byId('mpf-descricao').disabled = false; }
    if (byId('mpf-liga')) { byId('mpf-liga').value = item.liga || 'Alumínio AlMg5'; byId('mpf-liga').disabled = false; }
    if (byId('mpf-peso')) { byId('mpf-peso').value = item.peso || ''; byId('mpf-peso').disabled = false; }
    if (byId('mpf-status')) { byId('mpf-status').value = item.ativo !== false ? 'true' : 'false'; byId('mpf-status').disabled = false; }
    if (byId('mpf-aplicacoes')) { byId('mpf-aplicacoes').value = (item.aplicacoes || []).join(', '); byId('mpf-aplicacoes').disabled = false; }
    if (byId('mpf-obs')) { byId('mpf-obs').value = item.obs || ''; byId('mpf-obs').disabled = false; }

    const saveBtn = byId('btn-save-produto-fundicao');
    if (saveBtn) saveBtn.style.display = 'inline-flex';

    byId('modal-produto-fundicao')?.classList.remove('hidden');
  }

  function openViewProdutoFundicao(id) {
    const item = getCombinedCatalog().find(i => i.id === id);
    if (!item) return;

    state.editingId = id;
    state.isViewing = true;

    if (byId('modal-produto-fundicao-title')) byId('modal-produto-fundicao-title').textContent = `Ficha Técnica: ${item.coquilha}`;
    if (byId('mpf-id')) byId('mpf-id').value = id;
    if (byId('mpf-coquilha')) { byId('mpf-coquilha').value = item.coquilha; byId('mpf-coquilha').disabled = true; }
    if (byId('mpf-descricao')) { byId('mpf-descricao').value = item.descricao; byId('mpf-descricao').disabled = true; }
    if (byId('mpf-liga')) { byId('mpf-liga').value = item.liga || 'Alumínio AlMg5'; byId('mpf-liga').disabled = true; }
    if (byId('mpf-peso')) { byId('mpf-peso').value = item.peso || ''; byId('mpf-peso').disabled = true; }
    if (byId('mpf-status')) { byId('mpf-status').value = item.ativo !== false ? 'true' : 'false'; byId('mpf-status').disabled = true; }
    if (byId('mpf-aplicacoes')) { byId('mpf-aplicacoes').value = (item.aplicacoes || []).join(', '); byId('mpf-aplicacoes').disabled = true; }
    if (byId('mpf-obs')) { byId('mpf-obs').value = item.obs || ''; byId('mpf-obs').disabled = true; }

    const saveBtn = byId('btn-save-produto-fundicao');
    if (saveBtn) saveBtn.style.display = 'none';

    byId('modal-produto-fundicao')?.classList.remove('hidden');
  }

  function closeModalProdutoFundicao() {
    byId('modal-produto-fundicao')?.classList.add('hidden');
  }

  function saveProdutoFundicao() {
    if (state.isViewing) {
      closeModalProdutoFundicao();
      return;
    }

    const coquilha = String(byId('mpf-coquilha')?.value || '').trim();
    const descricao = String(byId('mpf-descricao')?.value || '').trim();
    const liga = String(byId('mpf-liga')?.value || 'Alumínio AlMg5').trim();
    const peso = parseFloat(byId('mpf-peso')?.value) || 0;
    const ativo = byId('mpf-status')?.value === 'true';
    const aplicacoesRaw = String(byId('mpf-aplicacoes')?.value || '').trim();
    const aplicacoes = aplicacoesRaw ? aplicacoesRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
    const obs = String(byId('mpf-obs')?.value || '').trim();

    if (!coquilha) {
      if (typeof showToast === 'function') showToast('Informe o código da coquilha/molde.', 'error');
      return;
    }
    if (!descricao) {
      if (typeof showToast === 'function') showToast('Informe a descrição do produto.', 'error');
      return;
    }
    if (peso <= 0) {
      if (typeof showToast === 'function') showToast('Informe um peso unitário válido maior que zero.', 'error');
      return;
    }

    const payload = {
      coquilha,
      descricao,
      sku: coquilha,
      liga,
      peso,
      aplicacoes,
      ativo,
      obs
    };

    if (state.editingId) {
      const catalog = DB.getFundicaoCatalog();
      const existingInCatalog = catalog.find(c => c.id === state.editingId || c.coquilha.toUpperCase() === coquilha.toUpperCase());
      if (existingInCatalog) {
        DB.updateFundicaoCatalogItem(existingInCatalog.id, payload);
      } else {
        DB.addFundicaoCatalogItem(payload);
      }
      if (typeof showToast === 'function') showToast(`Produto ${coquilha} atualizado no Catálogo!`, 'success');
    } else {
      DB.addFundicaoCatalogItem(payload);
      if (typeof showToast === 'function') showToast(`Produto ${coquilha} cadastrado com sucesso!`, 'success');
    }

    closeModalProdutoFundicao();
    renderCatalogoFundicao();
    if (typeof window.renderProgramacaoFundicao === 'function') {
      window.renderProgramacaoFundicao();
    }
  }

  function toggleStatusProdutoFundicao(id) {
    if (typeof DB === 'undefined') return;
    const item = getCombinedCatalog().find(i => i.id === id);
    if (!item) return;

    const catalog = DB.getFundicaoCatalog();
    const existing = catalog.find(c => c.id === id || c.coquilha.toUpperCase() === item.coquilha.toUpperCase());

    if (existing) {
      DB.toggleFundicaoCatalogItemStatus(existing.id);
    } else {
      DB.addFundicaoCatalogItem({
        ...item,
        ativo: !item.ativo
      });
    }

    const novoStatus = item.ativo ? 'inativado' : 'ativado';
    if (typeof showToast === 'function') showToast(`Produto ${item.coquilha} ${novoStatus}.`, 'info');
    renderCatalogoFundicao();
    if (typeof window.renderProgramacaoFundicao === 'function') {
      window.renderProgramacaoFundicao();
    }
  }

  function deleteProdutoFundicao(id) {
    if (typeof DB === 'undefined') return;
    const item = getCombinedCatalog().find(i => i.id === id);
    if (!item) return;

    if (!confirm(`Tem certeza que deseja excluir o produto "${item.coquilha} - ${item.descricao}" do Catálogo de Fundição?`)) return;

    const catalog = DB.getFundicaoCatalog();
    const existing = catalog.find(c => c.id === id || c.coquilha.toUpperCase() === item.coquilha.toUpperCase());
    if (existing) {
      DB.deleteFundicaoCatalogItem(existing.id);
    }

    if (typeof showToast === 'function') showToast(`Produto ${item.coquilha} removido do Catálogo.`, 'error');
    renderCatalogoFundicao();
    if (typeof window.renderProgramacaoFundicao === 'function') {
      window.renderProgramacaoFundicao();
    }
  }

  // Exposição Global
  window.renderCatalogoFundicao = renderCatalogoFundicao;
  window.openNovoProdutoFundicao = openNovoProdutoFundicao;
  window.openEditProdutoFundicao = openEditProdutoFundicao;
  window.openViewProdutoFundicao = openViewProdutoFundicao;
  window.closeModalProdutoFundicao = closeModalProdutoFundicao;
  window.saveProdutoFundicao = saveProdutoFundicao;
  window.toggleStatusProdutoFundicao = toggleStatusProdutoFundicao;
  window.deleteProdutoFundicao = deleteProdutoFundicao;
  window.getCombinedCatalog = getCombinedCatalog;

  // Listeners DOM
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-novo-cf')?.addEventListener('click', openNovoProdutoFundicao);
    byId('modal-produto-fundicao-close')?.addEventListener('click', closeModalProdutoFundicao);
    byId('btn-cancel-produto-fundicao')?.addEventListener('click', closeModalProdutoFundicao);
    byId('btn-save-produto-fundicao')?.addEventListener('click', saveProdutoFundicao);

    byId('cf-search')?.addEventListener('input', renderCatalogoFundicao);
    byId('cf-filter-status')?.addEventListener('change', renderCatalogoFundicao);
    byId('cf-filter-coquilha')?.addEventListener('change', renderCatalogoFundicao);
    byId('cf-limpar-filtros')?.addEventListener('click', () => {
      if (byId('cf-search')) byId('cf-search').value = '';
      if (byId('cf-filter-status')) byId('cf-filter-status').value = '';
      if (byId('cf-filter-coquilha')) byId('cf-filter-coquilha').value = '';
      renderCatalogoFundicao();
    });
  });
})();
