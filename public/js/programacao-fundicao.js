/* ═══════════════════════════════════════════════════════════════
   programacao-fundicao.js – Módulo de Programação de Fundição de Hélices
   Análise de Necessidade, Estoque Físico Real e Geração de OPs
   HR Náutica PCP
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const state = {
    expandedCoquilhas: new Set(),
    rawStock: new Map(),
    rawStockVersion: 0,
    rawStockLoading: false
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

  const normalizeRawCode = value => String(value || '').trim().toLocaleUpperCase('pt-BR').replace(/\s+/g, ' ');

  async function refreshRawStock() {
    if (state.rawStockLoading) return;
    state.rawStockLoading = true;
    try {
      const response = await fetch('/api/raw-stock', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Falha ao carregar estoque bruto (HTTP ${response.status}).`);
      state.rawStock = new Map((result.items || []).map(item => [normalizeRawCode(item.rawCode), item]));
      state.rawStockVersion = Number(result.version) || 0;
      renderProgramacaoFundicao();
    } catch (error) {
      if (typeof showToast === 'function') showToast(error.message, 'error');
    } finally {
      state.rawStockLoading = false;
    }
  }

  function getCoquilhaEstoqueFisico(coq) {
    const norm = normalizeRawCode(coq);

    // 1. Saldo do backend sincronizado (/api/raw-stock)
    const fromApi = Number(state.rawStock.get(norm)?.quantity);
    if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;

    // 2. Saldo de materiais do DB local
    if (typeof DB !== 'undefined' && typeof DB.getRawStock === 'function') {
      const fromDb = DB.getRawStock(coq);
      if (fromDb > 0) return fromDb;
    }

    // 3. Saldo acumulado de OPs de Fundição já finalizadas (para consistência imediata)
    if (typeof DB !== 'undefined' && typeof DB.getFundicoes === 'function') {
      const ops = DB.getFundicoes().filter(f =>
        (f.status === 'Fundido' || f.finalizada) &&
        normalizeRawCode(f.coquilha || f.produto || f.modelo) === norm
      );
      const sumFinalized = ops.reduce((acc, f) => acc + (Number(f.qtyProduzida || f.quantidadeProduzida || f.qty) || 0), 0);
      if (sumFinalized > 0) return sumFinalized;
    }

    return fromApi || 0;
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

  function getProgramacaoData() {
    if (typeof DB === 'undefined') return [];

    // 1. Obtém os dados de hélices da Análise de Produção (com estoque acabado e OP recomendada)
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

    // 2. Base cadastral: produtos ativos do Catálogo de Fundição
    const catalog = typeof window.getCombinedCatalog === 'function' 
      ? window.getCombinedCatalog().filter(c => c.ativo !== false)
      : (typeof DB.getFundicaoCatalog === 'function' ? DB.getFundicaoCatalog().filter(c => c.ativo !== false) : []);
    
    const coquilhasCatalog = typeof DB.getCoquilhasCatalog === 'function' ? DB.getCoquilhasCatalog() : [];
    const coquilhaMap = new Map();

    // Registra coquilhas do catálogo
    catalog.forEach(item => {
      const coq = String(item.coquilha || '').trim();
      if (!coq) return;
      coquilhaMap.set(coq, {
        coquilha: coq,
        descricao: item.descricao || `Peça bruta ${coq}`,
        liga: item.liga || 'Alumínio AlMg5',
        skus: [],
        mediaTotal: 0,
        estoqueFisicoTotal: Number(state.rawStock.get(normalizeRawCode(coq))?.quantity) || 0,
        prodNecTotal: 0,
        pesoUnitario: Number(item.peso) || (typeof DB.getCoquilhaPeso === 'function' ? DB.getCoquilhaPeso(coq) : 0),
      });
    });

    // Garante inclusão das coquilhas registradas
    coquilhasCatalog.forEach(coq => {
      if (!coq || coquilhaMap.has(coq)) return;
      coquilhaMap.set(coq, {
        coquilha: coq,
        descricao: `Molde / Coquilha ${coq}`,
        liga: 'Alumínio AlMg5',
        skus: [],
        mediaTotal: 0,
        estoqueFisicoTotal: getCoquilhaEstoqueFisico(coq),
        prodNecTotal: 0,
        pesoUnitario: typeof DB.getCoquilhaPeso === 'function' ? DB.getCoquilhaPeso(coq) : 0,
      });
    });

    // 3. Agrupa as hélices acabadas pela sua Coquilha (Código Bruto)
    analiseItems.forEach(item => {
      let rawCoq = String(item.codigoBruto || item.coquilha || '').trim();
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') {
        const foundModel = DB.getModelos().find(m => m.sku === item.sku);
        if (foundModel && foundModel.codigoBruto) {
          rawCoq = String(foundModel.codigoBruto).trim();
        }
      }
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') {
        const foundFund = catalog.find(f => f.sku === item.sku || (f.aplicacoes && f.aplicacoes.includes(item.sku)));
        if (foundFund && foundFund.coquilha) {
          rawCoq = String(foundFund.coquilha).trim();
        }
      }
      if (!rawCoq || rawCoq === '-' || rawCoq === '—') return;

      if (!coquilhaMap.has(rawCoq)) {
        coquilhaMap.set(rawCoq, {
          coquilha: rawCoq,
          descricao: `Coquilha ${rawCoq}`,
          liga: 'Alumínio AlMg5',
          skus: [],
          mediaTotal: 0,
          estoqueFisicoTotal: getCoquilhaEstoqueFisico(rawCoq),
          prodNecTotal: 0,
          pesoUnitario: typeof DB.getCoquilhaPeso === 'function' ? DB.getCoquilhaPeso(rawCoq) : 0,
        });
      }

      const coqData = coquilhaMap.get(rawCoq);
      const media = Number(item.mediaMensal) || 0;
      const est = Number(item.estoqueFisico) || 0;

      // Quantidade de OP recomendada da usinagem
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

    // 5. Ordenação por Criticidade
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

    let filtered = data;
    if (search) {
      filtered = filtered.filter(item => 
        item.coquilha.toLowerCase().includes(search) ||
        String(item.descricao || '').toLowerCase().includes(search) ||
        item.skus.some(s => s.sku.toLowerCase().includes(search) || s.produto.toLowerCase().includes(search))
      );
    }
    if (statusFilter) {
      filtered = filtered.filter(item => item.status === statusFilter.toUpperCase() || item.status === statusFilter);
    }

    // KPIs Globais de Estoque e Planejamento
    const totalEstoqueFisico = data.reduce((acc, i) => acc + i.estoqueFisicoTotal, 0);
    const criticosAlertas = data.filter(i => i.status === 'CRÍTICO' || i.status === 'ALERTA').length;
    const totalPecasNec = data.reduce((acc, i) => acc + i.prodNecTotal, 0);
    const totalLigaKg = data.reduce((acc, i) => acc + i.totLiga, 0);

    if (byId('kpi-fund-agendadas')) byId('kpi-fund-agendadas').textContent = `${fmtNumber(totalEstoqueFisico, 0)} un`;
    if (byId('kpi-fund-andamento')) byId('kpi-fund-andamento').textContent = `${criticosAlertas} coquilhas`;
    if (byId('kpi-fund-concluidas')) byId('kpi-fund-concluidas').textContent = `${fmtNumber(totalPecasNec, 0)} un`;
    if (byId('kpi-fund-pecas')) byId('kpi-fund-pecas').textContent = `${fmtNumber(totalLigaKg, 1)} kg`;

    // Renderiza Tabela de Estoque & Programação
    const tbody = byId('pf-ranking-body');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty-cell">Nenhum produto de fundição encontrado para os filtros informados.</td></tr>';
      return;
    }

    const today = new Date();

    tbody.innerHTML = filtered.map((item, index) => {
      const rankNum = index + 1;
      const isExpanded = state.expandedCoquilhas.has(item.coquilha);

      let rankBadgeClass = 'pf-rank-badge--red';
      let statusBadgeClass = 'chip--red';
      if (item.status === 'ALERTA') {
        rankBadgeClass = 'pf-rank-badge--orange';
        statusBadgeClass = 'chip--orange';
      } else if (item.status === 'SEGURO') {
        rankBadgeClass = 'pf-rank-badge--green';
        statusBadgeClass = 'chip--green';
      }

      let cobText = `${item.cobertura.toFixed(1)}x`;
      if (item.cobertura === 999) cobText = 'Sem giro';

      const diasEst = item.prodNecTotal > 0 ? Math.max(1, Math.ceil(item.prodNecTotal / 250)) : 0;
      const dataInicio = new Date(today);
      dataInicio.setDate(today.getDate() + index);
      const dataFim = new Date(dataInicio);
      dataFim.setDate(dataInicio.getDate() + Math.max(0, diasEst - 1));

      const dtInicioStr = item.prodNecTotal > 0 ? formatDatePt(dataInicio.toISOString().split('T')[0]) : '—';
      const dtFimStr = item.prodNecTotal > 0 ? formatDatePt(dataFim.toISOString().split('T')[0]) : '—';
      const diasStr = item.prodNecTotal > 0 ? `${diasEst}d` : '—';

      const skusCount = item.skus.length;
      const pesoUnitStr = item.pesoUnitario > 0 ? `${item.pesoUnitario.toFixed(3).replace('.', ',')}` : '—';
      const totLigaStr = item.totLiga > 0 ? `${item.totLiga.toFixed(1).replace('.', ',')}` : '—';

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

      const rawMovements = state.rawStock.get(normalizeRawCode(item.coquilha))?.movements || [];
      const rawMovementsHtml = rawMovements.slice(0, 5).map(movement => `
        <div style="display:flex;justify-content:space-between;gap:12px;color:#cbd5e1;font-size:0.78rem;padding:4px 0;border-bottom:1px solid rgba(148,163,184,.12)">
          <span><strong>${escapeHtml(movement.tipo)}</strong> ${fmtNumber(movement.qty, 0)} un ${movement.opNumero ? `· ${escapeHtml(movement.opNumero)}` : ''}</span>
          <span>${escapeHtml(movement.usuario || 'Usuário')} · ${new Date(movement.data).toLocaleString('pt-BR')}</span>
        </div>
      `).join('');

      return `
        <tr class="pf-row ${isExpanded ? 'expanded' : ''}">
          <td style="width: 50px; text-align: center; white-space: nowrap;">
            <div class="pf-rank-badge ${rankBadgeClass}">${rankNum}</div>
          </td>
          <td style="min-width: 180px; white-space: nowrap;">
            <button type="button" class="pf-toggle-btn" onclick="window.toggleCoquilhaDetails('${escapeHtml(item.coquilha)}')" title="Expandir/recolher modelos de ${escapeHtml(item.coquilha)}">
              <strong style="color:#ffffff; font-weight:800; font-size:1.02rem; letter-spacing:0.02em; white-space:nowrap;">${escapeHtml(item.coquilha)}</strong>
              <span class="pf-arrow" style="font-size:0.85rem; color:#38bdf8; margin-left:6px; display:inline-block;">${isExpanded ? '▲' : '▼'}</span>
            </button>
          </td>
          <td class="font-mono" style="min-width: 140px; color:#38bdf8; font-weight:700; white-space:nowrap;">
            ${fmtNumber(item.mediaTotal, 1)} <span style="font-size:0.75rem; color:#94a3b8">pçs/mês</span>
          </td>
          <td class="font-mono" style="min-width: 110px; color:#f8fafc; font-weight:700; font-size:0.95rem; white-space:nowrap;">
            <strong style="color:#38bdf8; font-size:1.05rem;">${fmtNumber(item.estoqueFisicoTotal, 0)}</strong> <span style="font-size:0.75rem; color:#94a3b8">un</span>
          </td>
          <td style="min-width: 100px; white-space: nowrap;">
            <span class="pf-status-badge ${statusBadgeClass} font-mono" style="font-weight:800; white-space:nowrap;">${cobText}</span>
          </td>
          <td style="min-width: 110px; white-space: nowrap;">
            <span class="pf-status-badge ${statusBadgeClass}" style="font-weight:900; letter-spacing:0.05em; white-space:nowrap;">${item.status}</span>
          </td>
          <td style="min-width: 120px; white-space: nowrap;">
            ${item.prodNecTotal > 0 
              ? `<strong class="font-mono" style="font-size:1.15rem; color:#38bdf8; text-shadow:0 0 10px rgba(56,189,248,0.3); font-weight:800; white-space:nowrap;">${fmtNumber(item.prodNecTotal, 0)}</strong>` 
              : `<span class="font-mono" style="color:#64748b; font-weight:700; white-space:nowrap;">0</span>`}
          </td>
          <td class="font-mono" style="min-width: 95px; color:#cbd5e1; font-weight:600; white-space:nowrap;">${pesoUnitStr}</td>
          <td class="font-mono" style="min-width: 110px; color:#f8fafc; font-weight:800; white-space:nowrap;">${totLigaStr}</td>
          <td class="font-mono" style="min-width: 105px; color:#fb923c; font-weight:700; white-space:nowrap;">${dtInicioStr}</td>
          <td class="font-mono" style="min-width: 105px; color:#fb923c; font-weight:700; white-space:nowrap;">${dtFimStr}</td>
          <td class="font-mono" style="min-width: 70px; color:#cbd5e1; font-weight:700; white-space:nowrap;">${diasStr}</td>
          <td class="catalogo-actions-col" style="min-width: 130px; text-align: right; white-space:nowrap;">
            <button type="button" class="btn-primary btn-sm pf-action-btn" onclick="window.openNovaFundicao('${escapeHtml(item.coquilha)}', ${item.prodNecTotal}, ${item.pesoUnitario})" title="Gerar Ordem de Produção com status Em aberto">
              🔥 Criar OP
            </button>
          </td>
        </tr>
        ${isExpanded ? `
          <tr class="pf-details-row">
            <td colspan="13" style="background: rgba(15, 23, 42, 0.9); padding: 1.25rem 1.5rem; border-bottom: 2px solid rgba(56, 189, 248, 0.3); border-radius:0 0 8px 8px;">
              <div style="display:flex; flex-direction:column; gap:1rem;">
                <div>
                  <div style="font-size:0.8rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.5rem; display:flex; align-items:center; gap:6px;">
                    <span>↳ ANÁLISE DE PRODUÇÃO — OP NECESSÁRIA POR HÉLICE (${skusCount} MODELO(S))</span>
                  </div>
                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${opsChipsHtml || '<span style="color:#94a3b8; font-size:0.85rem;">Nenhuma necessidade calculada.</span>'}
                  </div>
                </div>
                <div>
                  <div style="font-size:0.8rem; font-weight:800; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.5rem;">
                    Estoque de hélices acabadas do Tiny (apenas informativo):
                  </div>
                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${estoqueChipsHtml || '<span style="color:#94a3b8; font-size:0.85rem;">Sem estoque físico.</span>'}
                  </div>
                </div>
                <div>
                  <div style="font-size:0.8rem;font-weight:800;color:#cbd5e1;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">
                    Últimas movimentações do estoque físico bruto
                  </div>
                  ${rawMovementsHtml || '<span style="color:#94a3b8;font-size:0.85rem;">Nenhuma movimentação registrada.</span>'}
                </div>
              </div>
            </td>
          </tr>
        ` : ''}
      `;
    }).join('');
  }

  // Exposição global
  window.renderProgramacaoFundicao = renderProgramacaoFundicao;
  window.toggleCoquilhaDetails = toggleCoquilhaDetails;
  window.getProgramacaoData = getProgramacaoData;
  window.editRawStock = null;
  window.refreshRawStock = refreshRawStock;
  window.getRawStockItem = rawCode => state.rawStock.get(normalizeRawCode(rawCode)) || null;

  // Listeners DOM
  document.addEventListener('DOMContentLoaded', () => {
    refreshRawStock();
    byId('fundicao-search')?.addEventListener('input', renderProgramacaoFundicao);
    byId('fundicao-filter-status')?.addEventListener('change', renderProgramacaoFundicao);
  });
})();
