/* ═══════════════════════════════════════════════════════════════
   programacao-fundicao.js – Módulo de Programação de Fundição de Hélices
   Ranking por Criticidade & Correlação com Análise de Produção
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    expandedCoquilhas: new Set(),
    activeTab: 'ranking', // 'ranking' | 'agendados'
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

  function fmtNumber(num, decimals = 1) {
    const val = Number(num) || 0;
    if (val === 0) return '0';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  function formatDatePt(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T12:00:00'));
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function toggleCoquilhaDetails(coquilha) {
    if (state.expandedCoquilhas.has(coquilha)) {
      state.expandedCoquilhas.delete(coquilha);
    } else {
      state.expandedCoquilhas.add(coquilha);
    }
    renderProgramacaoFundicao();
  }

  function setProgramacaoTab(tab) {
    state.activeTab = tab;
    const btnRanking = byId('pf-tab-ranking-btn');
    const btnAgendados = byId('pf-tab-agendados-btn');
    const secRanking = byId('pf-sec-ranking');
    const secAgendados = byId('pf-sec-agendados');

    if (tab === 'agendados') {
      if (btnRanking) btnRanking.classList.remove('active');
      if (btnAgendados) btnAgendados.classList.add('active');
      if (secRanking) secRanking.style.display = 'none';
      if (secAgendados) secAgendados.style.display = 'block';
    } else {
      if (btnAgendados) btnAgendados.classList.remove('active');
      if (btnRanking) btnRanking.classList.add('active');
      if (secAgendados) secAgendados.style.display = 'none';
      if (secRanking) secRanking.style.display = 'block';
    }
    renderProgramacaoFundicao();
  }

  function getProgramacaoData() {
    if (typeof DB === 'undefined') return [];

    // 1. Obtém os dados de hélices da Análise de Produção (com estoque e OP recomendada)
    let analiseItems = [];
    if (typeof mergeAnaliseWithCatalogo === 'function') {
      analiseItems = mergeAnaliseWithCatalogo(
        (typeof ANALISE_STATE !== 'undefined' && Array.isArray(ANALISE_STATE.coberturaData))
          ? ANALISE_STATE.coberturaData
          : []
      );
    } else if (typeof window.getAnalisePecasRows === 'function') {
      analiseItems = window.getAnalisePecasRows();
    } else {
      analiseItems = DB.getModelos().map(m => ({
        sku: m.sku,
        produto: m.nome,
        codigoBruto: m.codigoBruto,
        estoqueFisico: 0,
        mediaMensal: 0,
        colocarOp: 0
      }));
    }

    // 2. Garante que todas as coquilhas cadastradas no catálogo entrem no mapa
    const coquilhasCatalog = DB.getCoquilhasCatalog();
    const coquilhaMap = new Map();

    coquilhasCatalog.forEach(coq => {
      if (!coq) return;
      coquilhaMap.set(coq, {
        coquilha: coq,
        skus: [],
        mediaTotal: 0,
        estoqueFisicoTotal: 0,
        prodNecTotal: 0,
        pesoUnitario: DB.getCoquilhaPeso(coq) || 0,
      });
    });

    // 3. Agrupa as hélices pela sua Coquilha (Código Bruto)
    analiseItems.forEach(item => {
      let rawCoq = String(item.codigoBruto || item.coquilha || '').trim();
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') {
        const foundModel = DB.getModelos().find(m => m.sku === item.sku);
        if (foundModel && foundModel.codigoBruto) {
          rawCoq = String(foundModel.codigoBruto).trim();
        }
      }
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') {
        const foundFund = DB.getFundicaoCatalog().find(f => f.sku === item.sku);
        if (foundFund && foundFund.coquilha) {
          rawCoq = String(foundFund.coquilha).trim();
        }
      }
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') return;

      if (!coquilhaMap.has(rawCoq)) {
        coquilhaMap.set(rawCoq, {
          coquilha: rawCoq,
          skus: [],
          mediaTotal: 0,
          estoqueFisicoTotal: 0,
          prodNecTotal: 0,
          pesoUnitario: DB.getCoquilhaPeso(rawCoq) || 0,
        });
      }

      const coqData = coquilhaMap.get(rawCoq);
      const media = Number(item.mediaMensal) || 0;
      const est = Number(item.estoqueFisico) || 0;

      // Quantidade de OP necessária (da Análise de Produção)
      let suggested = 0;
      if (typeof getAnaliseSuggestedQty === 'function') {
        suggested = getAnaliseSuggestedQty(item);
      } else if (item.colocarOp !== undefined) {
        suggested = Number(item.colocarOp) || 0;
      } else if (typeof calculateAnaliseProductionNeed === 'function') {
        suggested = calculateAnaliseProductionNeed(item);
      }

      coqData.skus.push({
        sku: item.sku || item.nome,
        produto: item.produto || item.nome,
        estoqueFisico: est,
        mediaMensal: media,
        opNecessaria: Math.max(0, Math.floor(suggested)),
      });

      coqData.mediaTotal += media;
      coqData.estoqueFisicoTotal += est;
      coqData.prodNecTotal += Math.max(0, Math.floor(suggested));
    });

    // 4. Calcula Cobertura e Status de Criticidade para cada Coquilha
    const list = Array.from(coquilhaMap.values()).map(coqData => {
      const media = coqData.mediaTotal;
      const est = coqData.estoqueFisicoTotal;

      let cobertura = 0;
      if (media > 0) {
        cobertura = est / media;
      } else if (est > 0) {
        cobertura = 999;
      } else {
        cobertura = 0;
      }

      let status = 'SEGURO';
      if (cobertura < 1.0 || (est === 0 && (media > 0 || coqData.prodNecTotal > 0))) {
        status = 'CRÍTICO';
      } else if (cobertura < 3.0) {
        status = 'ALERTA';
      }

      const totLiga = coqData.prodNecTotal * coqData.pesoUnitario;

      return {
        ...coqData,
        cobertura,
        status,
        totLiga
      };
    });

    // 5. Ordenação por Ranking de Criticidade
    const statusOrder = { 'CRÍTICO': 1, 'ALERTA': 2, 'SEGURO': 3 };
    list.sort((a, b) => {
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (a.cobertura !== b.cobertura) {
        return a.cobertura - b.cobertura;
      }
      return b.prodNecTotal - a.prodNecTotal;
    });

    return list;
  }

  function renderProgramacaoFundicao() {
    if (typeof DB === 'undefined') return;

    const data = getProgramacaoData();
    const search = String(byId('fundicao-search')?.value || '').trim().toLowerCase();
    const statusFilter = byId('fundicao-filter-status')?.value || '';

    // Filtragem de busca e status
    let filtered = data;
    if (search) {
      filtered = filtered.filter(item => 
        item.coquilha.toLowerCase().includes(search) ||
        item.skus.some(s => s.sku.toLowerCase().includes(search) || s.produto.toLowerCase().includes(search))
      );
    }
    if (statusFilter) {
      filtered = filtered.filter(item => item.status === statusFilter.toUpperCase() || item.status === statusFilter);
    }

    // KPIs Globais
    const totalBrutos = data.length;
    const criticosAlertas = data.filter(i => i.status === 'CRÍTICO' || i.status === 'ALERTA').length;
    const totalPecasNec = data.reduce((acc, i) => acc + i.prodNecTotal, 0);
    const totalLigaKg = data.reduce((acc, i) => acc + i.totLiga, 0);

    if (byId('kpi-fund-agendadas')) byId('kpi-fund-agendadas').textContent = `${totalBrutos} un`;
    if (byId('kpi-fund-andamento')) byId('kpi-fund-andamento').textContent = `${criticosAlertas} coquilhas`;
    if (byId('kpi-fund-concluidas')) byId('kpi-fund-concluidas').textContent = `${fmtNumber(totalPecasNec, 0)} un`;
    if (byId('kpi-fund-pecas')) byId('kpi-fund-pecas').textContent = `${fmtNumber(totalLigaKg, 1)} kg`;

    // Renderiza Tabela 1: Ranking por Criticidade
    const tbodyRanking = byId('pf-ranking-body');
    if (tbodyRanking) {
      if (!filtered.length) {
        tbodyRanking.innerHTML = '<tr><td colspan="13" class="empty-cell">Nenhuma coquilha encontrada para os filtros informados.</td></tr>';
      } else {
        const today = new Date();

        tbodyRanking.innerHTML = filtered.map((item, index) => {
          const rankNum = index + 1;
          const isExpanded = state.expandedCoquilhas.has(item.coquilha);

          // Cores do Badge de Ranking
          let rankBadgeClass = 'pf-rank-badge--red';
          let statusBadgeClass = 'chip--red';
          if (item.status === 'ALERTA') {
            rankBadgeClass = 'pf-rank-badge--orange';
            statusBadgeClass = 'chip--orange';
          } else if (item.status === 'SEGURO') {
            rankBadgeClass = 'pf-rank-badge--green';
            statusBadgeClass = 'chip--green';
          }

          // Formatadores de Cobertura
          let cobText = `${item.cobertura.toFixed(1)}x`;
          if (item.cobertura === 999) cobText = 'Sem giro';

          // Calculador simples de Prazo de Produção (Dias e Datas)
          const diasEst = item.prodNecTotal > 0 ? Math.max(1, Math.ceil(item.prodNecTotal / 250)) : 0;
          const dataInicio = new Date(today);
          dataInicio.setDate(today.getDate() + index); // Escalona datas pelos itens
          const dataFim = new Date(dataInicio);
          dataFim.setDate(dataInicio.getDate() + Math.max(0, diasEst - 1));

          const dtInicioStr = item.prodNecTotal > 0 ? formatDatePt(dataInicio.toISOString().split('T')[0]) : '—';
          const dtFimStr = item.prodNecTotal > 0 ? formatDatePt(dataFim.toISOString().split('T')[0]) : '—';
          const diasStr = item.prodNecTotal > 0 ? `${diasEst}d` : '—';

          const skusCount = item.skus.length;
          const pesoUnitStr = item.pesoUnitario > 0 ? `${item.pesoUnitario.toFixed(3).replace('.', ',')}` : '—';
          const totLigaStr = item.totLiga > 0 ? `${item.totLiga.toFixed(1).replace('.', ',')}` : '—';

          // Sub-linha expansível de detalhes por modelo de hélice
          const opsChipsHtml = item.skus.map(s => `
            <span class="chip chip--blue font-mono" style="font-size:0.82rem; padding:5px 10px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.4); color:#38bdf8;">
              ${escapeHtml(s.sku)}: <strong style="color:#ffffff;">${s.opNecessaria} pc</strong>
            </span>
          `).join('');

          const estoqueChipsHtml = item.skus.map(s => `
            <span class="chip chip--gray font-mono" style="font-size:0.82rem; padding:5px 10px; background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.3); color:#cbd5e1;">
              ${escapeHtml(s.sku)}: <strong style="color:#ffffff;">${s.estoqueFisico} un</strong>
            </span>
          `).join('');

          return `
            <tr class="pf-row ${isExpanded ? 'expanded' : ''}">
              <td style="text-align: center;">
                <div class="pf-rank-badge ${rankBadgeClass}">${rankNum}</div>
              </td>
              <td>
                <div style="display:flex; flex-direction:column; gap:3px; white-space:nowrap;">
                  <strong style="color:#ffffff; font-weight:800; font-size:0.98rem; letter-spacing:0.02em;">${escapeHtml(item.coquilha)}</strong>
                  <button type="button" class="pf-toggle-btn" onclick="window.toggleCoquilhaDetails('${escapeHtml(item.coquilha)}')">
                    <span style="white-space:nowrap;">${skusCount} modelo(s)</span>
                    <span class="pf-arrow" style="white-space:nowrap;">${isExpanded ? '▲ recolher' : '▼ ver detalhes'}</span>
                  </button>
                </div>
              </td>
              <td class="font-mono" style="color:#e2e8f0; font-weight:600; white-space:nowrap;">${skusCount} hélice(s)</td>
              <td class="font-mono" style="color:#38bdf8; font-weight:700; white-space:nowrap;">${fmtNumber(item.mediaTotal, 1)} <span style="font-size:0.75rem; color:#94a3b8">pçs/mês</span></td>
              <td class="font-mono" style="color:#f8fafc; font-weight:700; font-size:0.95rem; white-space:nowrap;">${fmtNumber(item.estoqueFisicoTotal, 0)}</td>
              <td>
                <span class="pf-status-badge ${statusBadgeClass} font-mono" style="font-weight:800; white-space:nowrap;">${cobText}</span>
              </td>
              <td>
                <span class="pf-status-badge ${statusBadgeClass}" style="font-weight:900; letter-spacing:0.05em; white-space:nowrap;">${item.status}</span>
              </td>
              <td>
                ${item.prodNecTotal > 0 
                  ? `<strong class="font-mono" style="font-size:1.15rem; color:#38bdf8; text-shadow:0 0 10px rgba(56,189,248,0.3); font-weight:800; white-space:nowrap;">${fmtNumber(item.prodNecTotal, 0)}</strong>` 
                  : `<span class="font-mono" style="color:#64748b; font-weight:700; white-space:nowrap;">0</span>`}
              </td>
              <td class="font-mono" style="color:#cbd5e1; font-weight:600; white-space:nowrap;">${pesoUnitStr}</td>
              <td class="font-mono" style="color:#f8fafc; font-weight:800; white-space:nowrap;">${totLigaStr}</td>
              <td class="font-mono" style="color:#fb923c; font-weight:700; white-space:nowrap;">${dtInicioStr}</td>
              <td class="font-mono" style="color:#fb923c; font-weight:700; white-space:nowrap;">${dtFimStr}</td>
              <td class="font-mono" style="color:#cbd5e1; font-weight:700; white-space:nowrap;">${diasStr}</td>
              <td class="catalogo-actions-col" style="text-align: right; white-space:nowrap;">
                <button type="button" class="btn-primary btn-sm pf-action-btn" onclick="window.openCriarLoteFundicao('${escapeHtml(item.coquilha)}', ${item.prodNecTotal}, ${item.pesoUnitario})" title="Gerar Ordem de Fundição">
                  🔥 Agendar
                </button>
              </td>
            </tr>
            ${isExpanded ? `
              <tr class="pf-details-row">
                <td colspan="14" style="background: rgba(15, 23, 42, 0.9); padding: 1.25rem 1.5rem; border-bottom: 2px solid rgba(56, 189, 248, 0.3); border-radius:0 0 8px 8px;">
                  <div style="display:flex; flex-direction:column; gap:1rem;">
                    <div>
                      <div style="font-size:0.8rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.5rem; display:flex; align-items:center; gap:6px;">
                        <span>↳ ANÁLISE DE PRODUÇÃO — OP NECESSÁRIA POR HÉLICE</span>
                      </div>
                      <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${opsChipsHtml || '<span style="color:#94a3b8; font-size:0.85rem;">Nenhuma necessidade calculada.</span>'}
                      </div>
                    </div>
                    <div>
                      <div style="font-size:0.8rem; font-weight:800; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.5rem;">
                        Estoque Físico em Usinagem / Acabado (${fmtNumber(item.estoqueFisicoTotal, 0)} un):
                      </div>
                      <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${estoqueChipsHtml || '<span style="color:#94a3b8; font-size:0.85rem;">Sem estoque físico.</span>'}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            ` : ''}
          `;
        }).join('');
      }
    }

    // Renderiza Tabela 2: Lotes Agendados de Fundição
    const tbodyAgendados = byId('fundicao-body');
    if (tbodyAgendados) {
      let lotes = DB.getFundicoes();
      if (search) lotes = lotes.filter(l => l.modelo.toLowerCase().includes(search) || (l.lote || '').toLowerCase().includes(search));

      if (!lotes.length) {
        tbodyAgendados.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhum lote de fundição agendado.</td></tr>';
      } else {
        const statusChips = {
          'Agendado': '<span class="chip chip--blue">Agendado</span>',
          'Em Fusão': '<span class="chip chip--orange">Em Fusão</span>',
          'Resfriando': '<span class="chip chip--purple">Resfriando</span>',
          'Concluído': '<span class="chip chip--green">Concluído</span>',
          'Cancelado': '<span class="chip chip--gray">Cancelado</span>',
        };

        tbodyAgendados.innerHTML = lotes.map(f => `
          <tr>
            <td><span style="color:var(--accent-blue);font-weight:700">${escapeHtml(f.lote || 'LOTE-FND')}</span></td>
            <td style="color:var(--text-primary);font-weight:600">${escapeHtml(f.modelo)}</td>
            <td><strong>${f.qty}</strong> un</td>
            <td>${escapeHtml(f.liga || 'Alumínio AlMg5')}</td>
            <td>${formatDatePt(f.dataPrevista)}</td>
            <td>${statusChips[f.status] || f.status}</td>
            <td>
              <div style="display:flex;gap:4px;justify-content:center">
                <button class="btn-icon" onclick="window.openEditFundicao('${f.id}')" title="Editar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon danger" onclick="window.deleteFundicao('${f.id}')" title="Excluir">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  function openCriarLoteFundicao(coquilha, qtySugerida = 100, pesoUnitario = 0) {
    if (typeof DB === 'undefined') return;

    if (byId('modal-fundicao-title')) byId('modal-fundicao-title').textContent = `🔥 Agendar Fundição: ${coquilha}`;
    if (byId('fundicao-edit-id')) byId('fundicao-edit-id').value = '';
    
    // Popula select de modelos com a coquilha escolhida ou todas as coquilhas
    const select = byId('fundicao-modelo');
    if (select) {
      const coqs = DB.getCoquilhasCatalog();
      select.innerHTML = [
        `<option value="${escapeHtml(coquilha)}">${escapeHtml(coquilha)} (Coquilha)</option>`,
        ...coqs.filter(c => c !== coquilha).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      ].join('');
      select.value = coquilha;
    }

    const nextLoteNum = (DB.getFundicoes().length + 1).toString().padStart(3, '0');
    if (byId('fundicao-lote')) byId('fundicao-lote').value = `LOTE-FND-${new Date().getFullYear()}-${nextLoteNum}`;
    if (byId('fundicao-qty')) byId('fundicao-qty').value = qtySugerida > 0 ? qtySugerida : 100;
    if (byId('fundicao-liga')) byId('fundicao-liga').value = 'Alumínio AlMg5';
    if (byId('fundicao-data')) byId('fundicao-data').value = new Date().toISOString().split('T')[0];
    if (byId('fundicao-status')) byId('fundicao-status').value = 'Agendado';
    if (byId('fundicao-obs')) byId('fundicao-obs').value = `Agendado via Ranking de Criticidade da Fundição. (Peso Unit: ${pesoUnitario} kg)`;

    byId('modal-fundicao')?.classList.remove('hidden');
  }

  // Exposição global
  window.renderProgramacaoFundicao = renderProgramacaoFundicao;
  window.toggleCoquilhaDetails = toggleCoquilhaDetails;
  window.setProgramacaoTab = setProgramacaoTab;
  window.openCriarLoteFundicao = openCriarLoteFundicao;
  window.getProgramacaoData = getProgramacaoData;

  // Listeners DOM
  document.addEventListener('DOMContentLoaded', () => {
    byId('pf-tab-ranking-btn')?.addEventListener('click', () => setProgramacaoTab('ranking'));
    byId('pf-tab-agendados-btn')?.addEventListener('click', () => setProgramacaoTab('agendados'));

    byId('fundicao-search')?.addEventListener('input', renderProgramacaoFundicao);
    byId('fundicao-filter-status')?.addEventListener('change', renderProgramacaoFundicao);
  });
})();
