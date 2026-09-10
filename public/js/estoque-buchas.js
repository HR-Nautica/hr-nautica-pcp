/* ═══════════════════════════════════════════════════════════════
   estoque-buchas.js – Módulo Consolidado de Saldos e Entradas de Buchas
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    selectedEntradaId: null,
    activeTab: 'saldos', // 'saldos' | 'lotes' | 'historico'
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

  function switchEstoqueBuchasTab(tabName) {
    state.activeTab = tabName;
    ['saldos', 'lotes', 'historico'].forEach(t => {
      const btn = byId(`tab-btn-eb-${t}`);
      const panel = byId(`tab-panel-eb-${t}`);
      if (t === tabName) {
        btn?.classList.add('active');
        panel?.classList.remove('hidden');
      } else {
        btn?.classList.remove('active');
        panel?.classList.add('hidden');
      }
    });
  }

  function renderEstoqueBuchas() {
    if (typeof DB === 'undefined') return;

    const saldos = DB.getBuchasSaldosConsolidados();
    const entradas = DB.getBuchasEntradas();
    const saidas = DB.getBuchasSaidas();

    const search = String(byId('bucha-op-search')?.value || '').trim().toLowerCase();
    const filterMotor = byId('bucha-filter-motor-saldo')?.value || '';

    // Filtragem dos modelos consolidado
    const saldosFiltrados = saldos.filter(s => {
      const matchSearch = !search || [s.sku, s.descricao, s.dimensoes, s.aplicacao]
        .some(v => String(v || '').toLowerCase().includes(search));
      const matchMotor = !filterMotor || s.aplicacao === filterMotor;
      return matchSearch && matchMotor;
    });

    // Popula filtro de motores
    const motorSelect = byId('bucha-filter-motor-saldo');
    if (motorSelect && !motorSelect.dataset.populated) {
      const motores = [...new Set(saldos.map(s => s.aplicacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      motorSelect.innerHTML = [
        '<option value="">Todos os motores</option>',
        ...motores.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      ].join('');
      motorSelect.dataset.populated = 'true';
    }

    // KPIs Globais de Estoque
    const totUsinagem = saldos.reduce((sum, s) => sum + s.qtdUsinagem, 0);
    const totRetrabalho = saldos.reduce((sum, s) => sum + s.qtdRetrabalho, 0);
    const totVulcanizacao = saldos.reduce((sum, s) => sum + s.qtdVulcanizacao, 0);
    const totAcabada = saldos.reduce((sum, s) => sum + s.qtdAcabada, 0);
    const totGeral = saldos.reduce((sum, s) => sum + s.saldoTotal, 0);

    if (byId('kpi-eb-usinagem')) byId('kpi-eb-usinagem').textContent = `${formatNum(totUsinagem)} un`;
    if (byId('kpi-eb-retrabalho')) byId('kpi-eb-retrabalho').textContent = `${formatNum(totRetrabalho)} un`;
    if (byId('kpi-eb-vulcanizacao')) byId('kpi-eb-vulcanizacao').textContent = `${formatNum(totVulcanizacao)} un`;
    if (byId('kpi-eb-final')) byId('kpi-eb-final').textContent = `${formatNum(totAcabada)} un`;
    if (byId('kpi-eb-ativas')) byId('kpi-eb-ativas').textContent = `${formatNum(totGeral)} un`;
    if (byId('bucha-op-count')) byId('bucha-op-count').textContent = `${saldosFiltrados.length} de ${saldos.length} modelos`;

    // 1. Render Tabela Consolidada de Buchas (Mestre com Usinagem)
    const gridSaldos = byId('bucha-saldo-grid');
    if (gridSaldos) {
      if (!saldosFiltrados.length) {
        gridSaldos.innerHTML = '<tr><td colspan="9" class="empty-cell">Nenhum modelo de bucha encontrado.</td></tr>';
      } else {
        gridSaldos.innerHTML = saldosFiltrados.map(s => {
          const badgeUsi = s.qtdUsinagem > 0 ? `<span class="chip chip--blue"><b>${formatNum(s.qtdUsinagem)}</b> un</span>` : '<span style="color:var(--text-secondary)">0</span>';
          const badgeRet = s.qtdRetrabalho > 0 ? `<span class="chip chip--orange"><b>${formatNum(s.qtdRetrabalho)}</b> un</span>` : '<span style="color:var(--text-secondary)">0</span>';
          const badgeVul = s.qtdVulcanizacao > 0 ? `<span class="chip chip--purple"><b>${formatNum(s.qtdVulcanizacao)}</b> un</span>` : '<span style="color:var(--text-secondary)">0</span>';
          const badgeAca = s.qtdAcabada > 0 ? `<span class="chip chip--green"><b>${formatNum(s.qtdAcabada)}</b> un</span>` : '<span style="color:var(--text-secondary)">0</span>';

          return `<tr>
            <td><strong class="helice-op-number">${escapeHtml(s.sku)}</strong></td>
            <td><strong>${escapeHtml(s.descricao)}</strong></td>
            <td><span class="chip chip--teal">${escapeHtml(s.aplicacao || 'Geral')}</span></td>
            <td>${badgeUsi}</td>
            <td>${badgeRet}</td>
            <td>${badgeVul}</td>
            <td>${badgeAca}</td>
            <td><strong style="color:var(--accent-teal); font-size:1.05rem;">${formatNum(s.saldoTotal)} un</strong></td>
            <td>
              <div class="bucha-actions-wrap">
                <button class="btn-primary" onclick="window.openNovaEntradaBucha('${escapeHtml(s.sku)}')" title="Nova Entrada">
                  Entrada
                </button>
                <button class="btn-secondary" style="border-color:var(--accent-orange); color:var(--accent-orange);" onclick="window.openSaidaBucha('${escapeHtml(s.sku)}')" title="Dar Baixa no Estoque Pronto">
                  Dar baixa
                </button>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    }

    // 2. Render Tabela de Lotes e Entradas em Andamento
    const gridEntradas = byId('bucha-lote-grid');
    if (gridEntradas) {
      const emAndamento = entradas.filter(e => e.status === 'Em Andamento' || e.etapaAtual !== 'Estoque Final');
      if (!emAndamento.length) {
        gridEntradas.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhum lote em produção no momento (todas no Estoque Pronto).</td></tr>';
      } else {
        gridEntradas.innerHTML = emAndamento.map(e => {
          let btnAcao = '';
          let etapaBadge = '';
          if (e.etapaAtual === 'Usinagem') {
            etapaBadge = '<span class="chip chip--blue">1. Usinagem</span>';
            btnAcao = `<button class="btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="window.openTransicaoLoteBucha('${e.id}')">Transicionar</button>`;
          } else if (e.etapaAtual === 'Retrabalho') {
            etapaBadge = '<span class="chip chip--orange">2. Retrabalho</span>';
            btnAcao = `<button class="btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="window.openTransicaoLoteBucha('${e.id}')">Vulcanizar</button>`;
          } else if (e.etapaAtual === 'Vulcanizacao') {
            etapaBadge = '<span class="chip chip--purple">3. Vulcanização</span>';
            btnAcao = `<button class="btn-primary" style="padding:4px 10px; font-size:0.8rem;" onclick="window.openTransicaoLoteBucha('${e.id}')">Enviar ao estoque pronto</button>`;
          } else {
            etapaBadge = '<span class="chip chip--green">4. Estoque Pronto</span>';
            btnAcao = '<span class="chip chip--green">Concluído</span>';
          }

          return `<tr>
            <td><strong class="helice-op-number">${escapeHtml(e.codigoEntrada)}</strong></td>
            <td><span class="chip chip--blue">${escapeHtml(e.sku)}</span></td>
            <td><strong>${escapeHtml(e.descricao)}</strong></td>
            <td><strong>${formatNum(e.quantidade)} un</strong></td>
            <td>${etapaBadge}</td>
            <td><small>${escapeHtml(e.origemObs || '—')}</small></td>
            <td>
              <div class="bucha-actions-wrap">
                ${btnAcao}
                <button class="btn-secondary catalogo-icon-action" onclick="window.openHistoricoLoteBucha('${e.id}')" title="Histórico" aria-label="Abrir histórico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg></button>
              </div>
            </td>
          </tr>`;
        }).join('');
      }
    }

    // 3. Render Histórico Recente de Transações (Entradas & Saídas)
    const gridHistGlobal = byId('bucha-historico-transacoes-grid');
    if (gridHistGlobal) {
      const allEvents = [];

      entradas.forEach(e => {
        allEvents.push({
          codigo: e.codigoEntrada,
          tipo: 'Entrada',
          sku: e.sku,
          quantidade: e.quantidade,
          detalhe: `Etapa: ${e.etapaAtual} | ${e.origemObs || ''}`,
          data: e.dataCriacao,
          badge: '<span class="chip chip--teal">Entrada</span>'
        });
      });

      saidas.forEach(s => {
        allEvents.push({
          codigo: s.codigoSaida,
          tipo: 'Saída',
          sku: s.sku,
          quantidade: -s.quantidade,
          detalhe: `Destino: ${s.destinoObs || ''}`,
          data: s.dataSaida,
          badge: '<span class="chip chip--red">Saída</span>'
        });
      });

      allEvents.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

      // Popula filtro de buchas SKUs no histórico
      const skuHistSelect = byId('hist-bucha-filter-sku');
      if (skuHistSelect && !skuHistSelect.dataset.populated) {
        const skus = [...new Set(saldos.map(s => s.sku).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        skuHistSelect.innerHTML = [
          '<option value="">Todas as buchas</option>',
          ...skus.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`)
        ].join('');
        skuHistSelect.dataset.populated = 'true';
      }

      // Leitura dos filtros de histórico
      const hSearch = String(byId('hist-bucha-search')?.value || '').trim().toLowerCase();
      const hSku = byId('hist-bucha-filter-sku')?.value || '';
      const hTipo = byId('hist-bucha-filter-tipo')?.value || '';
      const hDateStart = byId('hist-bucha-date-start')?.value || '';
      const hDateEnd = byId('hist-bucha-date-end')?.value || '';

      const eventsFiltrados = allEvents.filter(ev => {
        const matchSearch = !hSearch || [ev.codigo, ev.sku, ev.detalhe, ev.tipo]
          .some(v => String(v || '').toLowerCase().includes(hSearch));
        const matchSku = !hSku || String(ev.sku || '').toUpperCase() === String(hSku).toUpperCase();
        const matchTipo = !hTipo || ev.tipo.toLowerCase().includes(hTipo.toLowerCase());

        let matchDate = true;
        if (ev.data) {
          const evDateStr = String(ev.data).slice(0, 10);
          if (hDateStart && evDateStr < hDateStart) matchDate = false;
          if (hDateEnd && evDateStr > hDateEnd) matchDate = false;
        }

        return matchSearch && matchSku && matchTipo && matchDate;
      });

      if (byId('hist-bucha-count')) {
        byId('hist-bucha-count').textContent = `${eventsFiltrados.length} de ${allEvents.length} registros`;
      }

      if (!eventsFiltrados.length) {
        gridHistGlobal.innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhum registro encontrado com os filtros selecionados.</td></tr>';
      } else {
        gridHistGlobal.innerHTML = eventsFiltrados.map(ev => `
          <tr>
            <td><strong class="helice-op-number">${escapeHtml(ev.codigo)}</strong></td>
            <td>${ev.badge}</td>
            <td><span class="chip chip--blue">${escapeHtml(ev.sku)}</span></td>
            <td><strong style="color:${ev.quantidade > 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${ev.quantidade > 0 ? '+' : ''}${formatNum(ev.quantidade)} un</strong></td>
            <td><small>${escapeHtml(ev.detalhe)}</small></td>
            <td><small>${escapeHtml(ev.data || '—')}</small></td>
          </tr>
        `).join('');
      }
    }
  }

  // --- Modal Nova Entrada de Bucha ---
  function openNovaEntradaBucha(preselectSku = '') {
    const catalog = DB.getBuchas();
    const selectSku = byId('entrada-bucha-sku');
    if (selectSku) {
      selectSku.innerHTML = [
        '<option value="">— Selecione a Bucha do Catálogo —</option>',
        ...catalog.map(b => `<option value="${escapeHtml(b.sku)}">${escapeHtml(b.sku)} - ${escapeHtml(b.descricao)}</option>`)
      ].join('');
      if (preselectSku) selectSku.value = preselectSku;
    }

    if (byId('entrada-bucha-qty')) byId('entrada-bucha-qty').value = '100';
    if (byId('entrada-bucha-etapa')) byId('entrada-bucha-etapa').value = 'Usinagem';
    if (byId('entrada-bucha-obs')) byId('entrada-bucha-obs').value = '';

    byId('modal-nova-entrada-bucha')?.classList.remove('hidden');
  }

  function closeModalNovaEntradaBucha() {
    byId('modal-nova-entrada-bucha')?.classList.add('hidden');
  }

  function saveNovaEntradaBucha() {
    const sku = byId('entrada-bucha-sku')?.value;
    const qty = parseInt(byId('entrada-bucha-qty')?.value, 10);
    const etapaInicial = byId('entrada-bucha-etapa')?.value || 'Usinagem';
    const origemObs = byId('entrada-bucha-obs')?.value.trim() || 'Entrada de lote';

    if (!sku) {
      if (typeof showToast === 'function') showToast('Selecione uma bucha do catálogo.', 'error');
      return;
    }
    if (!qty || qty <= 0) {
      if (typeof showToast === 'function') showToast('Informe uma quantidade maior que 0.', 'error');
      return;
    }

    DB.addBuchaEntrada({ sku, quantidade: qty, etapaInicial, origemObs });
    if (typeof showToast === 'function') showToast(`Entrada registrada com sucesso!`, 'success');

    closeModalNovaEntradaBucha();
    renderEstoqueBuchas();
  }

  // --- Modal Transicionar Lote ---
  function openTransicaoLoteBucha(id) {
    const entradas = DB.getBuchasEntradas();
    const entrada = entradas.find(e => e.id === id);
    if (!entrada) return;

    state.selectedEntradaId = id;

    const selectEtapa = byId('trans-bucha-proxima-etapa-select');
    if (selectEtapa) {
      if (entrada.etapaAtual === 'Usinagem') {
        selectEtapa.innerHTML = `
          <option value="Retrabalho">2. Retrabalho</option>
          <option value="Vulcanizacao">3. Vulcanização</option>
          <option value="Estoque Final">4. Estoque Pronto (Direto)</option>
        `;
      } else if (entrada.etapaAtual === 'Retrabalho') {
        selectEtapa.innerHTML = `
          <option value="Vulcanizacao">3. Vulcanização</option>
          <option value="Estoque Final">4. Estoque Pronto (Direto)</option>
        `;
      } else {
        selectEtapa.innerHTML = `
          <option value="Estoque Final">4. Estoque Pronto</option>
        `;
      }
    }

    if (byId('trans-bucha-code-title')) byId('trans-bucha-code-title').textContent = `Mover Lote ${entrada.codigoEntrada} (${entrada.sku})`;
    if (byId('trans-bucha-etapa-atual')) byId('trans-bucha-etapa-atual').textContent = entrada.etapaAtual;
    if (byId('trans-bucha-total-qty')) byId('trans-bucha-total-qty').textContent = `${formatNum(entrada.quantidade)} un`;
    if (byId('trans-bucha-qty-move')) byId('trans-bucha-qty-move').value = entrada.quantidade;

    byId('modal-transicao-bucha')?.classList.remove('hidden');
  }

  function closeModalTransicaoLoteBucha() {
    byId('modal-transicao-bucha')?.classList.add('hidden');
    state.selectedEntradaId = null;
  }

  function saveTransicaoLoteBucha() {
    if (!state.selectedEntradaId) return;
    const entradas = DB.getBuchasEntradas();
    const entrada = entradas.find(e => e.id === state.selectedEntradaId);
    if (!entrada) return;

    const moveQty = parseInt(byId('trans-bucha-qty-move')?.value, 10);
    const acaoSaldo = byId('trans-bucha-action-restante')?.value || 'manter';
    const selectEtapa = byId('trans-bucha-proxima-etapa-select');
    const proximaEtapa = selectEtapa ? selectEtapa.value : (entrada.etapaAtual === 'Retrabalho' ? 'Vulcanizacao' : 'Estoque Final');

    if (!moveQty || moveQty <= 0 || moveQty > entrada.quantidade) {
      if (typeof showToast === 'function') showToast(`Quantidade deve estar entre 1 e ${entrada.quantidade}.`, 'error');
      return;
    }

    DB.moverBuchaEntrada(state.selectedEntradaId, moveQty, proximaEtapa, acaoSaldo);
    if (typeof showToast === 'function') showToast(`Lote ${entrada.codigoEntrada} transicionado para ${proximaEtapa}!`, 'success');

    closeModalTransicaoLoteBucha();
    renderEstoqueBuchas();
  }

  // --- Modal Dar Baixa / Registrar Saída ---
  function openSaidaBucha(preselectSku = '') {
    const saldos = DB.getBuchasSaldosConsolidados();
    const selectSku = byId('saida-bucha-sku');
    if (selectSku) {
      selectSku.innerHTML = [
        '<option value="">— Selecione a Bucha do Catálogo —</option>',
        ...saldos.map(b => `<option value="${escapeHtml(b.sku)}">${escapeHtml(b.sku)} (Estoque Pronto: ${formatNum(b.qtdAcabada)} un) - ${escapeHtml(b.descricao)}</option>`)
      ].join('');
      if (preselectSku) selectSku.value = preselectSku;
    }

    if (byId('saida-bucha-qty')) byId('saida-bucha-qty').value = '1';
    if (byId('saida-bucha-obs')) byId('saida-bucha-obs').value = '';

    byId('modal-saida-bucha')?.classList.remove('hidden');
  }

  function closeModalSaidaBucha() {
    byId('modal-saida-bucha')?.classList.add('hidden');
  }

  function saveSaidaBucha() {
    const sku = byId('saida-bucha-sku')?.value;
    const qty = parseInt(byId('saida-bucha-qty')?.value, 10);
    const destinoObs = byId('saida-bucha-obs')?.value.trim() || 'Baixa de estoque';

    if (!sku) {
      if (typeof showToast === 'function') showToast('Selecione uma bucha do catálogo.', 'error');
      return;
    }
    if (!qty || qty <= 0) {
      if (typeof showToast === 'function') showToast('Informe uma quantidade válida.', 'error');
      return;
    }

    try {
      DB.addBuchaSaida({ sku, quantidade: qty, destinoObs });
      if (typeof showToast === 'function') showToast('Saída registrada e saldo abatido com sucesso!');
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || 'Erro ao registrar saída.', 'error');
      return;
    }

    closeModalSaidaBucha();
    renderEstoqueBuchas();
  }

  // --- Modal Histórico do Lote ---
  function openHistoricoLoteBucha(id) {
    const entradas = DB.getBuchasEntradas();
    const entrada = entradas.find(e => e.id === id);
    if (!entrada) return;

    if (byId('hist-bucha-op-title')) byId('hist-bucha-op-title').textContent = `Histórico ${entrada.codigoEntrada} (${entrada.sku})`;
    const list = byId('hist-bucha-op-list');
    if (list) {
      list.innerHTML = (entrada.historico || []).map(h => `
        <div style="padding: 10px; border-left: 3px solid var(--accent-teal); background: var(--bg-tertiary); margin-bottom: 8px; border-radius: 4px;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-secondary);">
            <span>${escapeHtml(h.data)}</span>
            <span>${escapeHtml(h.usuario || 'Operador')}</span>
          </div>
          <div style="font-weight:600; margin-top:4px;">${escapeHtml(h.acao || '')}</div>
        </div>
      `).join('') || '<div class="empty-cell">Nenhum histórico gravado.</div>';
    }

    byId('modal-hist-bucha')?.classList.remove('hidden');
  }

  function closeModalHistoricoLoteBucha() {
    byId('modal-hist-bucha')?.classList.add('hidden');
  }

  // Exposição global
  window.renderEstoqueBuchas = renderEstoqueBuchas;
  window.switchEstoqueBuchasTab = switchEstoqueBuchasTab;
  window.openNovaEntradaBucha = openNovaEntradaBucha;
  window.openTransicaoLoteBucha = openTransicaoLoteBucha;
  window.openSaidaBucha = openSaidaBucha;
  window.openHistoricoLoteBucha = openHistoricoLoteBucha;
  window.closeModalHistoricoLoteBucha = closeModalHistoricoLoteBucha;

  // Event Listeners DOM
  document.addEventListener('DOMContentLoaded', () => {
    byId('btn-nova-entrada-bucha')?.addEventListener('click', () => openNovaEntradaBucha());
    byId('modal-nova-entrada-bucha-close')?.addEventListener('click', closeModalNovaEntradaBucha);
    byId('btn-cancel-nova-entrada-bucha')?.addEventListener('click', closeModalNovaEntradaBucha);
    byId('btn-save-nova-entrada-bucha')?.addEventListener('click', saveNovaEntradaBucha);

    byId('btn-saida-bucha')?.addEventListener('click', () => openSaidaBucha());
    byId('modal-saida-bucha-close')?.addEventListener('click', closeModalSaidaBucha);
    byId('btn-cancel-saida-bucha')?.addEventListener('click', closeModalSaidaBucha);
    byId('btn-save-saida-bucha')?.addEventListener('click', saveSaidaBucha);

    byId('modal-transicao-bucha-close')?.addEventListener('click', closeModalTransicaoLoteBucha);
    byId('btn-cancel-transicao-bucha')?.addEventListener('click', closeModalTransicaoLoteBucha);
    byId('btn-save-transicao-bucha')?.addEventListener('click', saveTransicaoLoteBucha);

    byId('modal-hist-bucha-close')?.addEventListener('click', closeModalHistoricoLoteBucha);
    byId('btn-close-hist-bucha')?.addEventListener('click', closeModalHistoricoLoteBucha);

    // Permite fechar modais ao clicar no fundo escuro (overlay)
    ['modal-nova-entrada-bucha', 'modal-transicao-bucha', 'modal-saida-bucha', 'modal-hist-bucha'].forEach(id => {
      const modal = byId(id);
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.classList.add('hidden');
        });
      }
    });

    byId('bucha-op-search')?.addEventListener('input', renderEstoqueBuchas);
    byId('bucha-filter-motor-saldo')?.addEventListener('change', renderEstoqueBuchas);
    byId('bucha-op-limpar-filtros')?.addEventListener('click', () => {
      if (byId('bucha-op-search')) byId('bucha-op-search').value = '';
      if (byId('bucha-filter-motor-saldo')) byId('bucha-filter-motor-saldo').value = '';
      renderEstoqueBuchas();
    });

    byId('hist-bucha-search')?.addEventListener('input', renderEstoqueBuchas);
    byId('hist-bucha-filter-sku')?.addEventListener('change', renderEstoqueBuchas);
    byId('hist-bucha-filter-tipo')?.addEventListener('change', renderEstoqueBuchas);
    byId('hist-bucha-date-start')?.addEventListener('change', renderEstoqueBuchas);
    byId('hist-bucha-date-end')?.addEventListener('change', renderEstoqueBuchas);
    byId('hist-bucha-clear-filters')?.addEventListener('click', () => {
      if (byId('hist-bucha-search')) byId('hist-bucha-search').value = '';
      if (byId('hist-bucha-filter-sku')) byId('hist-bucha-filter-sku').value = '';
      if (byId('hist-bucha-filter-tipo')) byId('hist-bucha-filter-tipo').value = '';
      if (byId('hist-bucha-date-start')) byId('hist-bucha-date-start').value = '';
      if (byId('hist-bucha-date-end')) byId('hist-bucha-date-end').value = '';
      renderEstoqueBuchas();
    });
  });
})();
