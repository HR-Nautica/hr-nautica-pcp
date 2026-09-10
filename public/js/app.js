/* ═══════════════════════════════════════════
   app.js – Lógica principal & roteamento
   HR Náutica PCP
   ═══════════════════════════════════════════ */

'use strict';

// ── Seed inicial (Gerenciado pelo SyncManager de forma condicional) ──
// O seed agora só roda se o banco local e de rede estiverem totalmente vazios.

// ── Estado global ─────────────────────────
const STATE = {
  currentPage: 'dashboard',
  charts: {},
  catalogoSort: { field: 'nome', direction: 'asc' },
  catalogoViewMode: 'table',
  selectedBrandFilter: '',
  editingOpId: null,
  editingModeloId: null,
  editingMaterialId: null,
  editingPecaId: null,
  editingFundicaoId: null,
  editingVendaId: null,
  editingBuchaId: null,
  buchasViewMode: 'table',
};

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
function $(id) {
  const el = document.getElementById(id);
  if (!el) {
    return {
      addEventListener: () => {},
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false
      },
      style: {},
      querySelectorAll: () => [],
      closest: () => null,
      options: [],
      value: '',
      textContent: '',
      innerHTML: ''
    };
  }
  return el;
}

function showToast(msg, type = 'success') {
  const t = $('toast');
  t.className = `toast ${type}`;
  $('toast-msg').textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function isAtrasado(prazoISO) {
  if (!prazoISO) return false;
  return new Date(prazoISO) < new Date();
}

function diasAtraso(prazoISO) {
  const diff = new Date() - new Date(prazoISO);
  return Math.floor(diff / 86400000);
}

function etapaChip(etapa) {
  const map = {
    'Fila de Espera':    'chip--gray',
    'Injeção/Fundição':  'chip--orange',
    'Usinagem':          'chip--blue',
    'Balanceamento':     'chip--teal',
    'Pintura/Polimento': 'chip--purple',
    'Qualidade':         'chip--orange',
    'Pronto/Entregue':   'chip--green',
  };
  return `<span class="chip ${map[etapa] || 'chip--gray'}">${etapa}</span>`;
}

function prioridadeHtml(p) {
  const cls = { 'Normal': 'priority-normal', 'Alta': 'priority-alta', 'Urgente': 'priority-urgente' };
  return `<span class="${cls[p] || ''}">${p}</span>`;
}

function statusPedidoChip(s) {
  const map = {
    'Aguardando':   'chip--gray',
    'Planejado':    'chip--blue',
    'Em Produção':  'chip--orange',
    'Concluído':    'chip--green',
    'Entregue':     'chip--teal',
  };
  return `<span class="chip ${map[s] || 'chip--gray'}">${s}</span>`;
}

function corDot(cor) {
  const map = { blue: '#60a5fa', teal: '#2dd4bf', green: '#4ade80', orange: '#fb923c', red: '#f87171', purple: '#a78bfa' };
  return map[cor] || '#60a5fa';
}

function etapaIndex(etapa) {
  return ['Fila de Espera','Injeção/Fundição','Usinagem','Balanceamento','Pintura/Polimento','Qualidade','Pronto/Entregue'].indexOf(etapa);
}

// ── Preenche selects de modelo ────────────
function populateModeloSelects() {
  const modelos = DB.getModelos();
  const opts = ['<option value="">— Selecione um modelo —</option>',
    ...modelos.map(m => `<option value="${m.nome}">${m.nome}</option>`)
  ].join('');
  ['op-modelo','peca-modelo','venda-modelo'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = opts;
  });
}

// ── Preenche select de materiais ──────────
function populateMaterialSelect() {
  // Pecas brutas so podem ser movimentadas pelo fluxo transacional dedicado.
  const mats = DB.getMateriais().filter(material => !material.rawCode);
  const opts = ['<option value="">— Selecione —</option>',
    ...mats.map(m => `<option value="${m.id}">${m.nome} (saldo: ${m.saldo} ${m.unidade})</option>`)
  ].join('');
  const el = $('mov-material');
  if (el) el.innerHTML = opts;
}

// ── Preenche select de OPs no modal mov ──
function populateOpSelectMov() {
  const ops = DB.getOps();
  const opts = ['<option value="">— Nenhuma —</option>',
    ...ops.map(o => `<option value="${o.id}">${o.numero} – ${o.modelo}</option>`)
  ].join('');
  const el = $('mov-op');
  if (el) el.innerHTML = opts;
}

// ═══════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════
function navigate(page) {
  const isOperator = window.PCP_USER_ROLE !== 'admin';
  const RESTRICTED_PAGES = ['ordens', 'modelos', 'manutencao', 'relatorios', 'estoque', 'vini', 'usuarios'];
  
  if (isOperator && RESTRICTED_PAGES.includes(page)) {
    page = 'dashboard';
  }

  // Oculta todas as páginas
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  // Remove active de todos os nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Mostra página e ativa nav
  const pageEl = $(`page-${page}`);
  if (pageEl) pageEl.classList.remove('hidden');
  const navEl = $(`nav-${page}`);
  if (navEl) navEl.classList.add('active');

  STATE.currentPage = page;

  // Renderiza a página
  switch (page) {
    case 'dashboard':   renderDashboard();   break;
    case 'sync':
      if (typeof initSyncManagerPage === 'function') initSyncManagerPage();
      break;
    case 'sync-vini':
      if (typeof initSyncViniPage === 'function') initSyncViniPage();
      break;
    case 'ordens':
      if (typeof initAnaliseModule === 'function') initAnaliseModule();
      else if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
      break;
    case 'modelos':     renderModelos();     break;
    case 'buchas':      renderBuchas();      break;
    case 'estoque-buchas':
      if (typeof renderEstoqueBuchas === 'function') renderEstoqueBuchas();
      break;
    case 'estoque':     renderEstoque();     break;
    case 'fundicao':    renderFundicao();    break;
    case 'catalogo-fundicao':
      if (typeof renderCatalogoFundicao === 'function') renderCatalogoFundicao();
      break;
    case 'rastreio-fundicao':
      if (typeof renderRastreioFundicao === 'function') renderRastreioFundicao();
      break;
    case 'manutencao':  renderManutencao();  break;
    case 'fluxo':       renderFluxo();       break;
    case 'expedicao':   renderExpedicao();   break;
    case 'relatorios':  renderRelatorios();  break;
    case 'vini':
      if (typeof renderViniTable === 'function') renderViniTable();
      break;
    case 'producao-componentes':
      if (typeof prodComp_render === 'function') prodComp_render();
      break;
    case 'usuarios':
      if (typeof renderUsuarios === 'function') renderUsuarios();
      break;
  }
}

// ═══════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════
function renderDashboard() {
  const ops      = DB.getOps();
  const modelos  = DB.getModelos();
  const config   = DB.getConfig();

  // KPIs
  const ativas   = ops.filter(o => o.etapa !== 'Pronto/Entregue').length;
  const prontas  = ops.filter(o => o.etapa === 'Pronto/Entregue').length;
  const meta     = config.meta || 100;
  const pct      = Math.min(100, Math.round((prontas / meta) * 100));

  $('kpi-ops-ativas').textContent = ativas;
  $('kpi-prontas').textContent    = prontas;
  $('kpi-meta').textContent       = pct + '%';
  $('kpi-meta-sub').textContent   = `${prontas} de ${meta} hélices`;
  $('kpi-modelos').textContent    = modelos.length;

  // OPs recentes (últimas 5)
  renderOpsRecentesTable(ops.slice(-5).reverse());

  // Atividades
  renderAtividades();

  // Gráfico
  renderFluxoChart(ops);
}

function renderOpsRecentesTable(ops) {
  const tbody = $('ops-recentes-body');
  if (!ops.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhuma ordem de produção cadastrada.</td></tr>';
    return;
  }
  tbody.innerHTML = ops.map(op => {
    const atrasado = isAtrasado(op.prazo) && op.etapa !== 'Pronto/Entregue';
    return `<tr>
      <td><span style="color:var(--accent-blue);font-weight:700">${op.numero}</span></td>
      <td style="color:var(--text-primary);font-weight:500">${op.modelo}</td>
      <td>${op.cliente || '—'}</td>
      <td>${etapaChip(op.etapa)}</td>
      <td class="${atrasado ? 'priority-urgente' : ''}">${formatDate(op.prazo)}${atrasado ? ' · Atrasada' : ''}</td>
      <td>${etapaChip(op.etapa)}</td>
    </tr>`;
  }).join('');
}

function renderAtividades() {
  const list = DB.getAtividades();
  const el = $('activity-list');
  if (!list.length) {
    el.innerHTML = `<div class="activity-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Nenhuma atividade recente registrada.</p>
    </div>`;
    return;
  }
  el.innerHTML = list.slice(0,15).map(a => `
    <div class="activity-item">
      <div class="activity-dot" style="background:${corDot(a.cor)}"></div>
      <div class="activity-content">
        <div class="activity-title">${a.titulo}</div>
        <div class="activity-time">${formatDateTime(a.data)}</div>
      </div>
    </div>
  `).join('');
}

function renderFluxoChart(ops) {
  const etapas = ['Fila de Espera','Injeção/Fundição','Usinagem','Balanceamento','Pintura/Polimento','Qualidade','Pronto/Entregue'];
  const counts = etapas.map(e => ops.filter(o => o.etapa === e).length);

  const canvas = $('fluxo-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (STATE.charts.fluxo) STATE.charts.fluxo.destroy();

  STATE.charts.fluxo = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: etapas.map(e => e.replace('/', '/\n')),
      datasets: [{
        data: counts,
        backgroundColor: [
          'rgba(139,148,163,0.5)',
          'rgba(251,146,60,0.6)',
          'rgba(96,165,250,0.6)',
          'rgba(45,212,191,0.6)',
          'rgba(167,139,250,0.6)',
          'rgba(251,146,60,0.6)',
          'rgba(74,222,128,0.6)',
        ],
        borderColor: [
          'rgba(139,148,163,0.9)',
          'rgba(251,146,60,0.9)',
          'rgba(96,165,250,0.9)',
          'rgba(45,212,191,0.9)',
          'rgba(167,139,250,0.9)',
          'rgba(251,146,60,0.9)',
          'rgba(74,222,128,0.9)',
        ],
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a2235',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        titleColor: '#e8edf5',
        bodyColor: '#8a96a8',
        callbacks: { label: ctx => ` ${ctx.parsed.y} op(s)` }
      }},
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8a96a8', font: { size: 11, family: 'Inter' } }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8a96a8', stepSize: 1, font: { size: 11, family: 'Inter' } },
          beginAtZero: true,
        }
      }
    }
  });
}

// ═══════════════════════════════════════════
// ORDENS DE PRODUÇÃO – KANBAN
// ═══════════════════════════════════════════
const ETAPAS = ['Fila de Espera','Injeção/Fundição','Usinagem','Balanceamento','Pintura/Polimento','Qualidade','Pronto/Entregue'];

function renderOrdens() {
  if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
}

function kanbanCard(op) {
  const atrasado = isAtrasado(op.prazo) && op.etapa !== 'Pronto/Entregue';
  const prioBadge = op.prioridade !== 'Normal'
    ? `<span class="chip ${op.prioridade === 'Urgente' ? 'chip--red' : 'chip--orange'}" style="font-size:0.65rem;padding:2px 6px">${op.prioridade}</span>`
    : '';

  let estoqueBadge = '';
  if (op.etapa !== 'Pronto/Entregue') {
    const reqs = DB.getOpRequirements(op.modelo, op.qty);
    if (reqs && (reqs.bucha || reqs.caixa)) {
      const buchaFalta = reqs.bucha ? reqs.bucha.insuficiente : false;
      const caixaFalta = reqs.caixa ? reqs.caixa.insuficiente : false;
      if (buchaFalta || caixaFalta) {
        estoqueBadge = `<span class="chip chip--red" style="font-size:0.65rem;padding:2px 6px" title="Falta de insumos no estoque">Falta insumos</span>`;
      } else {
        estoqueBadge = `<span class="chip chip--green" style="font-size:0.65rem;padding:2px 6px" title="Estoque de insumos OK">Estoque OK</span>`;
      }
    }
  }

  return `<div class="kanban-card" data-id="${op.id}">
    <div class="kanban-card-top">
      <span class="kanban-card-op">${op.numero}</span>
      <div style="display:flex;gap:4px">
        ${prioBadge}
        ${estoqueBadge}
      </div>
    </div>
    <div class="kanban-card-model" title="${op.modelo}">${op.modelo}</div>
    <div class="kanban-card-client">${op.cliente || 'Sem cliente'} Â· Qtd: ${op.qty}</div>
    <div class="kanban-card-footer">
      <span class="kanban-card-prazo ${atrasado ? 'atrasado' : ''}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${atrasado ? 'Atrasada · ' : ''}${formatDate(op.prazo)}
      </span>
      <button class="btn-icon danger" onclick="event.stopPropagation(); deleteOp('${op.id}')" title="Excluir OP">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </div>
  </div>`;
}

async function deleteOp(id) {
  if (!confirm('Excluir esta Ordem de Produção?')) return;
  try {
    const response = await fetch(`/api/production-ops/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-PCP-User': window.PCP_CURRENT_USER || '' },
      body: JSON.stringify({ expectedVersion: RemoteStorage.versions.get(DB.KEYS.ops) || 0 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Falha ao cancelar OP (HTTP ${response.status}).`);
    RemoteStorage.applyServerState(DB.KEYS.ops, result.operations, result.version, result.revision);
    renderOrdens();
    if (typeof window.refreshRawStock === 'function') await window.refreshRawStock();
    if (STATE.currentPage === 'dashboard') renderDashboard();
    showToast('Ordem cancelada e estoque bruto estornado.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}
window.deleteOp = deleteOp;

// ═══════════════════════════════════════════
// MODAL OP
// ═══════════════════════════════════════════
function updateOpInsumosPreview() {
  const modelo = $('op-modelo').value;
  const qty = parseInt($('op-qty').value) || 1;
  const previewDiv = $('op-insumos-preview');
  const listDiv = $('op-insumos-list');

  if (!previewDiv || !listDiv) return;

  if (!modelo) {
    previewDiv.style.display = 'none';
    return;
  }

  const reqs = DB.getOpRequirements(modelo, qty);
  if (!reqs || (!reqs.bruto && !reqs.bucha && !reqs.caixa)) {
    previewDiv.style.display = 'none';
    return;
  }

  previewDiv.style.display = 'block';
  listDiv.innerHTML = '';

  if (reqs.bruto) {
    const bruto = reqs.bruto;
    const badgeClass = bruto.insuficiente ? 'op-insumo-badge--warn' : 'op-insumo-badge--ok';
    const badgeText = bruto.insuficiente ? `Falta ${bruto.falta} un` : 'Estoque OK';
    const cardClass = bruto.insuficiente ? 'op-insumo-card--warn' : 'op-insumo-card--ok';
    const statusAction = bruto.insuficiente
      ? `<div class="op-insumo-action op-insumo-action--warn">Fundir / produzir bruto</div>`
      : `<div class="op-insumo-action op-insumo-action--ok">Disponível para usinagem</div>`;

    listDiv.innerHTML += `
      <div class="op-insumo-card ${cardClass}" title="${bruto.nome}">
        <div class="op-insumo-type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 3h12l4 6-10 12L2 9l4-6z"/>
          </svg>
          Peça Bruta
        </div>
        <div class="op-insumo-name" title="${bruto.nome}">${bruto.nome}</div>
        <div class="op-insumo-metrics">
          <span>Qtd: <strong>${qty}</strong> | Saldo: <strong>${bruto.saldo}</strong></span>
          <span class="op-insumo-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${statusAction}
      </div>
    `;
  }

  // Render Bucha
  if (reqs.bucha) {
    const b = reqs.bucha;
    const badgeClass = b.insuficiente ? 'op-insumo-badge--warn' : 'op-insumo-badge--ok';
    const badgeText = b.insuficiente ? `Falta ${b.falta} un` : 'Estoque OK';
    const cardClass = b.insuficiente ? 'op-insumo-card--warn' : 'op-insumo-card--ok';
    const statusAction = b.insuficiente 
      ? `<div class="op-insumo-action op-insumo-action--warn">Produzir bucha</div>`
      : `<div class="op-insumo-action op-insumo-action--ok">Estoque disponível</div>`;
      
    listDiv.innerHTML += `
      <div class="op-insumo-card ${cardClass}" title="${b.nome}">
        <div class="op-insumo-type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Bucha
        </div>
        <div class="op-insumo-name" title="${b.nome}">${b.nome}</div>
        <div class="op-insumo-metrics">
          <span>Qtd: <strong>${qty}</strong> | Saldo: <strong>${b.saldo}</strong></span>
          <span class="op-insumo-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${statusAction}
      </div>
    `;
  } else {
    listDiv.innerHTML += `
      <div class="op-insumo-card op-insumo-card--empty">
        <span>Sem bucha vinculada</span>
      </div>
    `;
  }

  // Render Caixa
  if (reqs.caixa) {
    const c = reqs.caixa;
    const badgeClass = c.insuficiente ? 'op-insumo-badge--warn' : 'op-insumo-badge--ok';
    const badgeText = c.insuficiente ? `Falta ${c.falta} un` : 'Estoque OK';
    const cardClass = c.insuficiente ? 'op-insumo-card--warn' : 'op-insumo-card--ok';
    const statusAction = c.insuficiente 
      ? `<div class="op-insumo-action op-insumo-action--warn">Comprar caixa</div>`
      : `<div class="op-insumo-action op-insumo-action--ok">Estoque disponível</div>`;
      
    listDiv.innerHTML += `
      <div class="op-insumo-card ${cardClass}" title="${c.nome}">
        <div class="op-insumo-type">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          Caixa
        </div>
        <div class="op-insumo-name" title="${c.nome}">${c.nome}</div>
        <div class="op-insumo-metrics">
          <span>Qtd: <strong>${qty}</strong> | Saldo: <strong>${c.saldo}</strong></span>
          <span class="op-insumo-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${statusAction}
      </div>
    `;
  } else {
    listDiv.innerHTML += `
      <div class="op-insumo-card op-insumo-card--empty">
        <span>Sem caixa vinculada</span>
      </div>
    `;
  }
}

function openNovaOp() {
  STATE.editingOpId = null;
  $('modal-op-title').textContent = 'Nova Ordem de Produção';
  $('op-edit-id').value = '';
  $('op-modelo').value = '';
  $('op-qty').value = 1;
  $('op-cliente').value = '';
  $('op-prazo').value = '';
  $('op-etapa').value = 'Fila de Espera';
  $('op-prioridade').value = 'Normal';
  $('op-obs').value = '';
  populateModeloSelects();
  updateOpInsumosPreview();
  $('modal-op').classList.remove('hidden');
}

function openEditOp(id) {
  const op = DB.getOpById(id);
  if (!op) return;
  STATE.editingOpId = id;
  $('modal-op-title').textContent = `Editar – ${op.numero}`;
  $('op-edit-id').value = id;
  populateModeloSelects();
  $('op-modelo').value    = op.modelo;
  $('op-qty').value       = op.qty;
  $('op-cliente').value   = op.cliente;
  $('op-prazo').value     = op.prazo;
  $('op-etapa').value     = op.etapa;
  $('op-prioridade').value= op.prioridade;
  $('op-obs').value       = op.obs;
  updateOpInsumosPreview();
  $('modal-op').classList.remove('hidden');
}

function closeModalOp() { $('modal-op').classList.add('hidden'); }

async function saveOp() {
  const modelo = $('op-modelo').value.trim();
  const prazo  = $('op-prazo').value;
  if (!modelo) { showToast('Selecione um modelo de hélice.', 'error'); return; }
  if (!prazo)  { showToast('Informe o prazo de entrega.', 'error'); return; }

  const data = {
    modelo,
    qty:        parseInt($('op-qty').value) || 1,
    cliente:    $('op-cliente').value.trim(),
    prazo,
    etapa:      $('op-etapa').value,
    prioridade: $('op-prioridade').value,
    obs:        $('op-obs').value.trim(),
  };

  const saveButton = $('btn-save-op');
  if (saveButton) saveButton.disabled = true;
  try {
    const editingId = STATE.editingOpId;
    const response = await fetch(editingId ? `/api/production-ops/${encodeURIComponent(editingId)}` : '/api/production-ops', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PCP-User': window.PCP_CURRENT_USER || '' },
      body: JSON.stringify({ data, expectedVersion: RemoteStorage.versions.get(DB.KEYS.ops) || 0 })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Falha ao salvar OP (HTTP ${response.status}).`);
    RemoteStorage.applyServerState(DB.KEYS.ops, result.operations, result.version, result.revision);
    if (typeof window.refreshRawStock === 'function') await window.refreshRawStock();
    showToast(editingId ? 'Ordem de produção atualizada!' : `Ordem criada e ${data.qty} unidade(s) do bruto consumida(s).`);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  } finally {
    if (saveButton) saveButton.disabled = false;
  }

  closeModalOp();
  if (STATE.currentPage === 'ordens') {
    if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
  }
  if (STATE.currentPage === 'dashboard') renderDashboard();
  navigate('ordens');
}

// ═══════════════════════════════════════════
// MODELOS DE HÉLICES
// ═══════════════════════════════════════════
const CATALOGO_FORM_FIELDS = {
  nome: 'modelo-nome',
  sku: 'modelo-sku',
  codigoBruto: 'modelo-codigo-bruto',
  diametroTuboAnel: 'modelo-diametro-tubo-anel',
  descricaoTinyTuboAl: 'modelo-descricao-tubo',
  skuTinyTuboAl: 'modelo-sku-tubo',
  comprimentoAnel: 'modelo-comprimento-anel',
  anel: 'modelo-anel',
  diametroLataoBucha: 'modelo-diametro-latao',
  descricaoTinyLatao: 'modelo-descricao-latao',
  skuTinyLatao: 'modelo-sku-latao',
  comprimentoBucha: 'modelo-comprimento-bucha',
  bucha: 'modelo-bucha',
  cor: 'modelo-cor',
  alturaBuchas: 'modelo-altura-buchas',
  modeloBucha: 'modelo-modelo-bucha',
  skuBucha: 'modelo-sku-bucha',
  descricaoCaixa: 'modelo-descricao-caixa',
  skuCaixa: 'modelo-sku-caixa',
};

function escapeCatalogoHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function catalogoDimensions(description) {
  const match = String(description || '').match(/(\d+(?:[.,]\d+|\s+\d+\/\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+|\s+\d+\/\d+)?)/);
  return match ? { diametro: match[1], passo: match[2] } : { diametro: '', passo: '' };
}

function catalogoFillForm(modelo = {}) {
  Object.entries(CATALOGO_FORM_FIELDS).forEach(([field, id]) => {
    $(id).value = modelo[field] ?? '';
  });
}

function catalogoReadForm() {
  const data = Object.fromEntries(
    Object.entries(CATALOGO_FORM_FIELDS).map(([field, id]) => [field, $(id).value.trim()])
  );
  return {
    ...data,
    pas: '3',
    material: 'Alumínio',
    ...catalogoDimensions(data.nome),
  };
}

function catalogoMarca(nome) {
  return String(nome || '')
    .replace(/^H[ÉE]LICE\s+/i, '')
    .trim()
    .split(/\s+/)[0] || 'OUTRA';
}

function extractHeliceSpecs(nome) {
  const str = String(nome || '').trim();
  const brand = catalogoMarca(str);
  const dimMatch = str.match(/(\d+(?:\s+\d+\/\d+)?\s*[X×]\s*\d+(?:\s+\d+\/\d+)?)/i);
  const dim = dimMatch ? dimMatch[1].replace(/\s*[X×]\s*/i, ' × ') : '';
  const hpMatch = str.match(/(\d+(?:[\/\-]\d+)?\s*HP)/i);
  const hp = hpMatch ? hpMatch[1] : '';
  return { brand, dim, hp };
}

function catalogoFillFilter(id, values, placeholder) {
  const select = $(id);
  const selected = select.value;
  const options = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  select.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...options.map((value) => `<option value="${escapeCatalogoHtml(value)}">${escapeCatalogoHtml(value)}</option>`),
  ].join('');
  if (options.includes(selected)) select.value = selected;
}

function catalogoPopulateFilters(modelos) {
  catalogoFillFilter('catalogo-filter-marca', modelos.map((modelo) => catalogoMarca(modelo.nome)), 'Todas as marcas');
  catalogoFillFilter('catalogo-filter-bruto', modelos.map((modelo) => modelo.codigoBruto), 'Todos os códigos');
  catalogoFillFilter('catalogo-filter-bucha', modelos.map((modelo) => modelo.modeloBucha), 'Todas as buchas');
  catalogoFillFilter('catalogo-filter-cor', modelos.map((modelo) => modelo.cor), 'Todas as cores');
}

function openFichaTecnica(id) {
  const modelo = DB.getModelos().find((m) => m.id === id);
  if (!modelo) return;

  const { brand, dim, hp } = extractHeliceSpecs(modelo.nome);
  const cor = modelo.cor || '—';
  const buchaDesc = modelo.modeloBucha || '—';

  $('ficha-title').textContent = modelo.nome;
  $('ficha-subtitle').textContent = `SKU: ${modelo.sku} | Código Bruto: ${modelo.codigoBruto || '—'}`;

  const body = $('ficha-body');
  body.innerHTML = `
    <div class="ficha-top-bar">
      <span class="catalogo-brand-badge brand-${brand.toLowerCase()}">${brand}</span>
      ${hp ? `<span class="catalogo-hp-badge">${hp}</span>` : ''}
      ${dim ? `<span class="catalogo-dim-badge">${dim}</span>` : ''}
      <span class="catalogo-sku-pill">${escapeCatalogoHtml(modelo.sku)}</span>
    </div>

    <div class="ficha-sections-grid">
      <div class="ficha-card-section">
        <h4>Identificação geral</h4>
        <div class="ficha-spec-row"><span>Descrição da Hélice:</span><strong>${escapeCatalogoHtml(modelo.nome)}</strong></div>
        <div class="ficha-spec-row"><span>Código SKU:</span><strong>${escapeCatalogoHtml(modelo.sku)}</strong></div>
        <div class="ficha-spec-row"><span>Código Bruto:</span><strong>${escapeCatalogoHtml(modelo.codigoBruto || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Acabamento/Cor:</span><strong>${escapeCatalogoHtml(cor)}</strong></div>
        <div class="ficha-spec-row"><span>Altura Buchas:</span><strong>${escapeCatalogoHtml(modelo.alturaBuchas || '—')}</strong></div>
      </div>

      <div class="ficha-card-section">
        <h4>Anel e tubo de alumínio</h4>
        <div class="ficha-spec-row"><span>Diâmetro Tubo Anel:</span><strong>${escapeCatalogoHtml(modelo.diametroTuboAnel || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Comp. Anel:</span><strong>${escapeCatalogoHtml(modelo.comprimentoAnel || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Anel:</span><strong>${escapeCatalogoHtml(modelo.anel || '—')}</strong></div>
        <div class="ficha-spec-row"><span>SKU Tiny Tubo Al.:</span><strong>${escapeCatalogoHtml(modelo.skuTinyTuboAl || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Descrição Tiny Tubo Al.:</span><strong>${escapeCatalogoHtml(modelo.descricaoTubo || '—')}</strong></div>
      </div>

      <div class="ficha-card-section">
        <h4>Bucha e latão</h4>
        <div class="ficha-spec-row"><span>Diâmetro Latão:</span><strong>${escapeCatalogoHtml(modelo.diametroLatao || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Comp. Bucha:</span><strong>${escapeCatalogoHtml(modelo.comprimentoBucha || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Bucha Modelo:</span><strong>${escapeCatalogoHtml(modelo.bucha || '—')}</strong></div>
        <div class="ficha-spec-row"><span>SKU Tiny Latão:</span><strong>${escapeCatalogoHtml(modelo.skuLatao || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Descrição Tiny Latão:</span><strong>${escapeCatalogoHtml(modelo.descricaoLatao || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Código SKU Bucha:</span><strong>${escapeCatalogoHtml(modelo.skuBucha || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Descrição da Bucha:</span><strong>${escapeCatalogoHtml(buchaDesc)}</strong></div>
      </div>

      <div class="ficha-card-section">
        <h4>Embalagem</h4>
        <div class="ficha-spec-row"><span>Código SKU Caixa:</span><strong>${escapeCatalogoHtml(modelo.skuCaixa || '—')}</strong></div>
        <div class="ficha-spec-row"><span>Descrição Caixa:</span><strong>${escapeCatalogoHtml(modelo.descricaoCaixa || '—')}</strong></div>
      </div>
    </div>
  `;

  $('btn-ficha-editar').onclick = () => {
    closeModalFichaTecnica();
    openEditModelo(id);
  };

  $('modal-ficha-tecnica').classList.remove('hidden');
}
window.openFichaTecnica = openFichaTecnica;

function closeModalFichaTecnica() {
  $('modal-ficha-tecnica').classList.add('hidden');
}

window.filterCatalogoBrand = function(brand) {
  STATE.selectedBrandFilter = brand;
  $('catalogo-filter-marca').value = brand;
  renderModelos();
};

window.setCatalogoViewMode = function(mode) {
  STATE.catalogoViewMode = mode;
  const tableView = $('catalogo-table-view');
  const cardsView = $('catalogo-cards-view');
  const btnTable = $('btn-catalogo-view-table');
  const btnCards = $('btn-catalogo-view-cards');

  if (mode === 'cards') {
    if (tableView) tableView.classList.add('hidden');
    if (cardsView) cardsView.classList.remove('hidden');
    if (btnTable) btnTable.classList.remove('active');
    if (btnCards) btnCards.classList.add('active');
  } else {
    if (cardsView) cardsView.classList.add('hidden');
    if (tableView) tableView.classList.remove('hidden');
    if (btnCards) btnCards.classList.remove('active');
    if (btnTable) btnTable.classList.add('active');
  }
  renderModelos();
};

function renderCatalogoModelos() {
  const all = DB.getModelos();
  catalogoPopulateFilters(all);
  const search = ($('modelo-search').value || '').trim().toLocaleLowerCase('pt-BR');
  const filters = {
    marca: $('catalogo-filter-marca').value,
    bruto: $('catalogo-filter-bruto').value,
    bucha: $('catalogo-filter-bucha').value,
    cor: $('catalogo-filter-cor').value,
  };
  const searchableFields = ['nome', 'sku', 'codigoBruto', 'skuTinyTuboAl', 'modeloBucha', 'skuBucha', 'skuCaixa'];
  const list = all
    .filter((modelo) => !search || searchableFields.some((field) =>
      String(modelo[field] || '').toLocaleLowerCase('pt-BR').includes(search)
    ))
    .filter((modelo) => !filters.marca || catalogoMarca(modelo.nome) === filters.marca)
    .filter((modelo) => !filters.bruto || modelo.codigoBruto === filters.bruto)
    .filter((modelo) => !filters.bucha || modelo.modeloBucha === filters.bucha)
    .filter((modelo) => !filters.cor || modelo.cor === filters.cor)
    .sort((a, b) => {
      const result = String(a[STATE.catalogoSort.field] || '').localeCompare(
        String(b[STATE.catalogoSort.field] || ''),
        'pt-BR',
        { numeric: true, sensitivity: 'base' }
      );
      return STATE.catalogoSort.direction === 'asc' ? result : -result;
    });

  document.querySelectorAll('.catalogo-sort-btn').forEach((button) => {
    const active = button.dataset.catalogoSort === STATE.catalogoSort.field;
    button.textContent = active ? (STATE.catalogoSort.direction === 'asc' ? '↑' : '↓') : '↕';
    button.classList.toggle('catalogo-sort-btn--active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const meaningfulDistinct = (field) => new Set(
    all.map((modelo) => String(modelo[field] || '').trim())
      .filter((value) => value && value !== 'N/A' && value !== 'N/T')
  ).size;

  $('catalogo-total').textContent = String(all.length);
  $('catalogo-com-caixa').textContent = String(all.filter((modelo) =>
    modelo.descricaoCaixa && modelo.descricaoCaixa !== 'N/A'
  ).length);
  $('catalogo-tubos').textContent = String(meaningfulDistinct('diametroTuboAnel'));
  $('catalogo-buchas').textContent = String(meaningfulDistinct('modeloBucha'));
  $('catalogo-count').textContent = `${list.length} de ${all.length} ${all.length === 1 ? 'item' : 'itens'}`;
  $('catalogo-limpar-filtros').disabled = !search && !Object.values(filters).some(Boolean);

  // Renderizar Barra de Pills por Marca
  const brandPillsContainer = $('catalogo-brand-pills');
  if (brandPillsContainer) {
    const brandsMap = {};
    all.forEach(m => {
      const b = catalogoMarca(m.nome);
      brandsMap[b] = (brandsMap[b] || 0) + 1;
    });
    const sortedBrands = Object.keys(brandsMap).sort((a, b) => brandsMap[b] - brandsMap[a]);
    
    let pillsHtml = `
      <button type="button" class="catalogo-brand-pill ${!filters.marca ? 'active' : ''}" onclick="filterCatalogoBrand('')">
        Todas <span class="pill-count">${all.length}</span>
      </button>
    `;
    sortedBrands.forEach(b => {
      pillsHtml += `
        <button type="button" class="catalogo-brand-pill brand-${b.toLowerCase()} ${filters.marca === b ? 'active' : ''}" onclick="filterCatalogoBrand('${b}')">
          ${b} <span class="pill-count">${brandsMap[b]}</span>
        </button>
      `;
    });
    brandPillsContainer.innerHTML = pillsHtml;
  }

  // Renderizar Grade de Cards se estiver no modo Cards
  const cardsGrid = $('modelos-cards-grid');
  if (cardsGrid) {
    if (!list.length) {
      cardsGrid.innerHTML = '<div class="empty-cell" style="grid-column:1/-1;padding:2rem;">Nenhuma hélice encontrada.</div>';
    } else {
      cardsGrid.innerHTML = list.map((modelo) => {
        const cor = modelo.cor || '—';
        const buchaDescricao = modelo.modeloBucha || '—';
        const { brand, dim, hp } = extractHeliceSpecs(modelo.nome);
        return `
          <div class="catalogo-card-item">
            <div class="catalogo-card-header">
              <div class="catalogo-card-brand-wrap">
                <span class="catalogo-brand-badge brand-${brand.toLowerCase()}">${brand}</span>
                ${hp ? `<span class="catalogo-hp-badge">${hp}</span>` : ''}
              </div>
              <span class="catalogo-sku">${escapeCatalogoHtml(modelo.sku)}</span>
            </div>
            <div class="catalogo-card-body">
              <h3 class="catalogo-card-title">${escapeCatalogoHtml(modelo.nome)}</h3>
              ${dim ? `<div class="catalogo-card-dim">${dim}</div>` : ''}
              <div class="catalogo-card-specs">
                <div class="catalogo-card-spec"><span>Bruto:</span><strong>${escapeCatalogoHtml(modelo.codigoBruto || '—')}</strong></div>
                <div class="catalogo-card-spec"><span>Cor:</span><strong>${escapeCatalogoHtml(cor)}</strong></div>
                <div class="catalogo-card-spec span-2"><span>Bucha:</span><strong title="${escapeCatalogoHtml(buchaDescricao)}">${escapeCatalogoHtml(buchaDescricao)}</strong></div>
                <div class="catalogo-card-spec"><span>SKU Tubo:</span><strong>${escapeCatalogoHtml(modelo.skuTinyTuboAl || '—')}</strong></div>
                <div class="catalogo-card-spec"><span>SKU Caixa:</span><strong>${escapeCatalogoHtml(modelo.skuCaixa || '—')}</strong></div>
              </div>
            </div>
            <div class="catalogo-card-footer">
              <button type="button" class="btn-secondary btn-sm" onclick="openFichaTecnica('${modelo.id}')">
                Ficha Técnica
              </button>
              <div class="catalogo-card-actions">
                <button type="button" class="btn-secondary catalogo-edit-btn" onclick="openEditModelo('${modelo.id}')" aria-label="Editar ${escapeCatalogoHtml(modelo.nome)}">
                  Editar
                </button>
                <button type="button" class="btn-secondary catalogo-delete-btn catalogo-card-delete-btn" onclick="deleteModelo('${modelo.id}')" aria-label="Excluir ${escapeCatalogoHtml(modelo.nome)}">
                  Excluir
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const tbody = $('modelos-grid');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">Nenhuma hélice encontrada.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((modelo) => {
    const cor = modelo.cor || '—';
    const buchaDescricao = modelo.modeloBucha || '—';
    const { brand, dim } = extractHeliceSpecs(modelo.nome);
    const dotClass = cor.toLocaleUpperCase('pt-BR').includes('PRETO') ? ' catalogo-color-dot--black' : '';
    return `<tr>
      <td class="catalogo-col-sku"><span class="catalogo-sku">${escapeCatalogoHtml(modelo.sku)}</span></td>
      <td>
        <span class="catalogo-mobile-sku">${escapeCatalogoHtml(modelo.sku)}</span>
        <div class="catalogo-name-row">
          <span class="catalogo-brand-badge brand-${brand.toLowerCase()}">${brand}</span>
          <strong class="catalogo-model-name">${escapeCatalogoHtml(modelo.nome)}</strong>
          ${dim ? `<span class="catalogo-dim-badge">${dim}</span>` : ''}
        </div>
        <div class="catalogo-mobile-details"><span><b>Bruto:</b> ${escapeCatalogoHtml(modelo.codigoBruto || '—')}</span><span><b>SKU tubo:</b> ${escapeCatalogoHtml(modelo.skuTinyTuboAl || '—')}</span><span><b>SKU bucha:</b> ${escapeCatalogoHtml(modelo.skuBucha || '—')}</span><span><b>Cor:</b> ${escapeCatalogoHtml(cor)}</span><span><b>SKU caixa:</b> ${escapeCatalogoHtml(modelo.skuCaixa || '—')}</span></div>
      </td>
      <td class="catalogo-col-bruto">${escapeCatalogoHtml(modelo.codigoBruto || '—')}</td>
      <td class="catalogo-col-tubo">${escapeCatalogoHtml(modelo.skuTinyTuboAl || '—')}</td>
      <td class="catalogo-bucha" title="${escapeCatalogoHtml(buchaDescricao)}">${escapeCatalogoHtml(buchaDescricao)}</td>
      <td class="catalogo-col-cor"><span class="catalogo-color"><i class="catalogo-color-dot${dotClass}"></i>${escapeCatalogoHtml(cor)}</span></td>
      <td class="catalogo-caixa catalogo-col-caixa">${escapeCatalogoHtml(modelo.skuCaixa || '—')}</td>
      <td class="catalogo-row-actions">
        <div class="catalogo-table-actions">
          <button class="btn-secondary catalogo-icon-action" onclick="openFichaTecnica('${modelo.id}')" title="Ver ficha técnica de ${escapeCatalogoHtml(modelo.nome)}" aria-label="Ver ficha técnica de ${escapeCatalogoHtml(modelo.nome)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          </button>
          <button class="btn-secondary catalogo-edit-btn" onclick="openEditModelo('${modelo.id}')" aria-label="Editar ${escapeCatalogoHtml(modelo.nome)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Editar
          </button>
          <button class="btn-secondary catalogo-icon-action catalogo-delete-btn" onclick="deleteModelo('${modelo.id}')" title="Excluir ${escapeCatalogoHtml(modelo.nome)}" aria-label="Excluir ${escapeCatalogoHtml(modelo.nome)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderModelos() {
  renderCatalogoModelos();
}

function populateModeloCoquilhasSelect() {
  const select = $('modelo-codigo-bruto');
  if (!select) return;
  const coquilhas = DB.getCoquilhasCatalog();
  const currentVal = select.value;
  const options = [...new Set(coquilhas.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  select.innerHTML = [
    '<option value="">— Selecione uma Coquilha —</option>',
    ...options.map(c => `<option value="${escapeCatalogoHtml(c)}">${escapeCatalogoHtml(c)}</option>`)
  ].join('');
  if (currentVal && options.includes(currentVal)) select.value = currentVal;
}

function openNovoModelo(prefilledCoquilha = '') {
  STATE.editingModeloId = null;
  $('modelo-edit-id').value = '';
  $('modal-modelo-title').textContent = 'Nova Hélice';
  populateModeloCoquilhasSelect();
  catalogoFillForm();
  if (prefilledCoquilha && $('modelo-codigo-bruto')) {
    $('modelo-codigo-bruto').value = prefilledCoquilha;
  }
  $('modal-modelo').classList.remove('hidden');
  $('modelo-nome').focus();
}
window.openNovoModelo = openNovoModelo;

function openEditModelo(id) {
  const modelo = DB.getModelos().find((item) => item.id === id);
  if (!modelo) return;
  STATE.editingModeloId = id;
  $('modelo-edit-id').value = id;
  $('modal-modelo-title').textContent = 'Editar Hélice';
  populateModeloCoquilhasSelect();
  catalogoFillForm(modelo);
  if (modelo.codigoBruto && $('modelo-codigo-bruto')) {
    $('modelo-codigo-bruto').value = modelo.codigoBruto;
  }
  $('modal-modelo').classList.remove('hidden');
  $('modelo-nome').focus();
}
window.openEditModelo = openEditModelo;

function deleteModelo(id) {
  const modelo = DB.getModelos().find((item) => item.id === id);
  if (!modelo) {
    showToast('Hélice não encontrada no catálogo.', 'error');
    return;
  }

  const hasProductionHistory = DB.getOps().some((op) => op.modelo === modelo.nome)
    || DB.getPecas().some((peca) => peca.modelo === modelo.nome);
  const historyNotice = hasProductionHistory
    ? '\n\nAs OPs e os lotes existentes serão preservados no histórico.'
    : '';
  if (!confirm(`Excluir a hélice "${modelo.nome}" (${modelo.sku})?\n\nEsta ação não pode ser desfeita.${historyNotice}`)) return;

  DB.deleteModelo(id);
  if (STATE.editingModeloId === id) closeModalModelo();
  renderModelos();
  populateModeloSelects();
  if (typeof renderCatalogoFundicao === 'function') renderCatalogoFundicao();
  if (STATE.currentPage === 'dashboard') renderDashboard();
  showToast('Hélice excluída do catálogo.', 'error');
}
window.deleteModelo = deleteModelo;

function closeModalModelo() { $('modal-modelo').classList.add('hidden'); }

function saveModelo() {
  const catalogData = catalogoReadForm();
  if (!catalogData.nome) { showToast('Informe a descrição da hélice.', 'error'); return; }
  if (!catalogData.sku) { showToast('Informe o SKU da hélice.', 'error'); return; }
  if (!catalogData.codigoBruto) { showToast('Selecione a coquilha / código bruto.', 'error'); return; }

  try {
    if (STATE.editingModeloId) {
      DB.updateModelo(STATE.editingModeloId, catalogData);
      showToast('Hélice atualizada com sucesso!');
    } else {
      DB.addModelo(catalogData);
      showToast('Hélice adicionada ao catálogo!');
    }
    if (typeof renderCatalogoFundicao === 'function') renderCatalogoFundicao();
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a hélice.', 'error');
    return;
  }

  closeModalModelo();
  renderModelos();
  populateModeloSelects();
  if (STATE.currentPage === 'dashboard') renderDashboard();
}

// ═══════════════════════════════════════════
// CATÁLOGO DE BUCHAS
// ═══════════════════════════════════════════
function setBuchasViewMode(mode) {
  STATE.buchasViewMode = mode;
  const tableView = $('buchas-table-view');
  const cardsView = $('buchas-cards-view');
  const btnTable = $('btn-buchas-view-table');
  const btnCards = $('btn-buchas-view-cards');

  if (mode === 'cards') {
    if (tableView) tableView.classList.add('hidden');
    if (cardsView) cardsView.classList.remove('hidden');
    if (btnTable) btnTable.classList.remove('active');
    if (btnCards) btnCards.classList.add('active');
  } else {
    if (tableView) tableView.classList.remove('hidden');
    if (cardsView) cardsView.classList.add('hidden');
    if (btnTable) btnTable.classList.add('active');
    if (btnCards) btnCards.classList.remove('active');
  }
}
window.setBuchasViewMode = setBuchasViewMode;

function renderBuchas() {
  const search = ($('bucha-search')?.value || '').toLowerCase().trim();
  const filterMotor = $('buchas-filter-motor')?.value || '';
  const allBuchas = DB.getBuchas();

  // Popula filtro de motores
  const motorSelect = $('buchas-filter-motor');
  if (motorSelect) {
    const selectedMotor = motorSelect.value;
    const motores = [...new Set(allBuchas.map(b => b.aplicacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    motorSelect.innerHTML = [
      '<option value="">Todos os motores</option>',
      ...motores.map(m => `<option value="${escapeCatalogoHtml(m)}">${escapeCatalogoHtml(m)}</option>`)
    ].join('');
    if (motores.includes(selectedMotor)) motorSelect.value = selectedMotor;
  }

  // Filtragem
  const list = allBuchas
    .filter(b => !search || [b.sku, b.descricao, b.dimensoes, b.aplicacao].some(f => String(f || '').toLowerCase().includes(search)))
    .filter(b => !filterMotor || b.aplicacao === filterMotor);

  // KPIs
  const totalBuchas = allBuchas.length;
  const totalMotores = new Set(allBuchas.map(b => b.aplicacao).filter(Boolean)).size;
  const compMedio = totalBuchas ? Math.round(allBuchas.reduce((s, b) => s + (Number(b.comprimento) || 0), 0) / totalBuchas * 10) / 10 : 0;
  const pesoMedio = totalBuchas ? Math.round(allBuchas.reduce((s, b) => s + (Number(b.peso) || 0), 0) / totalBuchas * 100) / 100 : 0;

  if ($('kpi-bucha-total')) $('kpi-bucha-total').textContent = String(totalBuchas);
  if ($('kpi-bucha-marcas')) $('kpi-bucha-marcas').textContent = String(totalMotores);
  if ($('kpi-bucha-comp-medio')) $('kpi-bucha-comp-medio').textContent = `${compMedio} mm`;
  if ($('kpi-bucha-peso-medio')) $('kpi-bucha-peso-medio').textContent = `${pesoMedio} kg`;
  if ($('buchas-count')) $('buchas-count').textContent = `${list.length} de ${totalBuchas} ${totalBuchas === 1 ? 'item' : 'itens'}`;

  // Tabela
  const tbody = $('buchas-grid');
  if (tbody) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhuma bucha encontrada.</td></tr>';
    } else {
      tbody.innerHTML = list.map(b => `
        <tr>
          <td><strong class="helice-op-number">${escapeCatalogoHtml(b.sku)}</strong></td>
          <td><strong>${escapeCatalogoHtml(b.descricao)}</strong></td>
          <td><span class="chip chip--blue">${escapeCatalogoHtml(b.dimensoes || '—')}</span></td>
          <td><strong>${Number(b.comprimento) ? `${b.comprimento} mm` : '—'}</strong></td>
          <td>${Number(b.peso) ? `${b.peso} kg` : '—'}</td>
          <td><span class="chip chip--teal">${escapeCatalogoHtml(b.aplicacao || 'Geral')}</span></td>
          <td class="catalogo-actions-col">
            <div class="catalogo-table-actions">
              <button class="btn-secondary catalogo-edit-btn" onclick="openEditBucha('${b.id}')" title="Editar ${escapeCatalogoHtml(b.sku)}">
                Editar
              </button>
              <button class="btn-secondary catalogo-icon-action catalogo-delete-btn" onclick="deleteBucha('${b.id}')" title="Excluir ${escapeCatalogoHtml(b.sku)}">
                Excluir
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  }

  // Cards
  const cardsGrid = $('buchas-cards-grid');
  if (cardsGrid) {
    if (!list.length) {
      cardsGrid.innerHTML = '<div class="empty-cell" style="grid-column:1/-1;padding:2rem;">Nenhuma bucha encontrada.</div>';
    } else {
      cardsGrid.innerHTML = list.map(b => `
        <div class="catalogo-card-item">
          <div class="catalogo-card-header">
            <span class="chip chip--teal">${escapeCatalogoHtml(b.aplicacao || 'Geral')}</span>
            <span class="catalogo-sku">${escapeCatalogoHtml(b.sku)}</span>
          </div>
          <div class="catalogo-card-body">
            <h3 class="catalogo-card-title" style="font-size:0.9rem;">${escapeCatalogoHtml(b.descricao)}</h3>
            <div class="catalogo-card-specs" style="margin-top:0.75rem;">
              <div class="catalogo-card-spec"><span>Dimensões:</span><strong>${escapeCatalogoHtml(b.dimensoes || '—')}</strong></div>
              <div class="catalogo-card-spec"><span>Comprimento:</span><strong>${Number(b.comprimento) ? `${b.comprimento} mm` : '—'}</strong></div>
              <div class="catalogo-card-spec span-2"><span>Peso Estimado:</span><strong>${Number(b.peso) ? `${b.peso} kg` : '—'}</strong></div>
            </div>
          </div>
          <div class="catalogo-card-footer">
            <button type="button" class="btn-secondary catalogo-edit-btn" onclick="openEditBucha('${b.id}')">
              Editar
            </button>
            <button type="button" class="btn-secondary catalogo-delete-btn catalogo-card-delete-btn" onclick="deleteBucha('${b.id}')">
              Excluir
            </button>
          </div>
        </div>
      `).join('');
    }
  }
}

function openNovaBucha() {
  STATE.editingBuchaId = null;
  $('modal-bucha-title').textContent = 'Nova Bucha';
  $('bucha-edit-id').value = '';
  $('bucha-descricao').value = '';
  $('bucha-sku').value = '';
  $('bucha-dimensoes').value = '';
  $('bucha-comprimento').value = '';
  $('bucha-peso').value = '';
  $('bucha-aplicacao').value = '';
  $('modal-bucha').classList.remove('hidden');
  $('bucha-descricao').focus();
}
window.openNovaBucha = openNovaBucha;

function openEditBucha(id) {
  const bucha = DB.getBuchas().find(b => b.id === id);
  if (!bucha) return;
  STATE.editingBuchaId = id;
  $('modal-bucha-title').textContent = 'Editar Bucha';
  $('bucha-edit-id').value = bucha.id;
  $('bucha-descricao').value = bucha.descricao || '';
  $('bucha-sku').value = bucha.sku || '';
  $('bucha-dimensoes').value = bucha.dimensoes || '';
  $('bucha-comprimento').value = bucha.comprimento || '';
  $('bucha-peso').value = bucha.peso || '';
  $('bucha-aplicacao').value = bucha.aplicacao || '';
  $('modal-bucha').classList.remove('hidden');
  $('bucha-descricao').focus();
}
window.openEditBucha = openEditBucha;

function closeModalBucha() {
  $('modal-bucha').classList.add('hidden');
  STATE.editingBuchaId = null;
}

function saveBucha() {
  const descricao = $('bucha-descricao').value.trim();
  const sku = $('bucha-sku').value.trim();
  if (!descricao) { showToast('Informe a descrição da bucha.', 'error'); return; }
  if (!sku) { showToast('Informe o SKU da bucha.', 'error'); return; }

  const data = {
    descricao,
    sku,
    dimensoes: $('bucha-dimensoes').value.trim(),
    comprimento: parseFloat($('bucha-comprimento').value) || 0,
    peso: parseFloat($('bucha-peso').value) || 0,
    aplicacao: $('bucha-aplicacao').value.trim() || 'Geral',
  };

  try {
    if (STATE.editingBuchaId) {
      DB.updateBucha(STATE.editingBuchaId, data);
      showToast('Bucha atualizada com sucesso!');
    } else {
      DB.addBucha(data);
      showToast('Bucha adicionada ao catálogo!');
    }
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a bucha.', 'error');
    return;
  }

  closeModalBucha();
  renderBuchas();
}

function deleteBucha(id) {
  const bucha = DB.getBuchas().find(b => b.id === id);
  if (!bucha) return;
  if (!confirm(`Excluir a bucha "${bucha.descricao}" (${bucha.sku})?\n\nEsta ação não pode ser desfeita.`)) return;

  DB.deleteBucha(id);
  if (STATE.editingBuchaId === id) closeModalBucha();
  renderBuchas();
  showToast('Bucha excluída do catálogo.', 'error');
}
window.deleteBucha = deleteBucha;

// ESTOQUE & MOVIMENTAÇÃO
// ═══════════════════════════════════════════
function renderEstoque() {
  const search = ($('estoque-search')?.value || '').toLowerCase();
  let list = DB.getMateriais();
  if (search) list = list.filter(m => m.nome.toLowerCase().includes(search) || m.categoria.toLowerCase().includes(search));

  const tbody = $('estoque-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhum item cadastrado no estoque.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(m => {
    const baixo = m.saldo <= m.minimo;
    const statusChip = baixo
      ? `<span class="chip chip--red">Saldo baixo (${m.saldo} ${m.unidade})</span>`
      : `<span class="chip chip--green">Normal (${m.saldo} ${m.unidade})</span>`;

    return `<tr>
      <td style="color:var(--text-primary);font-weight:600">${m.nome}</td>
      <td><span class="chip chip--blue">${m.categoria}</span></td>
      <td><strong>${m.saldo}</strong> ${m.unidade}</td>
      <td>${m.minimo} ${m.unidade}</td>
      <td>${statusChip}</td>
      <td>${formatDate(m.atualizadoEm)}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:center">
          <button class="btn-icon" onclick="openEditMaterial('${m.id}')" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" onclick="deleteMaterial('${m.id}')" title="Excluir">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openNovoMaterial() {
  STATE.editingMaterialId = null;
  $('modal-material-title').textContent = 'Novo Item no Estoque';
  $('material-edit-id').value = '';
  $('material-nome').value = '';
  $('material-minimo').value = 0;
  $('material-saldo-div').style.display = 'block';
  $('material-saldo').value = 0;
  $('material-categoria').value = 'MateriaPrima';
  $('material-unidade').value = 'un';
  $('modal-material').classList.remove('hidden');
}

function openEditMaterial(id) {
  const m = DB.getMateriais().find(x => x.id === id);
  if (!m) return;
  if (m.rawCode) {
    window.editRawStock?.(m.rawCode);
    return;
  }
  STATE.editingMaterialId = id;
  $('modal-material-title').textContent = 'Editar Item';
  $('material-edit-id').value = id;
  $('material-nome').value      = m.nome;
  $('material-categoria').value = m.categoria;
  $('material-unidade').value   = m.unidade;
  $('material-minimo').value    = m.minimo;
  $('material-saldo-div').style.display = 'none';
  $('modal-material').classList.remove('hidden');
}
window.openEditMaterial = openEditMaterial;

function closeModalMaterial() { $('modal-material').classList.add('hidden'); }

function saveMaterial() {
  const nome = $('material-nome').value.trim();
  if (!nome) { showToast('Informe o nome do material.', 'error'); return; }
  const data = {
    nome,
    categoria: $('material-categoria').value,
    unidade:   $('material-unidade').value,
    minimo:    parseFloat($('material-minimo').value) || 0,
  };
  if (STATE.editingMaterialId) {
    DB.updateMaterial(STATE.editingMaterialId, data);
    showToast('Material atualizado!');
  } else {
    data.saldo = parseFloat($('material-saldo').value) || 0;
    DB.addMaterial(data);
    showToast('Material cadastrado!');
  }
  closeModalMaterial();
  renderEstoque();
}

function deleteMaterial(id) {
  const material = DB.getMateriais().find(item => item.id === id);
  if (material?.rawCode) {
    showToast('Peças brutas são permanentes. Ajuste apenas o saldo físico.', 'warning');
    return;
  }
  if (!confirm('Excluir este item do estoque?')) return;
  DB.deleteMaterial(id);
  renderEstoque();
  showToast('Item excluído.', 'error');
}
window.deleteMaterial = deleteMaterial;

function openModalMov() {
  populateMaterialSelect();
  populateOpSelectMov();
  $('mov-material').value = '';
  $('mov-tipo').value     = 'Entrada';
  $('mov-qty').value      = 1;
  $('mov-op').value       = '';
  $('mov-obs').value      = '';
  $('modal-mov').classList.remove('hidden');
}

function closeModalMov() { $('modal-mov').classList.add('hidden'); }

function saveMov() {
  const matId = $('mov-material').value;
  const qty   = parseFloat($('mov-qty').value) || 0;
  if (!matId) { showToast('Selecione o material.', 'error'); return; }
  if (qty <= 0) { showToast('Informe uma quantidade válida.', 'error'); return; }

  const tipo = $('mov-tipo').value;
  const opId = $('mov-op').value;
  const obs  = $('mov-obs').value.trim();

  const mat = DB.getMateriais().find(x => x.id === matId);
  if (tipo === 'Saída' && mat && mat.saldo < qty) {
    if (!confirm(`Saldo insuficiente (${mat.saldo} ${mat.unidade}). Deseja continuar mesmo assim?`)) return;
  }

  DB.addMovimento({ materialId: matId, tipo, qty, opId, obs });
  closeModalMov();
  renderEstoque();
  showToast(`Movimentação de ${tipo.toLowerCase()} registrada!`);
}

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// PROGRAMAÇÃO & ORDENS DE FUNDIÇÃO
// ═══════════════════════════════════════════
function renderFundicao() {
  if (typeof window.renderProgramacaoFundicao === 'function') {
    window.renderProgramacaoFundicao();
  }
}

function renderRastreioFundicao() {
  if (typeof window.renderRastreioFundicao === 'function') {
    window.renderRastreioFundicao();
  }
}

function openNovaFundicao(prefilledCoquilha = '', suggestedQty = 50, pesoUnitario = 0) {
  STATE.editingFundicaoId = null;
  if ($('modal-fundicao-title')) $('modal-fundicao-title').textContent = 'Criar Ordem de Produção de Fundição';
  if ($('fundicao-edit-id')) $('fundicao-edit-id').value = '';
  
  if ($('fundicao-lote')) $('fundicao-lote').value = 'Será gerado ao salvar';
  if ($('fundicao-qty')) $('fundicao-qty').value = suggestedQty > 0 ? suggestedQty : 50;
  if ($('fundicao-liga')) $('fundicao-liga').value = 'Alumínio AlMg5';
  if ($('fundicao-data')) $('fundicao-data').value = new Date().toISOString().split('T')[0];
  if ($('fundicao-responsavel')) $('fundicao-responsavel').value = window.PCP_CURRENT_USER || '';
  if ($('fundicao-obs')) $('fundicao-obs').value = pesoUnitario > 0 ? `Peso unitário estimado: ${pesoUnitario.toFixed(3)} kg` : '';

  // A OP só pode ser aberta para um bruto cadastrado no catálogo. Assim as três
  // telas usam exatamente o mesmo código de coquilha.
  const select = $('fundicao-modelo');
  if (select) {
    const catalog = typeof window.getCombinedCatalog === 'function'
      ? window.getCombinedCatalog().filter(item => item.ativo !== false)
      : (typeof DB.getFundicaoCatalog === 'function' ? DB.getFundicaoCatalog().filter(item => item.ativo !== false) : []);
    const productsByCode = new Map();
    catalog.forEach(item => {
      const code = String(item.coquilha || item.codigo || '').trim();
      if (code && !productsByCode.has(code.toLocaleUpperCase('pt-BR'))) {
        productsByCode.set(code.toLocaleUpperCase('pt-BR'), { ...item, coquilha: code });
      }
    });
    const allProducts = [...productsByCode.values()]
      .sort((a, b) => a.coquilha.localeCompare(b.coquilha, 'pt-BR', { numeric: true }));

    const opts = [
      '<option value="">— Selecione o produto / coquilha —</option>',
      ...allProducts.map(item => {
        const desc = item.descricao ? ` — ${item.descricao}` : '';
        return `<option value="${item.coquilha}">${item.coquilha}${desc}</option>`;
      })
    ];
    select.innerHTML = opts.join('');
    if (prefilledCoquilha) select.value = prefilledCoquilha;
  }

  $('modal-fundicao')?.classList.remove('hidden');
}
window.openNovaFundicao = openNovaFundicao;

function openEditFundicao(id) {
  const f = DB.getFundicoes().find(x => x.id === id);
  if (!f) return;
  if (f.status === 'Fundido') {
    showToast('Uma OP fundida faz parte do histórico e não pode ser alterada.', 'error');
    return;
  }
  // openNovaFundicao limpa o estado de edição, então o id é restaurado depois.
  openNovaFundicao(f.coquilha || f.modelo, f.qtyPlanejada || f.qty, f.pesoUnitario || f.peso);
  STATE.editingFundicaoId = id;
  if ($('modal-fundicao-title')) $('modal-fundicao-title').textContent = `Editar OP: ${f.numero}`;
  if ($('fundicao-edit-id')) $('fundicao-edit-id').value = id;
  if ($('fundicao-lote')) $('fundicao-lote').value = f.numero || f.lote;
  if ($('fundicao-qty')) $('fundicao-qty').value = f.qtyPlanejada || f.qty;
  if ($('fundicao-liga')) $('fundicao-liga').value = f.liga || 'Alumínio AlMg5';
  if ($('fundicao-data')) $('fundicao-data').value = f.dataPrevista || '';
  if ($('fundicao-responsavel')) $('fundicao-responsavel').value = f.responsavel || '';
  if ($('fundicao-obs')) $('fundicao-obs').value = f.obs || '';
}
window.openEditFundicao = openEditFundicao;

function closeModalFundicao() { $('modal-fundicao')?.classList.add('hidden'); }
window.closeModalFundicao = closeModalFundicao;

function applyFundicaoServerState(result) {
  if (!Array.isArray(result?.orders)) return;
  if (typeof RemoteStorage !== 'undefined' && typeof RemoteStorage.applyServerState === 'function') {
    RemoteStorage.applyServerState(DB.KEYS.fundicoes, result.orders, result.version, result.revision);
    return;
  }
  DB.saveFundicoes(result.orders);
}
window.applyFundicaoServerState = applyFundicaoServerState;

async function readFundicaoApiResult(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Não foi possível gravar a OP (HTTP ${response.status}).`);
  }
  return result;
}

async function saveFundicao() {
  const coquilha = $('fundicao-modelo')?.value || '';
  if (!coquilha) { showToast('Selecione o produto / coquilha.', 'error'); return; }
  const qty = parseInt($('fundicao-qty')?.value) || 1;
  const lote = STATE.editingFundicaoId ? ($('fundicao-lote')?.value.trim() || 'OP') : 'nova OP';

  const data = {
    produto: coquilha,
    coquilha: coquilha,
    modelo: coquilha,
    codigo: coquilha,
    numero: lote,
    lote: lote,
    qtyPlanejada: qty,
    qty: qty,
    liga: $('fundicao-liga')?.value || 'Alumínio AlMg5',
    dataPrevista: $('fundicao-data')?.value || '',
    responsavel: $('fundicao-responsavel')?.value.trim() || window.PCP_CURRENT_USER || '',
    obs: $('fundicao-obs')?.value.trim() || '',
    status: 'Em aberto'
  };

  try {
    if (STATE.editingFundicaoId) {
      const response = await fetch(`/api/fundicao-ops/${encodeURIComponent(STATE.editingFundicaoId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-PCP-User': window.PCP_CURRENT_USER || '' },
        body: JSON.stringify(data)
      });
      const result = await readFundicaoApiResult(response);
      applyFundicaoServerState(result);
      showToast(`OP ${result.op?.numero || lote} atualizada.`, 'success');
    } else {
      const response = await fetch('/api/fundicao-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PCP-User': window.PCP_CURRENT_USER || '' },
        body: JSON.stringify(data)
      });
      const result = await readFundicaoApiResult(response);
      applyFundicaoServerState(result);
      showToast(`OP ${result.op?.numero || lote} criada e enviada ao Rastreio de OPs.`, 'success');
    }
  } catch (error) {
    showToast(error.message || 'Erro ao salvar OP de fundição.', 'error');
    return;
  }

  closeModalFundicao();
  renderFundicao();
  navigate('rastreio-fundicao');
}
window.saveFundicao = saveFundicao;

async function deleteFundicao(id) {
  const f = DB.getFundicoes().find(x => x.id === id);
  if (!f) return;
  if (f.status === 'Fundido') {
    showToast('Não é possível excluir uma OP já fundida com entrada em estoque.', 'error');
    return;
  }
  if (!confirm(`Excluir a ordem de produção ${f.numero || f.lote}?`)) return;

  try {
    const response = await fetch(`/api/fundicao-ops/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-PCP-User': window.PCP_CURRENT_USER || '' }
    });
    applyFundicaoServerState(await readFundicaoApiResult(response));
  } catch (error) {
    showToast(error.message || 'Não foi possível cancelar a OP de fundição.', 'error');
    return;
  }

  renderFundicao();
  if (typeof window.renderRastreioFundicao === 'function') {
    window.renderRastreioFundicao();
  }
  showToast('Ordem de fundição cancelada.', 'info');
}
window.deleteFundicao = deleteFundicao;

// ═══════════════════════════════════════════
// RASTREIO DE OPERAÇÕES & PEÇAS
// ═══════════════════════════════════════════
const OPERACOES = [
  { code: '01', name: 'Injeção / Coquilha',     chip: 'chip--orange' },
  { code: '02', name: 'Esmerilhamento',         chip: 'chip--gray'   },
  { code: '03', name: 'Polimento',              chip: 'chip--purple' },
  { code: '04', name: 'Usinagem de Precisão',  chip: 'chip--blue'   },
  { code: '05', name: 'Pintura Epóxi',          chip: 'chip--purple' },
  { code: '06', name: 'Embuchamento / Balance', chip: 'chip--teal'   },
  { code: '07', name: 'Gravação & Embalagem',   chip: 'chip--green'  },
];

function renderFluxo() {
  if (window.RastreioHelices) {
    window.RastreioHelices.render();
    return;
  }
  const search  = ($('fluxo-search')?.code || $('fluxo-search')?.value || '').toLowerCase();
  const opFilt  = $('fluxo-filter-op')?.value || '';

  let list = DB.getPecas();

  if (search) {
    list = list.filter(p =>
      p.numero.toLowerCase().includes(search) ||
      p.modelo.toLowerCase().includes(search) ||
      (p.opNumero && p.opNumero.toLowerCase().includes(search))
    );
  }
  if (opFilt) {
    list = list.filter(p => p.operacaoAtual === opFilt);
  }

  // Render por operações (colunas)
  OPERACOES.forEach(op => {
    const colEl = $(`col-op-${op.code}`);
    if (!colEl) return;
    const pecasOp = list.filter(p => p.operacaoAtual === op.code);

    // badge count
    const badge = $(`count-op-${op.code}`);
    if (badge) badge.textContent = pecasOp.length;

    if (!pecasOp.length) {
      colEl.innerHTML = `<div class="kanban-empty">Nenhuma peça nesta etapa</div>`;
      return;
    }

    colEl.innerHTML = pecasOp.map(p => {
      const idxAtual = OPERACOES.findIndex(o => o.code === p.operacaoAtual);
      const prevOp = idxAtual > 0 ? OPERACOES[idxAtual - 1].code : null;
      const nextOp = idxAtual < OPERACOES.length - 1 ? OPERACOES[idxAtual + 1].code : null;

      return `
        <div class="peca-card">
          <div class="peca-card-header">
            <span class="peca-num">${p.numero}</span>
            <span class="chip ${op.chip}">${op.name.split(' ')[0]}</span>
          </div>
          <div class="peca-model">${p.modelo}</div>
          <div class="peca-meta">
            ${p.opNumero ? `<span>OP: <strong>${p.opNumero}</strong></span>` : ''}
            <span>Qtd: <strong>${p.qty}</strong></span>
            <span>Tipo: ${p.tipoFundicao || 'Alumínio'}</span>
          </div>
          <div class="peca-actions">
            ${prevOp ? `<button class="btn-icon" onclick="avancarOpPeca('${p.id}', '${prevOp}')" title="Voltar para Op. ${prevOp}">←</button>` : '<span></span>'}
            <button class="btn-icon" onclick="verHistoricoPeca('${p.id}')" title="Ver histórico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v5h5"/><path d="M3.05 13a9 9 0 1 0 2.13-6.36L3 8"/><path d="M12 7v5l3 2"/></svg></button>
            <button class="btn-icon danger" onclick="deletePeca('${p.id}')" title="Excluir peça"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m3 0V4h8v2"/></svg></button>
            ${nextOp ? `<button class="btn-icon" onclick="avancarOpPeca('${p.id}', '${nextOp}')" title="Avançar para Op. ${nextOp}">→</button>` : '<span></span>'}
          </div>
        </div>
      `;
    }).join('');
  });
}

function openNovaPeca() {
  STATE.editingPecaId = null;
  $('modal-peca-title').textContent = 'Cadastrar Peça / Lote de Produção';
  $('peca-edit-id').value = '';
  $('peca-numero').value = '';
  $('peca-qty').value    = 1;
  $('peca-op').value     = '01';
  $('peca-fundicao').value = 'Alumínio AlMg5';
  $('peca-obs').value    = '';

  populateModeloSelects();
  populateOpSelectPeca();
  $('modal-peca').classList.remove('hidden');
}

function populateOpSelectPeca() {
  const ops = DB.getOps();
  const opts = ['<option value="">— Nenhuma (Sem OP vinculada) —</option>',
    ...ops.map(o => `<option value="${o.id}">${o.numero} – ${o.modelo}</option>`)
  ].join('');
  const el = $('peca-op-vinculo');
  if (el) el.innerHTML = opts;
}

function closeModalPeca() { $('modal-peca').classList.add('hidden'); }

function savePeca() {
  const modelo = $('peca-modelo').value;
  if (!modelo) { showToast('Selecione o modelo da hélice.', 'error'); return; }

  const opId = $('peca-op-vinculo').value;
  const op   = DB.getOps().find(o => o.id === opId);

  const data = {
    modelo,
    qty:           parseInt($('peca-qty').value) || 1,
    operacaoAtual: $('peca-op').value,
    opId:          opId || null,
    opNumero:      op ? op.numero : null,
    tipoFundicao:  $('peca-fundicao').value,
    obs:           $('peca-obs').value.trim(),
  };

  const num = $('peca-numero').value.trim();
  if (num) data.numero = num;

  if (STATE.editingPecaId) {
    DB.updatePeca(STATE.editingPecaId, data);
    showToast('Peça atualizada!');
  } else {
    DB.addPeca(data);
    showToast('Peça cadastrada no rastreio!');
  }

  closeModalPeca();
  renderFluxo();
}

function avancarOpPeca(id, novaOpCode) {
  const opObj = OPERACOES.find(o => o.code === novaOpCode);
  const nomeOp = opObj ? opObj.name : novaOpCode;
  DB.avancarPecaOp(id, novaOpCode, `Avançado manualmente para ${nomeOp}`);
  renderFluxo();
  showToast(`Peça movida para Op. ${novaOpCode} (${nomeOp})`);
}
window.avancarOpPeca = avancarOpPeca;

function deletePeca(id) {
  if (!confirm('Excluir esta peça do rastreio?')) return;
  DB.deletePeca(id);
  renderFluxo();
  showToast('Peça removida.', 'error');
}
window.deletePeca = deletePeca;

function verHistoricoPeca(id) {
  const peca = DB.getPecas().find(p => p.id === id);
  if (!peca) return;

  $('hist-peca-num').textContent    = peca.numero;
  $('hist-peca-modelo').textContent = peca.modelo;
  $('hist-peca-op').textContent     = peca.opNumero || 'Sem OP';

  const container = $('hist-timeline');
  const hist = peca.historico || [];

  if (!hist.length) {
    container.innerHTML = '<p class="empty-cell">Nenhum histórico registrado.</p>';
  } else {
    container.innerHTML = hist.slice().reverse().map(h => {
      const opInfo = OPERACOES.find(o => o.code === h.op);
      const nomeOp = opInfo ? `${h.op} – ${opInfo.name}` : `Operação ${h.op}`;
      return `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-title">${nomeOp}</div>
            <div class="timeline-time">${formatDateTime(h.data)}</div>
            ${h.obs ? `<div class="timeline-obs">${h.obs}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  $('modal-historico').classList.remove('hidden');
}
window.verHistoricoPeca = verHistoricoPeca;

function closeModalHistorico() { $('modal-historico').classList.add('hidden'); }

// ═══════════════════════════════════════════
// MANUTENÇÃO DE MAQUINÁRIO
// ═══════════════════════════════════════════
function renderManutencao() {
  const search = ($('mnt-search')?.value || '').toLowerCase();
  const statusFilter = $('mnt-filter-status')?.value || '';
  const tipoFilter   = $('mnt-filter-tipo')?.value || '';

  let list = DB.getManutencoes();
  if (search) list = list.filter(m => m.maquina.toLowerCase().includes(search) || m.descricao.toLowerCase().includes(search));
  if (statusFilter) list = list.filter(m => m.status === statusFilter);
  if (tipoFilter)   list = list.filter(m => m.tipo === tipoFilter);

  const tbody = $('manutencao-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhuma manutenção registrada.</td></tr>';
    return;
  }

  const statusChips = {
    'Pendente':    '<span class="chip chip--orange">Pendente</span>',
    'Em Andamento':'<span class="chip chip--blue">Em Andamento</span>',
    'Concluído':   '<span class="chip chip--green">Concluído</span>',
    'Cancelado':   '<span class="chip chip--gray">Cancelado</span>',
  };

  const tipoChips = {
    'Preventiva':  '<span class="chip chip--teal">Preventiva</span>',
    'Corretiva':   '<span class="chip chip--red">Corretiva</span>',
    'Preditiva':   '<span class="chip chip--purple">Preditiva</span>',
  };

  tbody.innerHTML = list.map(m => `<tr>
    <td style="color:var(--text-primary);font-weight:600">${m.maquina}</td>
    <td>${tipoChips[m.tipo] || m.tipo}</td>
    <td style="text-align:left">${m.descricao}</td>
    <td>${formatDate(m.dataPrevista)}</td>
    <td>${m.tecnico || '—'}</td>
    <td>${statusChips[m.status] || m.status}</td>
    <td>
      <div style="display:flex;gap:4px;justify-content:center">
        <button class="btn-icon" onclick="openEditManutencao('${m.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deleteManutencao('${m.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </td>
  </tr>`).join('');
}

function openNovaManutencao() {
  STATE.editingManutencaoId = null;
  $('modal-mnt-title').textContent = 'Nova Ordem de Manutenção';
  $('mnt-edit-id').value = '';
  $('mnt-maquina').value = '';
  $('mnt-tipo').value    = 'Preventiva';
  $('mnt-desc').value    = '';
  $('mnt-data').value    = new Date().toISOString().split('T')[0];
  $('mnt-tecnico').value = '';
  $('mnt-status').value  = 'Pendente';
  $('modal-mnt').classList.remove('hidden');
}

function openEditManutencao(id) {
  const m = DB.getManutencoes().find(x => x.id === id);
  if (!m) return;
  STATE.editingManutencaoId = id;
  $('modal-mnt-title').textContent = 'Editar Manutenção';
  $('mnt-edit-id').value  = id;
  $('mnt-maquina').value  = m.maquina;
  $('mnt-tipo').value     = m.tipo;
  $('mnt-desc').value     = m.descricao;
  $('mnt-data').value     = m.dataPrevista;
  $('mnt-tecnico').value  = m.tecnico;
  $('mnt-status').value   = m.status;
  $('modal-mnt').classList.remove('hidden');
}
window.openEditManutencao = openEditManutencao;

function closeModalManutencao() { $('modal-mnt').classList.add('hidden'); }

function saveManutencao() {
  const maquina   = $('mnt-maquina').value.trim();
  const descricao = $('mnt-desc').value.trim();
  if (!maquina)   { showToast('Informe a máquina/equipamento.', 'error'); return; }
  if (!descricao) { showToast('Informe a descrição do serviço.', 'error'); return; }

  const data = {
    maquina,
    tipo:         $('mnt-tipo').value,
    descricao,
    dataPrevista: $('mnt-data').value,
    tecnico:      $('mnt-tecnico').value.trim(),
    status:       $('mnt-status').value,
  };

  if (STATE.editingManutencaoId) {
    DB.updateManutencao(STATE.editingManutencaoId, data);
    showToast('Manutenção atualizada!');
  } else {
    DB.addManutencao(data);
    showToast('Manutenção agendada!');
  }

  closeModalManutencao();
  renderManutencao();
}

function deleteManutencao(id) {
  if (!confirm('Excluir este registro de manutenção?')) return;
  DB.deleteManutencao(id);
  renderManutencao();
  showToast('Registro excluído.', 'error');
}
window.deleteManutencao = deleteManutencao;

// ═══════════════════════════════════════════
// EXPEDIÇÃO & VENDAS
// ═══════════════════════════════════════════
function renderExpedicao() {
  const search = ($('expedicao-search')?.value || '').toLowerCase();
  let list = DB.getPedidos();

  if (search) {
    list = list.filter(v =>
      v.cliente.toLowerCase().includes(search) ||
      v.modelo.toLowerCase().includes(search) ||
      (v.numeroNota && v.numeroNota.toLowerCase().includes(search))
    );
  }

  const tbody = $('expedicao-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Nenhuma venda registrada na expedição.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(v => `<tr>
    <td style="color:var(--text-primary);font-weight:600">${v.cliente}</td>
    <td>${v.modelo}</td>
    <td><strong>${v.qty}</strong> un</td>
    <td>${v.numeroNota ? `<span class="chip chip--blue">${v.numeroNota}</span>` : '—'}</td>
    <td>${statusPedidoChip(v.status)}</td>
    <td>${formatDate(v.dataEnvio)}</td>
    <td>
      <div style="display:flex;gap:4px;justify-content:center">
        <button class="btn-icon" onclick="openEditVenda('${v.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deleteVenda('${v.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </td>
  </tr>`).join('');
}

function openNovaVenda() {
  STATE.editingVendaId = null;
  $('modal-venda-title').textContent = 'Nova Venda / Expedição';
  $('venda-edit-id').value = '';
  $('venda-cliente').value = '';
  $('venda-qty').value     = 1;
  $('venda-nota').value    = '';
  $('venda-status').value  = 'Aguardando';
  $('venda-data').value    = new Date().toISOString().split('T')[0];

  populateModeloSelects();
  $('modal-venda').classList.remove('hidden');
}

function openEditVenda(id) {
  const v = DB.getPedidos().find(x => x.id === id);
  if (!v) return;
  STATE.editingVendaId = id;
  $('modal-venda-title').textContent = 'Editar Registro de Expedição';
  $('venda-edit-id').value = id;

  populateModeloSelects();
  $('venda-cliente').value = v.cliente;
  $('venda-modelo').value  = v.modelo;
  $('venda-qty').value     = v.qty;
  $('venda-nota').value    = v.numeroNota || '';
  $('venda-status').value  = v.status;
  $('venda-data').value    = v.dataEnvio;
  $('modal-venda').classList.remove('hidden');
}
window.openEditVenda = openEditVenda;

function closeModalVenda() { $('modal-venda').classList.add('hidden'); }

function saveVenda() {
  const cliente = $('venda-cliente').value.trim();
  const modelo  = $('venda-modelo').value;
  if (!cliente) { showToast('Informe o cliente.', 'error'); return; }
  if (!modelo)  { showToast('Selecione o modelo.', 'error'); return; }

  const data = {
    cliente,
    modelo,
    qty:        parseInt($('venda-qty').value) || 1,
    numeroNota: $('venda-nota').value.trim(),
    status:     $('venda-status').value,
    dataEnvio:  $('venda-data').value,
  };

  if (STATE.editingVendaId) {
    DB.updatePedido(STATE.editingVendaId, data);
    showToast('Registro de expedição atualizado!');
  } else {
    DB.addPedido(data);
    showToast('Venda registrada na expedição!');
  }

  closeModalVenda();
  renderExpedicao();
}

function deleteVenda(id) {
  if (!confirm('Excluir este registro de expedição?')) return;
  DB.deletePedido(id);
  renderExpedicao();
  showToast('Registro excluído.', 'error');
}
window.deleteVenda = deleteVenda;

// ═══════════════════════════════════════════
// RELATÓRIOS
// ═══════════════════════════════════════════
function renderRelatorios() {
  const ops     = DB.getOps();
  const pecas   = DB.getPecas();
  const fund    = DB.getFundicoes();
  const pedidos = DB.getPedidos();

  // Média de produção
  const prontas = ops.filter(o => o.etapa === 'Pronto/Entregue');
  $('rel-total-prontas').textContent = prontas.length;

  // Peças ativas em produção
  $('rel-pecas-ativas').textContent = pecas.length;

  // Lotes de fundição
  $('rel-lotes-fundicao').textContent = fund.length;

  // Pedidos concluídos
  $('rel-pedidos-concl').textContent = pedidos.filter(p => p.status === 'Concluído' || p.status === 'Entregue').length;
}

// ═══════════════════════════════════════════
// EXPORTAR CSV GERAL
// ═══════════════════════════════════════════
function exportCSV() {
  const ops = DB.getOps();
  if (!ops.length) { showToast('Nenhuma OP cadastrada para exportar.', 'error'); return; }

  const headers = ['Número', 'Modelo', 'Quantidade', 'Cliente', 'Prazo', 'Etapa', 'Prioridade', 'Observações'];
  const rows = ops.map(o => [
    o.numero,
    `"${o.modelo.replace(/"/g, '""')}"`,
    o.qty,
    `"${(o.cliente||'').replace(/"/g, '""')}"`,
    o.prazo,
    o.etapa,
    o.prioridade,
    `"${(o.obs||'').replace(/"/g, '""')}"`
  ]);

  const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `HR_Nautica_OPs_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado com sucesso!');
}

// ═══════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── Controle de Acesso e Sidebar por Perfil ──
  const isOperator = window.PCP_USER_ROLE !== 'admin';
  const RESTRICTED_PAGES = ['ordens', 'modelos', 'manutencao', 'relatorios', 'estoque', 'vini', 'usuarios'];
  
  if (isOperator) {
    RESTRICTED_PAGES.forEach(page => {
      const el = $(`nav-${page}`);
      if (el) el.style.display = 'none';
    });
  }

  // ── Botão Logout ──
  const btnLogout = $('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      window.sessionStorage.removeItem('hrn_login_usuario');
      window.sessionStorage.removeItem('hrn_usuario_role');
      window.localStorage.removeItem('hrn_login_usuario');
      window.localStorage.removeItem('hrn_usuario_role');
      window.location.reload();
    });
  }

  // ── Navegação ──
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(item.dataset.page);
    });
  });

  // "Ver todas" links no dashboard
  document.querySelectorAll('.link-ver-todas').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.page);
    });
  });

  // ── Botões Nova OP ──
  $('btn-nova-op-dashboard').addEventListener('click', () => { populateModeloSelects(); openNovaOp(); });
  const btnNovaOp = $('btn-nova-op');
  if (btnNovaOp) {
    btnNovaOp.addEventListener('click', () => { populateModeloSelects(); openNovaOp(); });
  }

  // ── Modal OP ──
  $('modal-op-close').addEventListener('click', closeModalOp);
  $('btn-cancel-op').addEventListener('click', closeModalOp);
  $('btn-save-op').addEventListener('click', saveOp);
  $('op-modelo').addEventListener('change', updateOpInsumosPreview);
  $('op-qty').addEventListener('input', updateOpInsumosPreview);

  // ── Modal Modelo & Ficha Técnica ──
  $('btn-novo-modelo').addEventListener('click', openNovoModelo);
  $('modal-modelo-close').addEventListener('click', closeModalModelo);
  $('btn-cancel-modelo').addEventListener('click', closeModalModelo);
  $('btn-save-modelo').addEventListener('click', saveModelo);

  const btnViewTable = $('btn-catalogo-view-table');
  const btnViewCards = $('btn-catalogo-view-cards');
  if (btnViewTable) btnViewTable.addEventListener('click', () => setCatalogoViewMode('table'));
  if (btnViewCards) btnViewCards.addEventListener('click', () => setCatalogoViewMode('cards'));

  const modalFichaClose = $('modal-ficha-close');
  const btnFichaFechar = $('btn-ficha-fechar');
  if (modalFichaClose) modalFichaClose.addEventListener('click', closeModalFichaTecnica);
  if (btnFichaFechar) btnFichaFechar.addEventListener('click', closeModalFichaTecnica);

  // ── Modal & Filtros de Buchas ──
  const btnNovaBucha = $('btn-nova-bucha');
  if (btnNovaBucha) btnNovaBucha.addEventListener('click', openNovaBucha);
  const modalBuchaClose = $('modal-bucha-close');
  if (modalBuchaClose) modalBuchaClose.addEventListener('click', closeModalBucha);
  const btnCancelBucha = $('btn-cancel-bucha');
  if (btnCancelBucha) btnCancelBucha.addEventListener('click', closeModalBucha);
  const btnSaveBucha = $('btn-save-bucha');
  if (btnSaveBucha) btnSaveBucha.addEventListener('click', saveBucha);

  const inputBuchaSearch = $('bucha-search');
  if (inputBuchaSearch) inputBuchaSearch.addEventListener('input', renderBuchas);
  const selectBuchaFilter = $('buchas-filter-motor');
  if (selectBuchaFilter) selectBuchaFilter.addEventListener('change', renderBuchas);
  const btnBuchasLimparFiltros = $('buchas-limpar-filtros');
  if (btnBuchasLimparFiltros) {
    btnBuchasLimparFiltros.addEventListener('click', () => {
      if (inputBuchaSearch) inputBuchaSearch.value = '';
      if (selectBuchaFilter) selectBuchaFilter.value = '';
      renderBuchas();
    });
  }

  // ── Modal Material ──
  $('btn-novo-material').addEventListener('click', openNovoMaterial);
  $('modal-material-close').addEventListener('click', closeModalMaterial);
  $('btn-cancel-material').addEventListener('click', closeModalMaterial);
  $('btn-save-material').addEventListener('click', saveMaterial);

  // ── Modal Movimentação ──
  $('btn-mov-estoque').addEventListener('click', openModalMov);
  $('modal-mov-close').addEventListener('click', closeModalMov);
  $('btn-cancel-mov').addEventListener('click', closeModalMov);
  $('btn-save-mov').addEventListener('click', saveMov);

  // ── Modal Peça (Rastreio) ──
  const btnNovaPeca = $('btn-nova-peca');
  if (btnNovaPeca) btnNovaPeca.addEventListener('click', openNovaPeca);
  $('modal-peca-close').addEventListener('click', closeModalPeca);
  $('btn-cancel-peca').addEventListener('click', closeModalPeca);
  $('btn-save-peca').addEventListener('click', savePeca);

  // ── Modal Histórico ──
  $('modal-historico-close').addEventListener('click', closeModalHistorico);
  $('btn-close-historico').addEventListener('click', closeModalHistorico);

  // ── Modal Fundição ──
  $('btn-nova-fundicao').addEventListener('click', openNovaFundicao);
  $('modal-fundicao-close').addEventListener('click', closeModalFundicao);
  $('btn-cancel-fundicao').addEventListener('click', closeModalFundicao);
  $('btn-save-fundicao').addEventListener('click', saveFundicao);

  // ── Modal Manutenção ──
  $('btn-nova-manutencao').addEventListener('click', openNovaManutencao);
  $('modal-mnt-close').addEventListener('click', closeModalManutencao);
  $('btn-cancel-mnt').addEventListener('click', closeModalManutencao);
  $('btn-save-mnt').addEventListener('click', saveManutencao);

  // ── Modal Venda (Expedição) ──
  $('btn-nova-venda').addEventListener('click', openNovaVenda);
  $('modal-venda-close').addEventListener('click', closeModalVenda);
  $('btn-cancel-venda').addEventListener('click', closeModalVenda);
  $('btn-save-venda').addEventListener('click', saveVenda);

  // ── Buscas ──
  const opSearch = $('op-search');
  if (opSearch) opSearch.addEventListener('input', renderOrdens);
  const opFilterStatus = $('op-filter-status');
  if (opFilterStatus) opFilterStatus.addEventListener('change', renderOrdens);
  $('modelo-search').addEventListener('input', renderModelos);
  ['catalogo-filter-marca', 'catalogo-filter-bruto', 'catalogo-filter-bucha', 'catalogo-filter-cor'].forEach((id) => {
    $(id).addEventListener('change', renderModelos);
  });
  document.querySelectorAll('.catalogo-sort-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.catalogoSort;
      STATE.catalogoSort = STATE.catalogoSort.field === field
        ? { field, direction: STATE.catalogoSort.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'asc' };
      renderModelos();
    });
  });
  $('catalogo-limpar-filtros').addEventListener('click', () => {
    $('modelo-search').value = '';
    ['catalogo-filter-marca', 'catalogo-filter-bruto', 'catalogo-filter-bucha', 'catalogo-filter-cor'].forEach((id) => { $(id).value = ''; });
    renderModelos();
  });
  $('estoque-search').addEventListener('input', renderEstoque);
  $('fundicao-search').addEventListener('input', renderFundicao);
  $('fundicao-filter-status').addEventListener('change', renderFundicao);
  $('mnt-search').addEventListener('input', renderManutencao);
  $('mnt-filter-status').addEventListener('change', renderManutencao);
  $('mnt-filter-tipo').addEventListener('change', renderManutencao);
  $('fluxo-search').addEventListener('input', renderFluxo);
  $('fluxo-filter-op').addEventListener('change', renderFluxo);
  $('fluxo-filter-status').addEventListener('change', renderFluxo);
  $('expedicao-search').addEventListener('input', renderExpedicao);

  // ── Exportar CSV ──
  $('btn-export-csv').addEventListener('click', exportCSV);

  // ── Fechar modais ao clicar fora ──
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // ── Tecla ESC para fechar modais ──
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    }
  });

  // ── Inicialização do Módulo de Análise de Produção ──
  if (typeof initAnaliseListeners === 'function') {
    initAnaliseListeners();
  }
  if (typeof loadAnaliseExcelData === 'function') {
    loadAnaliseExcelData();
  }

  // ── Inicialização do SyncManager (Sincronização em Rede) ──
  if (typeof SyncManager !== 'undefined') {
    SyncManager.init(() => {
      // Callback executado quando o polling encontra dados novos no servidor
      // Verifica se há algum modal aberto. Se houver, adia a re-renderização da tela para não atrapalhar
      const algumModalAberto = !!document.querySelector('.modal-overlay:not(.hidden)');
      
      if (algumModalAberto) {
        console.log('[SYNC] Dados novos no servidor detectados, mas render adiado (modal aberto).');
        return;
      }
      
      showToast('Dados sincronizados com a rede!', 'success');
      navigate(STATE.currentPage);
    });
  }

  // ── Render inicial ──
  navigate('dashboard');
});

// ═══════════════════════════════════════════
// CONTROLE DE ACESSO (USUÁRIOS)
// ═══════════════════════════════════════════
function renderUsuarios() {
  const tbody = $('usuarios-solicitacoes-body');
  if (!tbody) return;

  const dataRaw = RemoteStorage.getItem('hrn_solicitacoes_acesso');
  let requests = [];
  try {
    requests = dataRaw ? JSON.parse(dataRaw) : [];
  } catch (e) {
    console.error("Erro ao ler solicitacoes", e);
  }

  if (!requests.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Nenhuma solicitação de acesso registrada.</td></tr>';
    return;
  }

  // Ordena por data (mais recente primeiro)
  requests.sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));

  tbody.innerHTML = requests.map((req) => {
    let statusStyle = '';
    let statusLabel = req.status.toUpperCase();
    
    if (req.status === 'aprovado') {
      statusStyle = 'background-color: var(--accent-green-bg); color: var(--accent-green);';
    } else if (req.status === 'pendente') {
      statusStyle = 'background-color: var(--accent-orange-bg); color: var(--accent-orange);';
    } else if (req.status === 'rejeitado') {
      statusStyle = 'background-color: var(--accent-red-bg); color: var(--accent-red);';
    }

    const dateStr = req.requestedAt ? new Date(req.requestedAt).toLocaleString('pt-BR') : '—';
    
    let actionsHtml = '';
    if (req.status === 'pendente') {
      actionsHtml = `
        <button class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem; background-color: var(--accent-green); border-color: var(--accent-green); cursor: pointer;" onclick="decidirAcesso('${req.username}', 'aprovado')">Aprovar</button>
        <button class="btn-ghost" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--accent-red); color: var(--accent-red); cursor: pointer;" onclick="decidirAcesso('${req.username}', 'rejeitado')">Rejeitar</button>
      `;
    } else {
      actionsHtml = `
        <button class="btn-ghost" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--text-muted); color: var(--text-secondary); cursor: pointer;" onclick="excluirSolicitacao('${req.username}')">Excluir</button>
      `;
    }

    // Helper simples para escapar HTML inline
    const cleanUser = req.username.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      <tr>
        <td style="font-weight: 700; color: var(--text-primary);">${cleanUser}</td>
        <td>${dateStr}</td>
        <td>
          <span class="chip" style="${statusStyle} font-weight: 600; font-size: 0.75rem; padding: 4px 8px; border-radius: var(--radius-sm);">
            ${statusLabel}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            ${actionsHtml}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.decidirAcesso = function(username, status) {
  const dataRaw = RemoteStorage.getItem('hrn_solicitacoes_acesso');
  let requests = [];
  try {
    requests = dataRaw ? JSON.parse(dataRaw) : [];
  } catch (e) {
    console.error(e);
  }

  const req = requests.find(r => r.username.toLowerCase() === username.toLowerCase());
  if (req) {
    req.status = status;
    RemoteStorage.setItem('hrn_solicitacoes_acesso', JSON.stringify(requests));
    
    // Dispara SyncManager para salvar no servidor
    if (typeof SyncManager !== 'undefined' && typeof SyncManager.saveToServer === "function") {
      SyncManager.saveToServer();
    }
    
    showToast(`Solicitação de ${username} foi ${status}!`, 'success');
    renderUsuarios();
  }
};

window.excluirSolicitacao = function(username) {
  if (!confirm(`Deseja excluir a solicitação do usuário ${username}?`)) return;
  
  const dataRaw = RemoteStorage.getItem('hrn_solicitacoes_acesso');
  let requests = [];
  try {
    requests = dataRaw ? JSON.parse(dataRaw) : [];
  } catch (e) {
    console.error(e);
  }

  const newRequests = requests.filter(r => r.username.toLowerCase() !== username.toLowerCase());
  RemoteStorage.setItem('hrn_solicitacoes_acesso', JSON.stringify(newRequests));
  
  // Dispara SyncManager para salvar no servidor
  if (typeof SyncManager !== 'undefined' && typeof SyncManager.saveToServer === "function") {
    SyncManager.saveToServer();
  }
  
  showToast(`Solicitação de ${username} excluída.`, 'success');
  renderUsuarios();
};
