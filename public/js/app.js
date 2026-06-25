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
  editingOpId: null,
  editingModeloId: null,
  editingMaterialId: null,
  editingPecaId: null,
  editingFundicaoId: null,
  editingVendaId: null,
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
  const mats = DB.getMateriais();
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
    case 'ordens':
      if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
      break;
    case 'modelos':     renderModelos();     break;
    case 'estoque':     renderEstoque();     break;
    case 'fundicao':    renderFundicao();    break;
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
      <td class="${atrasado ? 'priority-urgente' : ''}">${formatDate(op.prazo)}${atrasado ? ' ' + '⚠' : ''}</td>
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
        estoqueBadge = `<span class="chip chip--red" style="font-size:0.65rem;padding:2px 6px" title="Falta de insumos no estoque">⚠ Falta Insumos</span>`;
      } else {
        estoqueBadge = `<span class="chip chip--green" style="font-size:0.65rem;padding:2px 6px" title="Estoque de insumos OK">✓ Estoque OK</span>`;
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
        ${atrasado ? '⚠' + ' ' : ''}${formatDate(op.prazo)}
      </span>
      <button class="btn-icon danger" onclick="event.stopPropagation(); deleteOp('${op.id}')" title="Excluir OP">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </div>
  </div>`;
}

function deleteOp(id) {
  if (!confirm('Excluir esta Ordem de Produção?')) return;
  DB.deleteOp(id);
  renderOrdens();
  if (STATE.currentPage === 'dashboard') renderDashboard();
  showToast('Ordem de produção excluída.', 'error');
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
  if (!reqs || (!reqs.bucha && !reqs.caixa)) {
    previewDiv.style.display = 'none';
    return;
  }

  previewDiv.style.display = 'block';
  listDiv.innerHTML = '';

  // Render Bucha
  if (reqs.bucha) {
    const b = reqs.bucha;
    const badgeClass = b.insuficiente ? 'chip--red' : 'chip--green';
    const badgeText = b.insuficiente ? `Falta ${b.falta} un` : 'Estoque OK';
    const statusText = b.insuficiente 
      ? `<span style="color:var(--accent-red);font-weight:600;font-size:0.72rem">⚠ Produzir Bucha</span>`
      : `<span style="color:var(--accent-green);font-weight:600;font-size:0.72rem">✓ Estoque Disponível</span>`;
      
    listDiv.innerHTML += `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.65rem;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${b.nome}">⚙ Bucha</div>
        <div style="font-size:0.68rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${b.nome}">${b.nome}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <span style="font-size:0.72rem;color:var(--text-muted)">Qtd: <strong>${qty}</strong> | Saldo: <strong>${b.saldo}</strong></span>
          <span class="chip ${badgeClass}" style="font-size:0.65rem;padding:2px 6px">${badgeText}</span>
        </div>
        <div style="margin-top:2px">${statusText}</div>
      </div>
    `;
  } else {
    listDiv.innerHTML += `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.65rem;color:var(--text-muted);font-size:0.78rem;display:flex;align-items:center;justify-content:center">
        Sem Bucha vinculada
      </div>
    `;
  }

  // Render Caixa
  if (reqs.caixa) {
    const c = reqs.caixa;
    const badgeClass = c.insuficiente ? 'chip--red' : 'chip--green';
    const badgeText = c.insuficiente ? `Falta ${c.falta} un` : 'Estoque OK';
    const statusText = c.insuficiente 
      ? `<span style="color:var(--accent-red);font-weight:600;font-size:0.72rem">⚠ Comprar Caixa</span>`
      : `<span style="color:var(--accent-green);font-weight:600;font-size:0.72rem">✓ Estoque Disponível</span>`;
      
    listDiv.innerHTML += `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.65rem;display:flex;flex-direction:column;gap:4px">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${c.nome}">🌱“¦ Caixa</div>
        <div style="font-size:0.68rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${c.nome}">${c.nome}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
          <span style="font-size:0.72rem;color:var(--text-muted)">Qtd: <strong>${qty}</strong> | Saldo: <strong>${c.saldo}</strong></span>
          <span class="chip ${badgeClass}" style="font-size:0.65rem;padding:2px 6px">${badgeText}</span>
        </div>
        <div style="margin-top:2px">${statusText}</div>
      </div>
    `;
  } else {
    listDiv.innerHTML += `
      <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.65rem;color:var(--text-muted);font-size:0.78rem;display:flex;align-items:center;justify-content:center">
        Sem Caixa vinculada
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

function saveOp() {
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

  if (STATE.editingOpId) {
    DB.updateOp(STATE.editingOpId, data);
    showToast('Ordem de produção atualizada!');
  } else {
    DB.addOp(data);
    showToast('Ordem de produção criada!');
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
function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const sheetName = 'MATRIZ';
      if (!workbook.SheetNames.includes(sheetName)) {
        showToast(`Planilha inválida! Aba "${sheetName}" não encontrada.`, 'error');
        return;
      }
      
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      
      if (!rows.length) {
        showToast('Nenhum registro encontrado na planilha.', 'error');
        return;
      }

      let importCount = 0;
      let updateCount = 0;
      const modelos = DB.getModelos();

      rows.forEach(r => {
        const desc = r["Descrição"] || "";
        if (!desc) return;

        // Extract diameter and pitch
        let diametro = "";
        let passo = "";
        const match = desc.match(/(\d+(?:\s+\d+\/\d+)?)\s*X\s*(\d+(?:\s+\d+\/\d+)?)/i);
        if (match) {
          diametro = match[1];
          passo = match[2];
        }

        // Components description
        const extraDesc = [];
        if (r["Diâmetro Tubo Anel"] && r["Diâmetro Tubo Anel"] !== "N/A" && r["Diâmetro Tubo Anel"] !== "N/T") {
          extraDesc.push(`Tubo: ${r["Diâmetro Tubo Anel"]}`);
        }
        if (r["Bucha"] && r["Bucha"] !== "N/A") {
          extraDesc.push(`Bucha: ${r["Bucha"]}`);
        }
        if (r["Estria"] && r["Estria"] !== "N/A" && r["Estria"] !== 0 && r["Estria"] !== "0") {
          extraDesc.push(`Estria: ${r["Estria"]}`);
        }
        if (r["Descrição Caixa"] && r["Descrição Caixa"] !== "N/A") {
          extraDesc.push(`Caixa: ${r["Descrição Caixa"]}`);
        }

        const modelData = {
          nome:          desc,
          pas:           "3",
          material:      "Alumínio",
          diametro:      diametro,
          passo:         passo,
          peso:          "",
          desc:          extraDesc.join(" | "),
          
          sku:           r["Código (SKU)"] || "",
          codigoBruto:   r["Código Bruto"] || "",
          gravacaoBruto: r["Gravação Bruto"] || "",
          tuboAnel:      r["Diâmetro Tubo Anel"] || "",
          bucha:         r["Bucha"] || "",
          cor:           (r["Cor"] || "").trim(),
          estria:        (r["Estria"] === 0 || r["Estria"] === "0") ? "" : (r["Estria"] || ""),
          caixa:         r["Descrição Caixa"] || "",
          skuCaixa:      r["Código SKU Caixa"] || "",
          buchaModelo:   r["Modelo Bucha"] || ""
        };

        // Check if model already exists (by name/description or SKU)
        const existing = modelos.find(m => 
          m.nome.toLowerCase() === desc.toLowerCase() || 
          (m.sku && m.sku.toLowerCase() === (modelData.sku || '').toLowerCase())
        );

        if (existing) {
          DB.updateModelo(existing.id, modelData);
          updateCount++;
        } else {
          DB.addModelo(modelData);
          importCount++;
        }
      });

      // Clear model inputs, seed materials based on new models, and reload page
      DB.seed(); // This will auto-register any new materials into Estoque
      renderModelos();
      populateModeloSelects();
      if (STATE.currentPage === 'dashboard') renderDashboard();

      showToast(`Importado: ${importCount} novos, Atualizado: ${updateCount} modelos!`);
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar o arquivo Excel.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = ''; // reset file input
}

function renderModelos() {
  const search = ($('modelo-search')?.value || '').toLowerCase();
  let list = DB.getModelos();
  if (search) list = list.filter(m =>
    m.nome.toLowerCase().includes(search) ||
    (m.sku || '').toLowerCase().includes(search) ||
    m.material.toLowerCase().includes(search) ||
    (m.codigoBruto || '').toLowerCase().includes(search)
  );

  const grid = $('modelos-grid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:3rem">
      Nenhum modelo cadastrado.
    </div>`;
    return;
  }

  grid.innerHTML = list.map(m => {
    // Determine card dot/indicator color from the model color
    let colorDotHtml = '';
    if (m.cor) {
      const dotColor = m.cor.toUpperCase() === 'PRETO' ? '#111827' : '#e8edf5';
      colorDotHtml = `<span class="chip chip--gray" style="font-size:0.68rem;padding:2px 6px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dotColor};border:1px solid rgba(255,255,255,0.2);margin-right:4px"></span>${m.cor}</span>`;
    }

    const skuBadge = m.sku 
      ? `<div style="position:absolute;top:10px;left:10px;"><span class="chip chip--blue" style="font-weight:700;font-size:0.7rem;letter-spacing:0.04em">${m.sku}</span></div>`
      : '';

    const specsHtml = [
      `<span class="spec-tag">âš™ ${m.pas} pás</span>`,
      `<span class="spec-tag">â¬¡ ${m.material}</span>`,
      m.diametro ? `<span class="spec-tag">âŒ€ ${m.diametro}</span>` : '',
      m.passo    ? `<span class="spec-tag">â†” ${m.passo}</span>` : '',
      m.peso     ? `<span class="spec-tag">âš– ${m.peso}kg</span>` : '',
    ].filter(Boolean).join('');

    // Generate details of raw materials required
    let rawMaterialsHtml = '';
    if (m.tuboAnel || m.bucha || m.caixa || m.estria) {
      rawMaterialsHtml = `
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);font-size:0.75rem;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px">
          ${m.codigoBruto ? `<div><strong>Bruto / Coquilha:</strong> <span style="color:var(--accent-orange)">${m.codigoBruto} ${m.gravacaoBruto ? `(${m.gravacaoBruto})` : ''}</span></div>` : ''}
          ${m.tuboAnel && m.tuboAnel !== 'N/A' && m.tuboAnel !== 'N/T' ? `<div><strong>Tubo Al.:</strong> ${m.tuboAnel}</div>` : ''}
          ${m.bucha && m.bucha !== 'N/A' ? `<div><strong>Bucha Latão:</strong> ${m.bucha}</div>` : ''}
          ${m.estria && m.estria !== 'N/A' ? `<div><strong>Estria:</strong> ${m.estria}</div>` : ''}
          ${m.caixa && m.caixa !== 'N/A' ? `<div><strong>Caixa:</strong> ${m.caixa}</div>` : ''}
        </div>
      `;
    }

    return `
      <div class="modelo-card">
        <div class="modelo-card-header">
          ${skuBadge}
          <div class="modelo-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9"/>
              <path d="M9 9c-1.5 2-1.5 4 0 6"/>
              <path d="M15 9c1.5 2 1.5 4 0 6"/>
            </svg>
          </div>
          <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px">
            <button class="btn-icon" onclick="openEditModelo('${m.id}')" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon danger" onclick="deleteModelo('${m.id}')" title="Excluir">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        </div>
        <div class="modelo-card-body">
          <div class="modelo-card-name" style="margin-bottom:0.5rem;font-size:0.9rem;font-weight:700;line-height:1.4">${m.nome}</div>
          <div class="modelo-card-specs" style="margin-bottom:0.5rem">
            ${specsHtml}
            ${colorDotHtml}
          </div>
          <div class="modelo-card-desc" style="font-size:0.76rem;color:var(--text-muted)">${m.desc || 'Sem descrição.'}</div>
          ${rawMaterialsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function openNovoModelo() {
  STATE.editingModeloId = null;
  $('modal-modelo-title').textContent = 'Novo Modelo de Hélice';
  $('modelo-edit-id').value = '';
  ['modelo-nome','modelo-diametro','modelo-passo','modelo-peso','modelo-desc'].forEach(id => { $(id).value = ''; });
  $('modelo-pas').value = '3';
  $('modelo-material').value = 'Alumínio';
  $('modal-modelo').classList.remove('hidden');
}

function openEditModelo(id) {
  const m = DB.getModelos().find(x => x.id === id);
  if (!m) return;
  STATE.editingModeloId = id;
  $('modal-modelo-title').textContent = 'Editar Modelo';
  $('modelo-edit-id').value = id;
  $('modelo-nome').value     = m.nome;
  $('modelo-pas').value      = m.pas;
  $('modelo-material').value = m.material;
  $('modelo-diametro').value = m.diametro;
  $('modelo-passo').value    = m.passo;
  $('modelo-peso').value     = m.peso;
  $('modelo-desc').value     = m.desc;
  $('modal-modelo').classList.remove('hidden');
}
window.openEditModelo = openEditModelo;

function closeModalModelo() { $('modal-modelo').classList.add('hidden'); }

function saveModelo() {
  const nome = $('modelo-nome').value.trim();
  if (!nome) { showToast('Informe o nome do modelo.', 'error'); return; }
  const data = {
    nome,
    pas:      $('modelo-pas').value,
    material: $('modelo-material').value,
    diametro: $('modelo-diametro').value.trim(),
    passo:    $('modelo-passo').value.trim(),
    peso:     $('modelo-peso').value,
    desc:     $('modelo-desc').value.trim(),
  };
  if (STATE.editingModeloId) {
    DB.updateModelo(STATE.editingModeloId, data);
    showToast('Modelo atualizado!');
  } else {
    DB.addModelo(data);
    showToast('Modelo cadastrado!');
  }
  closeModalModelo();
  renderModelos();
  if (STATE.currentPage === 'dashboard') renderDashboard();
}

function deleteModelo(id) {
  if (!confirm('Excluir este modelo de hélice?')) return;
  DB.deleteModelo(id);
  renderModelos();
  showToast('Modelo excluído.', 'error');
}
window.deleteModelo = deleteModelo;

// ═══════════════════════════════════════════
// ESTOQUE
// ═══════════════════════════════════════════
function renderEstoque() {
  const search = ($('estoque-search')?.value || '').toLowerCase();
  let mats = DB.getMateriais();
  if (search) mats = mats.filter(m => m.nome.toLowerCase().includes(search));

  // Alertas
  const alertsEl = $('estoque-alerts');
  const criticos = DB.getMateriais().filter(m => m.saldo < m.minimo);
  const baixos   = DB.getMateriais().filter(m => m.saldo >= m.minimo && m.saldo < m.minimo * 1.2);
  alertsEl.innerHTML = [
    ...criticos.map(m => `<div class="alert-banner alert-banner--red">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Estoque crítico: <strong>${m.nome}</strong> — saldo atual: ${m.saldo} ${m.unidade} (mínimo: ${m.minimo})
    </div>`),
    ...baixos.map(m => `<div class="alert-banner alert-banner--orange">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Atenção: <strong>${m.nome}</strong> está próximo do mínimo — saldo: ${m.saldo} ${m.unidade}
    </div>`)
  ].join('');

  // Tabela
  const tbody = $('estoque-body');
  if (!mats.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhum material cadastrado.</td></tr>';
  } else {
    tbody.innerHTML = mats.map(m => {
      const critico = m.saldo < m.minimo;
      const baixo   = !critico && m.saldo < m.minimo * 1.2;
      const statusChip = critico
        ? `<span class="chip chip--red">Crítico</span>`
        : baixo
          ? `<span class="chip chip--orange">Baixo</span>`
          : `<span class="chip chip--green">Normal</span>`;
      return `<tr>
        <td style="color:var(--text-primary);font-weight:500">${m.nome}</td>
        <td>${m.unidade}</td>
        <td style="${critico ? 'color:var(--accent-red);font-weight:700' : baixo ? 'color:var(--accent-orange);font-weight:600' : ''}">${m.saldo}</td>
        <td>${m.minimo}</td>
        <td>${statusChip}</td>
        <td><div class="td-actions">
          <button class="btn-icon" onclick="openEditMaterial('${m.id}')" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" onclick="deleteMaterial('${m.id}')" title="Excluir">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div></td>
      </tr>`;
    }).join('');
  }

  // Histórico de movimentações
  const movs = DB.getMovimentos().slice().reverse();
  const movBody = $('mov-body');
  if (!movs.length) {
    movBody.innerHTML = '<tr><td colspan="6" class="empty-cell">Sem movimentações registradas.</td></tr>';
  } else {
    movBody.innerHTML = movs.map(mv => `<tr>
      <td>${formatDateTime(mv.data)}</td>
      <td style="color:var(--text-primary)">${mv.materialNome}</td>
      <td>${mv.tipo === 'Entrada'
        ? `<span class="chip chip--green">Entrada</span>`
        : `<span class="chip chip--red">Saída</span>`}</td>
      <td style="font-weight:600">${mv.qty}</td>
      <td>${mv.opNumero || '—'}</td>
      <td style="color:var(--text-muted)">${mv.obs || '—'}</td>
    </tr>`).join('');
  }
}

function openEditMaterial(id) {
  const m = DB.getMateriais().find(x => x.id === id);
  if (!m) return;
  STATE.editingMaterialId = id;
  $('modal-material-title').textContent = 'Editar Material';
  $('material-edit-id').value = id;
  $('material-nome').value       = m.nome;
  $('material-unidade').value    = m.unidade;
  $('material-saldo').value      = m.saldo;
  $('material-minimo').value     = m.minimo;
  $('material-fornecedor').value = m.fornecedor || '';
  $('modal-material').classList.remove('hidden');
}
window.openEditMaterial = openEditMaterial;

function deleteMaterial(id) {
  if (!confirm('Excluir este material do estoque?')) return;
  DB.deleteMaterial(id);
  renderEstoque();
  showToast('Material excluído.', 'error');
}
window.deleteMaterial = deleteMaterial;

function openNovoMaterial() {
  STATE.editingMaterialId = null;
  $('modal-material-title').textContent = 'Novo Material';
  $('material-edit-id').value = '';
  ['material-nome','material-saldo','material-minimo','material-fornecedor'].forEach(id => { $(id).value = ''; });
  $('material-unidade').value = 'kg';
  $('modal-material').classList.remove('hidden');
}

function closeModalMaterial() { $('modal-material').classList.add('hidden'); }

function saveMaterial() {
  const nome = $('material-nome').value.trim();
  if (!nome) { showToast('Informe o nome do material.', 'error'); return; }
  const saldo  = parseFloat($('material-saldo').value);
  const minimo = parseFloat($('material-minimo').value);
  if (isNaN(saldo)) { showToast('Informe o saldo atual.', 'error'); return; }
  if (isNaN(minimo)) { showToast('Informe o estoque mínimo.', 'error'); return; }
  const data = {
    nome, saldo, minimo,
    unidade:    $('material-unidade').value,
    fornecedor: $('material-fornecedor').value.trim(),
  };
  if (STATE.editingMaterialId) {
    DB.updateMaterial(STATE.editingMaterialId, data);
    showToast('Material atualizado!');
  } else {
    DB.addMaterial(data);
    showToast('Material cadastrado!');
  }
  closeModalMaterial();
  renderEstoque();
}

// Modal Movimentação
function openModalMov() {
  populateMaterialSelect();
  populateOpSelectMov();
  $('mov-qty').value = '';
  $('mov-obs').value = '';
  $('mov-tipo').value = 'Entrada';
  $('modal-mov').classList.remove('hidden');
}
function closeModalMov() { $('modal-mov').classList.add('hidden'); }

function saveMov() {
  const matId = $('mov-material').value;
  const qty   = parseFloat($('mov-qty').value);
  const tipo  = $('mov-tipo').value;
  if (!matId) { showToast('Selecione um material.', 'error'); return; }
  if (!qty || qty <= 0) { showToast('Informe uma quantidade válida.', 'error'); return; }

  const mat = DB.getMaterialById(matId);
  if (!mat) return;

  if (tipo === 'Saída' && qty > mat.saldo) {
    showToast(`Saldo insuficiente! Disponível: ${mat.saldo} ${mat.unidade}`, 'error');
    return;
  }

  const opId = $('mov-op').value;
  const op   = opId ? DB.getOpById(opId) : null;
  DB.addMovimento({
    materialId:   matId,
    materialNome: mat.nome,
    tipo, qty,
    opId:    op?.id || '',
    opNumero:op?.numero || '',
    obs:     $('mov-obs').value.trim(),
  });
  showToast(`Movimentação registrada: ${tipo} de ${qty} ${mat.unidade}`);
  closeModalMov();
  renderEstoque();
}

// ═══════════════════════════════════════════
// PROGRAMAÇÃO DE FUNDIÇÃO DE HÉLICE
// ═══════════════════════════════════════════
function statusFundicaoChip(s) {
  const map = {
    'Agendado':     'chip--blue',
    'Em Andamento': 'chip--orange',
    'Concluído':    'chip--green',
    'Cancelado':    'chip--gray',
  };
  return `<span class="chip ${map[s] || 'chip--gray'}">${s}</span>`;
}

function renderFundicao() {
  const search = ($('fundicao-search')?.value || '').toLowerCase();
  const filterStatus = $('fundicao-filter-status')?.value || '';
  let list = DB.getFundicoes();

  if (search) list = list.filter(f =>
    f.numero.toLowerCase().includes(search) ||
    f.modelo.toLowerCase().includes(search) ||
    f.material.toLowerCase().includes(search) ||
    (f.forno || '').toLowerCase().includes(search)
  );
  if (filterStatus) list = list.filter(f => f.status === filterStatus);

  // KPIs
  const all = DB.getFundicoes();
  const agora = new Date();
  const mesAtual = agora.getMonth(); const anoAtual = agora.getFullYear();
  $('kpi-fund-agendadas').textContent  = all.filter(f => f.status === 'Agendado').length;
  $('kpi-fund-andamento').textContent  = all.filter(f => f.status === 'Em Andamento').length;
  $('kpi-fund-concluidas').textContent = all.filter(f => {
    if (f.status !== 'Concluído') return false;
    const d = new Date(f.criadoEm);
    return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
  }).length;
  $('kpi-fund-pecas').textContent = all.reduce((acc, f) => acc + (parseInt(f.qty) || 0), 0);

  // Tabela
  const tbody = $('fundicao-body');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">Nenhuma programação de fundição cadastrada.</td></tr>';
    return;
  }
  tbody.innerHTML = list.slice().reverse().map(f => `<tr>
    <td><span style="color:var(--accent-orange);font-weight:700">${f.numero}</span></td>
    <td style="color:var(--text-primary);font-weight:500">${f.modelo || '—'}</td>
    <td>${f.material || '—'}</td>
    <td>${f.qty}</td>
    <td>${f.peso > 0 ? f.peso + ' kg' : '—'}</td>
    <td>${formatDate(f.data)}</td>
    <td>${f.forno || '—'}</td>
    <td>${f.temp ? f.temp + '°C' : '—'}</td>
    <td>${statusFundicaoChip(f.status)}</td>
    <td><div class="td-actions">
      <button class="btn-icon" onclick="openEditFundicao('${f.id}')" title="Editar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-icon danger" onclick="deleteFundicao('${f.id}')" title="Excluir">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div></td>
  </tr>`).join('');
}

function populateFundicaoModeloSelect() {
  const modelos = DB.getModelos();
  const opts = ['<option value="">— Selecione um modelo —</option>',
    ...modelos.map(m => `<option value="${m.nome}">${m.nome}</option>`)
  ].join('');
  const el = $('fundicao-modelo');
  if (el) el.innerHTML = opts;
}

function openNovaFundicao() {
  STATE.editingFundicaoId = null;
  $('modal-fundicao-title').textContent = 'Nova Programação de Fundição';
  $('fundicao-edit-id').value = '';
  $('fundicao-qty').value = 1;
  $('fundicao-peso').value = '';
  $('fundicao-data').value = '';
  $('fundicao-forno').value = '';
  $('fundicao-temp').value = '';
  $('fundicao-obs').value = '';
  $('fundicao-status').value = 'Agendado';
  $('fundicao-material').value = 'Alumínio Liga 356';
  populateFundicaoModeloSelect();
  $('modal-fundicao').classList.remove('hidden');
}

function openEditFundicao(id) {
  const f = DB.getFundicoes().find(x => x.id === id);
  if (!f) return;
  STATE.editingFundicaoId = id;
  $('modal-fundicao-title').textContent = `Editar Programação – ${f.numero}`;
  $('fundicao-edit-id').value  = id;
  populateFundicaoModeloSelect();
  $('fundicao-modelo').value   = f.modelo;
  $('fundicao-qty').value      = f.qty;
  $('fundicao-material').value = f.material;
  $('fundicao-peso').value     = f.peso;
  $('fundicao-data').value     = f.data;
  $('fundicao-forno').value    = f.forno;
  $('fundicao-temp').value     = f.temp;
  $('fundicao-status').value   = f.status;
  $('fundicao-obs').value      = f.obs;
  $('modal-fundicao').classList.remove('hidden');
}
window.openEditFundicao = openEditFundicao;

function closeModalFundicao() { $('modal-fundicao').classList.add('hidden'); }

function saveFundicao() {
  const modelo = $('fundicao-modelo').value;
  const dataVal = $('fundicao-data').value;
  if (!modelo)  { showToast('Selecione um modelo de hélice.', 'error'); return; }
  if (!dataVal) { showToast('Informe a data programada.', 'error'); return; }
  const data = {
    modelo,
    qty:      parseInt($('fundicao-qty').value) || 1,
    material: $('fundicao-material').value,
    peso:     parseFloat($('fundicao-peso').value) || 0,
    data:     dataVal,
    forno:    $('fundicao-forno').value.trim(),
    temp:     $('fundicao-temp').value,
    status:   $('fundicao-status').value,
    obs:      $('fundicao-obs').value.trim(),
  };
  if (STATE.editingFundicaoId) {
    DB.updateFundicao(STATE.editingFundicaoId, data);
    showToast('Programação de fundição atualizada!');
  } else {
    DB.addFundicao(data);
    showToast('Programação de fundição criada!');
  }
  closeModalFundicao();
  renderFundicao();
}

function deleteFundicao(id) {
  if (!confirm('Excluir esta programação de fundição?')) return;
  DB.deleteFundicao(id);
  renderFundicao();
  showToast('Programação excluída.', 'error');
}
window.deleteFundicao = deleteFundicao;

// ═══════════════════════════════════════════
// MANUTENÇÃO DE FERRAMENTAS
// ═══════════════════════════════════════════

function statusMntChip(s) {
  const map = {
    'Em Manutenção':  'chip--orange',
    'Aguardando Peça': 'chip--blue',
    'Interditada':      'chip--red',
    'Liberada':         'chip--green',
  };
  return `<span class="chip ${map[s] || 'chip--gray'}">${s}</span>`;
}

function prioridadeMntChip(p) {
  const map = { 'Normal': 'chip--gray', 'Alta': 'chip--orange', 'Urgente': 'chip--red' };
  return `<span class="chip ${map[p] || 'chip--gray'}">${p}</span>`;
}

function renderManutencao() {
  const search      = ($('mnt-search')?.value || '').toLowerCase();
  const filterStatus= $('mnt-filter-status')?.value || '';
  const filterTipo  = $('mnt-filter-tipo')?.value   || '';
  const all         = DB.getManutencoes();

  // KPIs
  const elAnd  = $('kpi-mnt-andamento');
  const elInt  = $('kpi-mnt-interditadas');
  const elAgu  = $('kpi-mnt-aguardando');
  const elLib  = $('kpi-mnt-liberadas');
  if (elAnd)  elAnd.textContent  = all.filter(m => m.status === 'Em Manutenção').length;
  if (elInt)  elInt.textContent  = all.filter(m => m.status === 'Interditada').length;
  if (elAgu)  elAgu.textContent  = all.filter(m => m.status === 'Aguardando Peça').length;
  if (elLib)  elLib.textContent  = all.filter(m => m.status === 'Liberada').length;

  // Filtragem
  let list = all;
  if (search)       list = list.filter(m =>
    (m.ferramenta||'').toLowerCase().includes(search) ||
    (m.motivo||'').toLowerCase().includes(search) ||
    (m.responsavel||'').toLowerCase().includes(search) ||
    (m.numero||'').toLowerCase().includes(search)
  );
  if (filterStatus) list = list.filter(m => m.status === filterStatus);

  const tbody = $('mnt-body');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">${
      all.length === 0
        ? 'Nenhuma ferramenta em manutenção. Clique em "Interditar Ferramenta" para registrar.'
        : 'Nenhum registro encontrado para os filtros aplicados.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice().reverse().map(m => {
    // Calcula dias em manutenção
    const diasStr = m.dataEntrada
      ? (() => { const d = Math.floor((Date.now() - new Date(m.dataEntrada).getTime()) / 86400000); return d + 'd'; })()
      : '—';
    // Verifica atraso na previsão
    const atrasado = m.dataPrevisao && m.status !== 'Liberada' && new Date(m.dataPrevisao) < new Date();
    return `<tr>
      <td><span style="color:var(--accent-orange);font-weight:700">${m.numero}</span></td>
      <td style="color:var(--text-primary);font-weight:600">${m.ferramenta}</td>
      <td><span class="chip chip--gray">${m.tipo}</span></td>
      <td style="color:var(--text-secondary);font-size:0.76rem">${m.motivo || '—'}</td>
      <td style="color:var(--text-muted);font-size:0.76rem">${m.responsavel || '—'}</td>
      <td style="color:var(--text-muted);font-size:0.76rem">${m.dataEntrada ? (formatDate(m.dataEntrada) + ' <span style="color:var(--text-muted);font-size:0.68rem">('+diasStr+')</span>') : '—'}</td>
      <td style="color:${atrasado ? 'var(--accent-red)' : 'var(--text-muted)'};font-size:0.76rem;font-weight:${atrasado ? '700' : '400'}">${m.dataPrevisao ? formatDate(m.dataPrevisao) + (atrasado ? ' ⚠' : '') : '—'}</td>
      <td>${prioridadeMntChip(m.prioridade)}</td>
      <td>${statusMntChip(m.status)}</td>
      <td><div class="td-actions">
        <button class="btn-icon" onclick="openEditManutencao('${m.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${m.status !== 'Liberada' ? `<button class="btn-icon success" onclick="liberarManutencao('${m.id}')" title="Liberar ferramenta">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        <button class="btn-icon danger" onclick="deleteManutencao('${m.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}

function resetMntFerramentaOptions() {
  const select = $('mnt-ferramenta');
  if (!select) return;
  let html = '<option value="">Selecione...</option>';
  for (let i = 2; i <= 22; i++) {
    const num = String(i).padStart(2, '0');
    html += `<option value="COQUILHA ${num}">COQUILHA ${num}</option>`;
  }
  select.innerHTML = html;
}

function openNovaManutencao() {
  STATE.editingMntId = null;
  $('modal-mnt-title').textContent = 'Interditar Ferramenta';
  $('mnt-edit-id').value    = '';
  resetMntFerramentaOptions();
  $('mnt-ferramenta').value = '';
  $('mnt-tipo').value       = 'Coquilha';
  $('mnt-motivo').value     = '';
  $('mnt-responsavel').value= '';
  $('mnt-prioridade').value = 'Normal';
  $('mnt-status').value     = 'Em Manutenção';
  $('mnt-obs').value        = '';
  $('mnt-data-entrada').value   = new Date().toISOString().split('T')[0];
  $('mnt-data-previsao').value  = '';
  $('modal-manutencao').classList.remove('hidden');
}

function openEditManutencao(id) {
  const m = DB.getManutencoes().find(x => x.id === id);
  if (!m) return;
  STATE.editingMntId = id;
  $('modal-mnt-title').textContent  = `Editar Manutenção – ${m.numero}`;
  $('mnt-edit-id').value     = id;
  
  resetMntFerramentaOptions();
  const selectFerramenta = $('mnt-ferramenta');
  if (selectFerramenta && m.ferramenta) {
    let optionExists = false;
    for (let i = 0; i < selectFerramenta.options.length; i++) {
      if (selectFerramenta.options[i].value === m.ferramenta) {
        optionExists = true;
        break;
      }
    }
    if (!optionExists) {
      const opt = document.createElement('option');
      opt.value = m.ferramenta;
      opt.textContent = m.ferramenta;
      selectFerramenta.appendChild(opt);
    }
  }
  $('mnt-ferramenta').value  = m.ferramenta;
  $('mnt-tipo').value        = m.tipo;
  $('mnt-motivo').value      = m.motivo;
  $('mnt-responsavel').value = m.responsavel;
  $('mnt-prioridade').value  = m.prioridade;
  $('mnt-status').value      = m.status;
  $('mnt-obs').value         = m.obs;
  $('mnt-data-entrada').value   = m.dataEntrada   || '';
  $('mnt-data-previsao').value  = m.dataPrevisao  || '';
  $('modal-manutencao').classList.remove('hidden');
}
window.openEditManutencao = openEditManutencao;

function closeModalManutencao() { $('modal-manutencao').classList.add('hidden'); }

function saveManutencao() {
  const ferramenta = $('mnt-ferramenta').value.trim();
  const motivo     = $('mnt-motivo').value.trim();
  if (!ferramenta) { showToast('Informe o nome da ferramenta/coquilha.', 'error'); return; }
  if (!motivo)     { showToast('Informe o motivo da interdição.', 'error'); return; }
  const data = {
    ferramenta,
    tipo:         $('mnt-tipo').value,
    motivo,
    responsavel:  $('mnt-responsavel').value.trim(),
    prioridade:   $('mnt-prioridade').value,
    status:       $('mnt-status').value,
    obs:          $('mnt-obs').value.trim(),
    dataEntrada:  $('mnt-data-entrada').value,
    dataPrevisao: $('mnt-data-previsao').value,
  };
  if (STATE.editingMntId) {
    DB.updateManutencao(STATE.editingMntId, data);
    showToast('Registro de manutenção atualizado!');
  } else {
    DB.addManutencao(data);
    showToast('Ferramenta interditada e registrada!');
  }
  closeModalManutencao();
  renderManutencao();
}

function liberarManutencao(id) {
  if (!confirm('Liberar esta ferramenta para uso?')) return;
  DB.updateManutencao(id, { status: 'Liberada' });
  showToast('✅ Ferramenta liberada para uso!');
  renderManutencao();
}
window.liberarManutencao = liberarManutencao;

function deleteManutencao(id) {
  if (!confirm('Excluir este registro de manutenção?')) return;
  DB.deleteManutencao(id);
  renderManutencao();
  showToast('Registro removido.', 'error');
}
window.deleteManutencao = deleteManutencao;

// ═══════════════════════════════════════════
// RASTREIO DE OPERAÇÕES (FLUXO)
// ═══════════════════════════════════════════

// ── OPERAÇÕES DO FLUXO PRODUTIVO (7 etapas) ──
const OPERACOES = [
  { codigo: '01', nome: 'Fundição',      cor: '#f97316', icon: '🌱”¥' },
  { codigo: '02', nome: 'Vulcanização',  cor: '#e11d48', icon: '♨️' },
  { codigo: '03', nome: 'Polimento',     cor: '#a855f7', icon: '✨' },
  { codigo: '04', nome: 'Usinagem',      cor: '#3b82f6', icon: '⚙️' },
  { codigo: '05', nome: 'Pintura',       cor: '#ec4899', icon: '🌱Ž¨' },
  { codigo: '06', nome: 'Embuchamento',  cor: '#f59e0b', icon: '🌱› ï¸' },
  { codigo: '07', nome: 'Gravação',      cor: '#14b8a6', icon: 'âœï¸' },
];

const ULTIMA_OP = '07'; // Última operação do fluxo

function getOpLabel(codigo) {
  const op = OPERACOES.find(o => o.codigo === codigo);
  return op ? `${op.codigo} – ${op.nome}` : codigo;
}

function getOpCor(codigo) {
  const op = OPERACOES.find(o => o.codigo === codigo);
  return op ? op.cor : '#888';
}

// ── Calcula o status visual de uma peça baseado no tempo na op ──
function calcularStatus(p) {
  if (p.status === 'bloqueado') return 'bloqueado';
  if (p.operacaoAtual === ULTIMA_OP) return 'concluido';
  if (!p.atualizadoEm) return 'em-producao';
  const diffH = (Date.now() - new Date(p.atualizadoEm).getTime()) / 3600000;
  if (diffH > 120) return 'atrasado';   // > 5 dias
  if (diffH > 48)  return 'atencao';    // > 2 dias
  return 'em-producao';
}

function statusBadge(status) {
  const map = {
    'em-producao': ['status-em-producao', 'Em Produção'],
    'atencao':     ['status-atencao',     'Atenção'],
    'atrasado':    ['status-atrasado',    'Atrasado'],
    'bloqueado':   ['status-bloqueado',   'Bloqueado'],
    'concluido':   ['status-concluido',   'Concluído'],
  };
  const [cls, label] = map[status] || map['em-producao'];
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function calcularPorcentagem(p) {
  const idx = OPERACOES.findIndex(o => o.codigo === p.operacaoAtual);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / OPERACOES.length) * 100);
}

function progressBar(pct, status) {
  const fillClass = status === 'concluido' ? 'progress-fill progress-fill--done' : 'progress-fill';
  return `<div class="progress-wrap">
    <div class="progress-pct">${pct}%</div>
    <div class="progress-bar"><div class="${fillClass}" style="width:${pct}%"></div></div>
  </div>`;
}

// ── Render dos KPIs do Rastreio ──
function renderFluxoKPIs(pecas) {
  const total      = pecas.length;
  const atencao    = pecas.filter(p => { const s = calcularStatus(p); return s === 'atencao' || s === 'atrasado'; }).length;
  const bloqueadas = pecas.filter(p => calcularStatus(p) === 'bloqueado').length;
  const concluidas = pecas.filter(p => calcularStatus(p) === 'concluido').length;
  const el = id => document.getElementById(id);
  if (el('fkpi-total'))      el('fkpi-total').textContent      = total;
  if (el('fkpi-atencao'))    el('fkpi-atencao').textContent    = atencao;
  if (el('fkpi-bloqueadas')) el('fkpi-bloqueadas').textContent = bloqueadas;
  if (el('fkpi-concluidas')) el('fkpi-concluidas').textContent = concluidas;
  const lbl = el('fluxo-count-label');
  if (lbl) lbl.textContent = `${total} peça${total !== 1 ? 's' : ''}`;
}

// ── Pipeline visual com micro-indicadores ──
function renderPipeline() {
  const pipeline = $('flow-pipeline');
  if (!pipeline) return;
  const pecas = DB.getPecas();

  // Contagens e soma de qty por operação
  const contagens   = {};
  const totalQty    = {};
  const atrasaídas   = {};
  const bloqueadas  = {};
  OPERACOES.forEach(op => {
    contagens[op.codigo]  = 0;
    totalQty[op.codigo]   = 0;
    atrasaídas[op.codigo]  = 0;
    bloqueadas[op.codigo] = 0;
  });
  pecas.forEach(p => {
    if (contagens[p.operacaoAtual] !== undefined) {
      contagens[p.operacaoAtual]++;
      totalQty[p.operacaoAtual] += (parseInt(p.qty) || 0);
      const s = calcularStatus(p);
      if (s === 'atrasado') atrasaídas[p.operacaoAtual]++;
      if (s === 'bloqueado') bloqueadas[p.operacaoAtual]++;
    }
  });

  pipeline.innerHTML = OPERACOES.map((op, i) => {
    const count = contagens[op.codigo];
    const qty   = totalQty[op.codigo];
    const isActive = count > 0;
    return `
      <div class="pipeline-step ${isActive ? 'pipeline-step--active' : ''}" style="--op-color:${op.cor}">
        <div>
          <div class="pipeline-icon">${op.icon}</div>
          <div class="pipeline-code">${op.codigo}</div>
          <div class="pipeline-name">${op.nome}</div>
          <div class="pipeline-count" style="color:${isActive ? op.cor : 'var(--text-muted)'}">
            ${count} lote${count !== 1 ? 's' : ''}
          </div>
          <div class="pipeline-qty-total" style="color:${isActive ? op.cor : 'var(--text-muted)'}; opacity:0.85; font-size:0.72rem; font-weight:700; margin-top:2px;">
            ${qty.toLocaleString('pt-BR')} peças
          </div>
          <div class="pipeline-indicators">
            <div class="pipeline-ind">
              <span class="pipeline-ind-val" style="color:var(--accent-red)">${atrasaídas[op.codigo]}</span>
              <span class="pipeline-ind-lbl">Atras.</span>
            </div>
            <div class="pipeline-ind">
              <span class="pipeline-ind-val" style="color:var(--accent-purple)">${bloqueadas[op.codigo]}</span>
              <span class="pipeline-ind-lbl">Bloq.</span>
            </div>
          </div>
        </div>
        ${i < OPERACOES.length - 1 ? '<div class="pipeline-arrow">”º</div>' : ''}
      </div>`;
  }).join('');
}

// ── Tabela principal de Rastreio ──
function renderFluxo() {
  const allPecas = DB.getPecas();
  renderPipeline();
  renderFluxoKPIs(allPecas);

  const search       = ($('fluxo-search')?.value || '').toLowerCase();
  const filterOp     = $('fluxo-filter-op')?.value || '';
  const filterStatus = $('fluxo-filter-status')?.value || '';
  let list = allPecas;

  if (search)       list = list.filter(p =>
    (p.numero||'').toLowerCase().includes(search) ||
    (p.modelo||'').toLowerCase().includes(search)
  );
  if (filterOp)     list = list.filter(p => p.operacaoAtual === filterOp);
  if (filterStatus) list = list.filter(p => calcularStatus(p) === filterStatus);

  const tbody = $('fluxo-body');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-cell">${
      allPecas.length === 0
        ? 'Nenhuma peça em rastreio. Clique em "Nova Peça" para começar.'
        : 'Nenhuma peça encontrada para os filtros aplicados.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const op       = OPERACOES.find(o => o.codigo === p.operacaoAtual) || OPERACOES[0];
    const isUltima = p.operacaoAtual === ULTIMA_OP;
    const status   = calcularStatus(p);
    const pct      = calcularPorcentagem(p);
    const tempoNaOp = tempoDecorrido(p.atualizadoEm);
    const opLink = p.opNumero
      ? `<span style="color:var(--accent-blue);font-weight:700;cursor:pointer;font-size:0.76rem" onclick="navigate('ordens')" title="Ver na aba Ordens de Produção">${p.opNumero}</span>`
      : '<span style="color:var(--text-muted);font-size:0.76rem">—</span>';
    return `<tr>
      <td><span style="color:var(--accent-purple);font-weight:700;cursor:pointer" onclick="openHistorico('${p.id}')" title="Ver histórico">${p.numero}</span></td>
      <td style="color:var(--text-primary);font-weight:500">${p.modelo || '—'}</td>
      <td>${p.qty}</td>
      <td>${opLink}</td>
      <td><span class="op-badge" style="background:${op.cor}22;color:${op.cor};border:1px solid ${op.cor}55">${op.icon} ${op.codigo} – ${op.nome}</span></td>
      <td style="color:var(--text-muted);font-size:0.76rem">${formatDateTime(p.atualizadoEm)}</td>
      <td style="color:var(--text-muted);font-size:0.76rem">${tempoNaOp}</td>
      <td>${statusBadge(status)}</td>
      <td>${progressBar(pct, status)}</td>
      <td><div class="td-actions">
        <button class="btn-icon" onclick="openHistorico('${p.id}')" title="Ver histórico completo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
        ${!isUltima ? `<button class="btn-icon success" onclick="avancarOp('${p.id}')" title="Avançar operação">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>` : `<span title="Entrada em Estoque – Concluído" style="color:var(--accent-green);font-size:0.72rem;font-weight:700">✓ Est.</span>`}
        <button class="btn-icon" onclick="openEditPeca('${p.id}')" title="Editar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon danger" onclick="deletePeca('${p.id}')" title="Excluir">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}


function tempoDecorrido(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days > 0)  return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// ── Modal de Histórico da Peça ──
function openHistorico(id) {
  const p = DB.getPecas().find(x => x.id === id);
  if (!p) return;
  const op     = OPERACOES.find(o => o.codigo === p.operacaoAtual) || OPERACOES[0];
  const status = calcularStatus(p);
  const pct    = calcularPorcentagem(p);
  const hist   = p.historico || [];

  $('modal-historico-title').textContent = `Histórico – ${p.numero}`;

  // Calcula tempo total (desde criação)
  const tempoTotal = tempoDecorrido(p.criadoEm);

  $('modal-historico-body').innerHTML = `
    <div class="peca-info-grid">
      <div class="peca-info-item">
        <div class="peca-info-label">Nº / Lote</div>
        <div class="peca-info-value" style="color:var(--accent-purple)">${p.numero}</div>
      </div>
      <div class="peca-info-item">
        <div class="peca-info-label">Modelo</div>
        <div class="peca-info-value">${p.modelo || '—'}</div>
      </div>
      <div class="peca-info-item">
        <div class="peca-info-label">Quantidade</div>
        <div class="peca-info-value">${p.qty} peça${p.qty !== 1 ? 's' : ''}</div>
      </div>
      <div class="peca-info-item">
        <div class="peca-info-label">OP Atual</div>
        <div class="peca-info-value" style="color:${op.cor}">${op.icon} ${op.codigo} – ${op.nome}</div>
      </div>
      <div class="peca-info-item">
        <div class="peca-info-label">Tempo Total</div>
        <div class="peca-info-value">${tempoTotal}</div>
      </div>
      <div class="peca-info-item">
        <div class="peca-info-label">Status</div>
        <div class="peca-info-value">${statusBadge(status)}</div>
      </div>
    </div>
    <div style="margin-bottom:1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;letter-spacing:0.06em;text-transform:uppercase">Progresso no Fluxo</span>
        <span style="font-size:0.78rem;font-weight:700;color:var(--text-secondary)">${pct}%</span>
      </div>
      <div class="progress-bar" style="height:8px">
        <div class="${status === 'concluido' ? 'progress-fill progress-fill--done' : 'progress-fill'}" style="width:${pct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px">
        <span style="font-size:0.65rem;color:var(--text-muted)">Fundição</span>
        <span style="font-size:0.65rem;color:var(--accent-teal)">Entrada em Estoque</span>
      </div>
    </div>
    <div style="font-size:0.78rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.75rem">Histórico de Operações</div>
    ${hist.length === 0
      ? `<div style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1.5rem">Nenhum registro de movimentação.</div>`
      : `<div class="historico-timeline">${hist.map((h, i) => {
          const hopData = OPERACOES.find(o => o.codigo === h.op);
          const isLast = i === hist.length - 1;
          return `<div class="historico-item">
            <div class="historico-op-label">${hopData ? `${hopData.icon} ${hopData.codigo} – ${hopData.nome}` : h.op}</div>
            <div class="historico-data">${formatDateTime(h.data)}</div>
            ${h.obs ? `<div class="historico-obs">${h.obs}</div>` : ''}
          </div>`;
        }).join('')}</div>`
    }
    ${p.obs ? `<div style="margin-top:1rem;padding:0.75rem;background:var(--bg-elevated);border-radius:var(--radius);border:1px solid var(--border)">
      <div style="font-size:0.68rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.35rem">Observações</div>
      <div style="font-size:0.83rem;color:var(--text-secondary)">${p.obs}</div>
    </div>` : ''}
  `;

  $('modal-historico').classList.remove('hidden');
}
window.openHistorico = openHistorico;

function closeModalHistorico() { $('modal-historico').classList.add('hidden'); }

function openNovaPeca() {
  STATE.editingPecaId = null;
  $('modal-peca-title').textContent = 'Nova Peça em Rastreio';
  $('peca-edit-id').value = '';
  $('peca-numero').value = '';
  $('peca-qty').value = 1;
  $('peca-obs').value = '';
  $('peca-op-atual').value = '01';
  const statusEl = $('peca-status-inicial');
  if (statusEl) statusEl.value = 'em-producao';
  populateModeloSelects();
  $('modal-peca').classList.remove('hidden');
}

function openEditPeca(id) {
  const p = DB.getPecas().find(x => x.id === id);
  if (!p) return;
  STATE.editingPecaId = id;
  $('modal-peca-title').textContent = `Editar Peça – ${p.numero}`;
  $('peca-edit-id').value = id;
  populateModeloSelects();
  $('peca-numero').value        = p.numero;
  $('peca-modelo').value        = p.modelo;
  $('peca-tipo-fundicao').value = p.tipoFundicao;
  $('peca-qty').value           = p.qty;
  $('peca-op-atual').value      = p.operacaoAtual;
  $('peca-obs').value           = p.obs;
  const statusEl = $('peca-status-inicial');
  if (statusEl) statusEl.value = p.status || 'em-producao';
  $('modal-peca').classList.remove('hidden');
}
window.openEditPeca = openEditPeca;

function closeModalPeca() { $('modal-peca').classList.add('hidden'); }

function savePeca() {
  const numero = $('peca-numero').value.trim();
  const modelo = $('peca-modelo').value;
  if (!numero) { showToast('Informe o número/lote da peça.', 'error'); return; }
  if (!modelo) { showToast('Selecione um modelo.', 'error'); return; }
  const statusEl = $('peca-status-inicial');
  const data = {
    modelo,
    tipoFundicao:  $('peca-tipo-fundicao').value,
    qty:           parseInt($('peca-qty').value) || 1,
    operacaoAtual: $('peca-op-atual').value,
    status:        statusEl ? statusEl.value : 'em-producao',
    obs:           $('peca-obs').value.trim(),
  };
  if (STATE.editingPecaId) {
    const orig = DB.getPecas().find(p => p.id === STATE.editingPecaId);
    if (orig && orig.operacaoAtual !== data.operacaoAtual) {
      data.obsMovimento = `Atualizado manualmente para Op. ${data.operacaoAtual}`;
    }
    DB.updatePeca(STATE.editingPecaId, data);
    showToast('Peça atualizada!');
  } else {
    DB.addPeca({ ...data, numero });
    showToast('Peça cadastrada no rastreio!');
  }
  closeModalPeca();
  renderFluxo();
}

function avancarOp(id) {
  const p = DB.getPecas().find(x => x.id === id);
  if (!p) return;
  const idx = OPERACOES.findIndex(o => o.codigo === p.operacaoAtual);
  if (idx < 0 || idx >= OPERACOES.length - 1) return;
  const proxOp = OPERACOES[idx + 1];
  DB.updatePeca(id, {
    operacaoAtual: proxOp.codigo,
    obsMovimento: `Avançado para Op. ${proxOp.codigo} – ${proxOp.nome}`,
  });
  showToast(`✅ Peça avançada → ${proxOp.codigo} – ${proxOp.nome}`);
  renderFluxo();
}
window.avancarOp = avancarOp;

function deletePeca(id) {
  if (!confirm('Excluir esta peça do rastreio?')) return;
  DB.deletePeca(id);
  renderFluxo();
  showToast('Peça removida.', 'error');
}
window.deletePeca = deletePeca;

// ═══════════════════════════════════════════
// EXPEDIÇÃO / VENDAS
// ═══════════════════════════════════════════
function renderExpedicao() {
  const search = ($('expedicao-search')?.value || '').toLowerCase();
  const allPedidos = DB.getPedidos();

  // Filtered list
  let list = allPedidos;
  if (search) {
    list = list.filter(p => 
      (p.cliente || '').toLowerCase().includes(search) || 
      (p.modelo || '').toLowerCase().includes(search)
    );
  }

  // Calculate KPIs
  const totalItens = allPedidos.reduce((sum, p) => sum + (parseInt(p.qty) || 0), 0);
  const mediaVendas = 0.00; // Left at zero as requested
  const totalPedidos = allPedidos.length;

  const elItens = $('ekpi-total-itens');
  if (elItens) elItens.textContent = totalItens;
  const elMedia = $('ekpi-media-vendas');
  if (elMedia) elMedia.textContent = mediaVendas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const elTotal = $('ekpi-total-pedidos');
  if (elTotal) elTotal.textContent = totalPedidos;

  // Render Resumo por Modelo
  const modelos = DB.getModelos();
  const tbodyModelos = $('expedicao-modelos-body');
  if (tbodyModelos) {
    if (!modelos.length) {
      tbodyModelos.innerHTML = '<tr><td colspan="3" class="empty-cell">Nenhum modelo cadastrado.</td></tr>';
    } else {
      tbodyModelos.innerHTML = modelos.map(m => {
        const totalVendidoModelo = allPedidos
          .filter(p => p.modelo === m.nome)
          .reduce((sum, p) => sum + (parseInt(p.qty) || 0), 0);
        const mediaVendidoModelo = 0.00; // Left at zero as requested
        return `<tr>
          <td style="color:var(--text-primary);font-weight:500">${m.nome}</td>
          <td>${totalVendidoModelo} un</td>
          <td>${mediaVendidoModelo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} un</td>
        </tr>`;
      }).join('');
    }
  }

  // Render Histórico de Vendas
  const tbodyPedidos = $('expedicao-pedidos-body');
  if (tbodyPedidos) {
    if (!list.length) {
      tbodyPedidos.innerHTML = '<tr><td colspan="6" class="empty-cell">Sem vendas registradas.</td></tr>';
    } else {
      tbodyPedidos.innerHTML = list.map(p => {
        return `<tr>
          <td><span style="color:var(--accent-purple);font-weight:700">${p.numero}</span></td>
          <td style="color:var(--text-primary);font-weight:500">${p.cliente || '—'}</td>
          <td>${p.modelo || '—'}</td>
          <td>${p.qty}</td>
          <td>${formatDate(p.criadoEm)}</td>
          <td><div class="td-actions">
            <button class="btn-icon" onclick="openEditVenda('${p.id}')" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon danger" onclick="deleteVenda('${p.id}')" title="Excluir">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div></td>
        </tr>`;
      }).join('');
    }
  }
}

// Modal open/close & save logic for Vendas
function openNovaVenda() {
  STATE.editingVendaId = null;
  $('modal-venda-title').textContent = 'Registrar Venda';
  $('venda-edit-id').value = '';
  $('venda-cliente').value = '';
  $('venda-qty').value = 1;
  $('venda-obs').value = '';
  $('venda-data').value = new Date().toISOString().split('T')[0];
  populateModeloSelects();
  $('modal-venda').classList.remove('hidden');
}
window.openNovaVenda = openNovaVenda;

function openEditVenda(id) {
  const p = DB.getPedidos().find(x => x.id === id);
  if (!p) return;
  STATE.editingVendaId = id;
  $('modal-venda-title').textContent = `Editar Venda – ${p.numero}`;
  $('venda-edit-id').value = id;
  populateModeloSelects();
  $('venda-cliente').value = p.cliente;
  $('venda-modelo').value  = p.modelo;
  $('venda-qty').value      = p.qty;
  $('venda-obs').value      = p.obs;
  $('venda-data').value = (p.prazo || p.criadoEm || '').split('T')[0];
  $('modal-venda').classList.remove('hidden');
}
window.openEditVenda = openEditVenda;

function closeModalVenda() {
  $('modal-venda').classList.add('hidden');
}
window.closeModalVenda = closeModalVenda;

function saveVenda() {
  const cliente = $('venda-cliente').value.trim();
  const modelo = $('venda-modelo').value;
  const qty = parseInt($('venda-qty').value) || 1;
  const dataVenda = $('venda-data').value;
  const obs = $('venda-obs').value.trim();

  if (!cliente) { showToast('Informe o nome do cliente.', 'error'); return; }
  if (!modelo) { showToast('Selecione um modelo.', 'error'); return; }
  if (!dataVenda) { showToast('Selecione a data da venda.', 'error'); return; }

  const data = {
    cliente,
    modelo,
    qty,
    prazo: dataVenda,
    obs,
    status: 'Faturado'
  };

  if (STATE.editingVendaId) {
    DB.updatePedido(STATE.editingVendaId, data);
    showToast('Venda updated!');
  } else {
    DB.addPedido(data);
    showToast('Venda registrada!');
  }

  closeModalVenda();
  renderExpedicao();
}
window.saveVenda = saveVenda;

function deleteVenda(id) {
  if (!confirm('Excluir este registro de venda?')) return;
  DB.deletePedido(id);
  renderExpedicao();
  showToast('Venda removida.', 'error');
}
window.deleteVenda = deleteVenda;

// ═══════════════════════════════════════════
// RELATÓRIOS
// ═══════════════════════════════════════════
function renderRelatorios() {
  const ops = DB.getOps();

  // Chart 1 – Produção por mês (últimos 6 meses)
  const meses = [];
  const counts = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    meses.push(label);
    const mes = d.getMonth(); const ano = d.getFullYear();
    counts.push(ops.filter(o => {
      const c = new Date(o.criadoEm);
      return c.getMonth() === mes && c.getFullYear() === ano;
    }).length);
  }

  const ctx1 = $('rel-mensal-chart').getContext('2d');
  if (STATE.charts.mensal) STATE.charts.mensal.destroy();
  STATE.charts.mensal = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: meses,
      datasets: [{
        label: 'OPs abertas',
        data: counts,
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#60a5fa',
        pointRadius: 4,
        tension: 0.4,
        fill: true,
      }]
    },
    options: chartBaseOptions(),
  });

  // Chart 2 – OPs por status (donut)
  const statusLabels = ETAPAS;
  const statusCounts = ETAPAS.map(e => ops.filter(o => o.etapa === e).length);
  const ctx2 = $('rel-status-chart').getContext('2d');
  if (STATE.charts.status) STATE.charts.status.destroy();
  STATE.charts.status = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: statusLabels,
      datasets: [{
        data: statusCounts,
        backgroundColor: ['#4b5563','#fb923c','#60a5fa','#2dd4bf','#a78bfa','#fb923c','#4ade80'],
        borderColor: '#151e2d',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#8a96a8', font: { family: 'Inter', size: 10 }, boxWidth: 10 } },
        tooltip: tooltipStyle(),
      },
      cutout: '65%',
    }
  });

  // Chart 3 – Top modelos
  const modeloCounts = {};
  ops.forEach(o => { modeloCounts[o.modelo] = (modeloCounts[o.modelo] || 0) + 1; });
  const modeloEntries = Object.entries(modeloCounts).sort((a,b) => b[1]-a[1]).slice(0,5);
  const ctx3 = $('rel-modelos-chart').getContext('2d');
  if (STATE.charts.modelos) STATE.charts.modelos.destroy();
  STATE.charts.modelos = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: modeloEntries.map(e => e[0]),
      datasets: [{
        data: modeloEntries.map(e => e[1]),
        backgroundColor: 'rgba(167,139,250,0.6)',
        borderColor: 'rgba(167,139,250,0.9)',
        borderWidth: 1.5,
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: { ...chartBaseOptions(), indexAxis: 'y' },
  });

  // Tabela de atrasos
  const hoje = new Date();
  const atrasaídas = ops.filter(o => o.etapa !== 'Pronto/Entregue' && new Date(o.prazo) < hoje);
  const tbody = $('rel-atraso-body');
  if (!atrasaídas.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Sem ordens em atraso. 🌱Ž‰</td></tr>';
  } else {
    tbody.innerHTML = atrasaídas.map(o => `<tr>
      <td><span style="color:var(--accent-blue);font-weight:700">${o.numero}</span></td>
      <td>${o.modelo}</td>
      <td style="color:var(--accent-red)">${formatDate(o.prazo)}</td>
      <td><span class="chip chip--red">${diasAtraso(o.prazo)} dias</span></td>
    </tr>`).join('');
  }
}

function chartBaseOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: tooltipStyle() },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8a96a8', font: { family: 'Inter', size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#8a96a8', font: { family: 'Inter', size: 11 }, stepSize: 1 }, beginAtZero: true },
    }
  };
}

function tooltipStyle() {
  return {
    backgroundColor: '#1a2235',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    titleColor: '#e8edf5',
    bodyColor: '#8a96a8',
  };
}

// Export CSV
function exportCSV() {
  const ops = DB.getOps();
  if (!ops.length) { showToast('Sem dados para exportar.', 'error'); return; }
  const header = 'Número,Modelo,Cliente,Quantidade,Etapa,Prioridade,Prazo,Criado em';
  const rows = ops.map(o =>
    `"${o.numero}","${o.modelo}","${o.cliente}","${o.qty}","${o.etapa}","${o.prioridade}","${formatDate(o.prazo)}","${formatDate(o.criadoEm)}"`
  );
  const csv = [header, ...rows].join('\n');
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

  // ── Modal Modelo ──
  $('btn-novo-modelo').addEventListener('click', openNovoModelo);
  $('modal-modelo-close').addEventListener('click', closeModalModelo);
  $('btn-cancel-modelo').addEventListener('click', closeModalModelo);
  $('btn-save-modelo').addEventListener('click', saveModelo);

  // ── Excel Matrix Upload ──
  const btnImportarMatriz = $('btn-importar-matriz');
  const inputMatrizExcel = $('input-matriz-excel');
  if (btnImportarMatriz && inputMatrizExcel) {
    btnImportarMatriz.addEventListener('click', () => {
      inputMatrizExcel.click();
    });
    inputMatrizExcel.addEventListener('change', handleExcelUpload);
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
  $('btn-nova-peca').addEventListener('click', openNovaPeca);
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


