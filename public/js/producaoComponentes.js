/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   producaoComponentes.js  â€“  Gestão de OPs e Entradas Locais
   HR Náutica PCP  |  Módulo de Produção de Componentes
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
'use strict';

// Estado global do módulo de componentes
const PROD_COMP_STATE = {
  ops:            [], // [{ id, sku, descricao, quantidade, dataCriacao, status, etapas: [], etapaAtualIdx: 0 }]
  entradasLocais: [], // [{ id, sku, descricao, quantidade, origem, dataPedido, status: 'Pendente' }]
  loaded:         false
};

// Carrega dados do RemoteStorage
function prodComp_load() {
  try {
    const cachedOps = RemoteStorage.getItem('hrn_prod_comp_ops');
    if (cachedOps) {
      PROD_COMP_STATE.ops = JSON.parse(cachedOps);
    }
    // Remove qualquer cache residual de entradas locais pendentes
    RemoteStorage.removeItem('hrn_prod_comp_entradas');
    PROD_COMP_STATE.entradasLocais = [];
    PROD_COMP_STATE.loaded = true;
  } catch (e) {
    console.error('Erro ao ler dados de producaoComponentes do RemoteStorage', e);
  }
}

// Salva dados no RemoteStorage
function prodComp_save() {
  try {
    RemoteStorage.setItem('hrn_prod_comp_ops', JSON.stringify(PROD_COMP_STATE.ops));
  } catch (e) {
    console.error('Erro ao salvar dados de producaoComponentes no RemoteStorage', e);
  }
}

// Retorna as operações aplicáveis para o SKU com base na árvore de componentes
function prodComp_getSkuSteps(sku) {
  const steps = [];
  const skuUpper = String(sku || '').trim().toUpperCase();

  // Tenta encontrar o item nas linhas brutas da árvore
  if (window.EARV && Array.isArray(window.EARV.rows)) {
    const row = window.EARV.rows.find(r => String(r['SKU'] || '').trim().toUpperCase() === skuUpper);
    if (row && window.OP) {
      Object.entries(window.OP).forEach(([opKey, opConfig]) => {
        const val = String(row[opConfig.col] || '').trim();
        if (val && val !== '-') {
          steps.push(opKey);
        }
      });
    }
  }

  // Fallback: se não achar nenhuma operação configurada ou o item não estiver na árvore,
  // assume que passa por todas as etapas normais da fábrica.
  if (steps.length === 0) {
    return ['op01', 'op02', 'op03', 'op04', 'op05', 'op06'];
  }
  return steps;
}

// Retorna a quantidade acumulada de saldo virtual local (OPs ativas) para um SKU
function prodComp_getSaldoVirtualLocal(sku) {
  sku = String(sku || '').trim().toUpperCase();
  if (!sku) return 0;

  prodComp_load();

  // OPs em andamento ("Em Produção")
  const opsQty = PROD_COMP_STATE.ops
    .filter(op => !op.deleted && op.status === 'Em Produção' && String(op.sku || '').trim().toUpperCase() === sku)
    .reduce((sum, op) => sum + (op.quantidade || 0), 0);

  return opsQty;
}
window.prodComp_getSaldoVirtualLocal = prodComp_getSaldoVirtualLocal;

// Auxiliar para ler as operações configuradas na linha da planilha e setá-las como Pendente ou Não se Aplica
function prodComp_getRowOperacoes(row) {
  const operacoes = {};
  if (window.OP) {
    Object.entries(window.OP).forEach(([opKey, opConfig]) => {
      const val = String(row[opConfig.col] || '').trim();
      if (val && val !== '-') {
        operacoes[opKey] = { label: val, status: 'Pendente' };
      } else {
        operacoes[opKey] = { label: 'â€”', status: 'â€”' };
      }
    });
  } else {
    ['op01', 'op02', 'op03', 'op04', 'op05', 'op06'].forEach(opKey => {
      operacoes[opKey] = { label: 'â€”', status: 'â€”' };
    });
  }
  return operacoes;
}

// Cria uma nova OP de Componente e associa toda a sua árvore de sub-itens e operações
function prodComp_createOP(sku, qty, descOverride) {
  sku = String(sku || '').trim().toUpperCase();
  qty = parseInt(qty) || 0;
  if (!sku || qty <= 0) {
    if (typeof showToast === 'function') showToast('SKU ou quantidade inválida.', 'error');
    return null;
  }

  // Tenta obter a descrição do SKU
  let descricao = descOverride || 'Componente sem descrição';
  if (!descOverride && window.EARV && Array.isArray(window.EARV.rows)) {
    const r = window.EARV.rows.find(row => String(row['SKU'] || '').trim().toUpperCase() === sku);
    if (r && r['Descrição']) {
      descricao = r['Descrição'];
    }
  }

  prodComp_load();

  const id = 'OPC-' + Date.now();
  const dataCriacao = new Date().toLocaleDateString('pt-BR');

  const itens = [];
  let family = null;
  if (window.EARV && Array.isArray(window.EARV.familyTree)) {
    family = window.EARV.familyTree.find(f => String(f.row['SKU'] || '').trim().toUpperCase() === sku);
  }

  if (family) {
    // 1. Nível 00 (Item Final)
    itens.push({
      sku: String(family.row['SKU'] || '').trim().toUpperCase(),
      descricao: String(family.row['Descrição'] || '').trim(),
      nivel: '00',
      quantidadeTree: parseRobustFloat(family.row['Quantidade']) || 1,
      quantidadeTotal: (parseRobustFloat(family.row['Quantidade']) || 1) * qty,
      parentSku: null,
      operacoes: prodComp_getRowOperacoes(family.row)
    });

    // 2. Nível 01 (Componentes)
    family.components.forEach(comp => {
      const compSku = String(comp.row['SKU'] || '').trim().toUpperCase();
      itens.push({
        sku: compSku,
        descricao: String(comp.row['Descrição'] || '').trim(),
        nivel: '01',
        quantidadeTree: parseRobustFloat(comp.row['Quantidade']) || 1,
        quantidadeTotal: (parseRobustFloat(comp.row['Quantidade']) || 1) * qty,
        parentSku: String(family.row['SKU'] || '').trim().toUpperCase(),
        operacoes: prodComp_getRowOperacoes(comp.row)
      });

      // 3. Nível 02 (Materiais do Componente)
      comp.materials.forEach(mat => {
        itens.push({
          sku: String(mat['SKU'] || '').trim().toUpperCase(),
          descricao: String(mat['Descrição'] || '').trim(),
          nivel: '02',
          quantidadeTree: parseRobustFloat(mat['Quantidade']) || 1,
          quantidadeTotal: (parseRobustFloat(mat['Quantidade']) || 1) * qty,
          parentSku: compSku,
          operacoes: prodComp_getRowOperacoes(mat)
        });
      });
    });
  } else {
    // Fallback se o item não for encontrado na árvore
    let rowInRows = null;
    if (window.EARV && Array.isArray(window.EARV.rows)) {
      rowInRows = window.EARV.rows.find(r => String(r['SKU'] || '').trim().toUpperCase() === sku);
    }
    
    itens.push({
      sku: sku,
      descricao: descOverride || (rowInRows ? String(rowInRows['Descrição'] || '').trim() : 'Item sem descrição'),
      nivel: '00',
      quantidadeTree: 1,
      quantidadeTotal: qty,
      parentSku: null,
      operacoes: rowInRows ? prodComp_getRowOperacoes(rowInRows) : {
        op01: { label: 'Compras', status: 'Pendente' },
        op02: { label: 'â€”', status: 'â€”' },
        op03: { label: 'â€”', status: 'â€”' },
        op04: { label: 'â€”', status: 'â€”' },
        op05: { label: 'Montagem', status: 'Pendente' },
        op06: { label: 'Embalagem', status: 'Pendente' }
      }
    });
  }

  const newOp = {
    id,
    sku,
    descricao,
    quantidade: qty,
    dataCriacao,
    status: 'Em Produção', // 'Em Produção' | 'Concluído'
    itens,
    atualizadoEm: Date.now()
  };

  PROD_COMP_STATE.ops.push(newOp);
  prodComp_save();

  if (typeof showToast === 'function') {
    showToast(`âœ… OP de Componente ${id} criada com sucesso!`, 'success');
  }

  prodComp_render();
  if (typeof renderViniTable === 'function') renderViniTable();
  
  return newOp;
}
window.prodComp_createOP = prodComp_createOP;

// Checa recursivamente se um item possui sub-itens pendentes
function prodComp_isItemBlocked(op, item) {
  if (item.nivel === '02') return false; // Nível 02 não tem dependentes

  // Encontra todos os itens filhos deste item na OP
  const filhos = op.itens.filter(child => child.parentSku === item.sku);
  
  for (const filho of filhos) {
    // Checa se o próprio filho tem qualquer operação pendente
    const temPendente = Object.values(filho.operacoes).some(o => o.status === 'Pendente');
    if (temPendente) return true;
    
    // Checa recursivamente se os descendentes desse filho estão bloqueados ou têm pendências
    if (prodComp_isItemBlocked(op, filho)) return true;
  }
  
  return false;
}
window.prodComp_isItemBlocked = prodComp_isItemBlocked;

// Alterna o status de uma operação de item da OP
function prodComp_toggleOpStatus(opId, itemSku, opKey) {
  prodComp_load();
  const op = PROD_COMP_STATE.ops.find(o => o.id === opId);
  if (!op || op.status !== 'Em Produção') return;

  const item = op.itens.find(i => i.sku === itemSku);
  if (!item) return;

  const opInfo = item.operacoes[opKey];
  if (!opInfo || opInfo.status === 'â€”') return;

  if (opInfo.status === 'Pendente') {
    // Verifica bloqueio de sub-itens
    if (prodComp_isItemBlocked(op, item)) {
      if (typeof showToast === 'function') {
        showToast('âš  Bloqueado: conclua primeiro todas as etapas de compras/fabricação dos sub-itens!', 'warning');
      } else {
        alert('Bloqueado: conclua primeiro todas as etapas de compras/fabricação dos sub-itens!');
      }
      return;
    }
    opInfo.status = 'OK';
    if (typeof showToast === 'function') {
      showToast(`âœ… Etapa "${opInfo.label}" de ${item.sku} concluída!`, 'success');
    }
  } else if (opInfo.status === 'OK') {
    // Permite reverter
    opInfo.status = 'Pendente';
    if (typeof showToast === 'function') {
      showToast(`Etapa "${opInfo.label}" de ${item.sku} retornou para Pendente.`, 'info');
    }
  }

  op.atualizadoEm = Date.now();
  prodComp_save();
  prodComp_render();
  if (typeof renderViniTable === 'function') renderViniTable();
}
window.prodComp_toggleOpStatus = prodComp_toggleOpStatus;

// Conclui a Ordem de Produção inteira (muda status para Concluído)
function prodComp_finalizarOP(opId) {
  prodComp_load();
  const op = PROD_COMP_STATE.ops.find(o => o.id === opId);
  if (!op || op.status !== 'Em Produção') return;

  // Verifica se há alguma etapa pendente em qualquer item do conjunto
  const temPendentes = op.itens.some(item => 
    Object.values(item.operacoes).some(o => o.status === 'Pendente')
  );

  if (temPendentes) {
    if (typeof showToast === 'function') {
      showToast('âš  Não é possível concluir a OP: ainda existem operações pendentes no conjunto!', 'warning');
    } else {
      alert('Não é possível concluir a OP: ainda existem operações pendentes no conjunto!');
    }
    return;
  }

  if (!confirm('Deseja realmente finalizar esta Ordem de Produção de Componente?')) return;

  op.status = 'Concluído';
  op.atualizadoEm = Date.now();
  prodComp_save();

  if (typeof showToast === 'function') {
    showToast(`ðŸŽ‰ OP de Componente ${op.id} concluída com sucesso!`, 'success');
  }

  prodComp_render();
  if (typeof renderViniTable === 'function') renderViniTable();
}
window.prodComp_finalizarOP = prodComp_finalizarOP;

// Exclui/Cancela uma OP de Componente
function prodComp_deleteOP(id) {
  if (!confirm('Deseja realmente cancelar esta Ordem de Produção de Componente?')) return;

  prodComp_load();
  const op = PROD_COMP_STATE.ops.find(o => o.id === id);
  if (op) {
    op.deleted = true;
    op.atualizadoEm = Date.now();
  }
  prodComp_save();
  
  if (typeof showToast === 'function') showToast('OP cancelada.', 'info');
  
  prodComp_render();
  if (typeof renderViniTable === 'function') renderViniTable();
}
window.prodComp_deleteOP = prodComp_deleteOP;

// Renderiza a tabela de OPs de componentes
// Funções utilitárias locais de leitura robusta do RemoteStorage
function safeGetJSON(key, defaultVal) {
  try {
    const val = RemoteStorage.getItem(key);
    if (!val || val === 'undefined' || val === 'null') return defaultVal;
    const parsed = JSON.parse(val);
    return parsed !== null && parsed !== undefined ? parsed : defaultVal;
  } catch (e) {
    console.warn(`Erro ao ler ${key} do RemoteStorage, resetando.`, e);
    return defaultVal;
  }
}

// Função utilitária local para formatação robusta de números
function prodComp_fmtNum(val) {
  if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === 'â€”') return 'â€”';
  let cleanVal = val;
  if (typeof val === 'string' && val.includes(',')) {
    cleanVal = val.replace(/\./g, '').replace(',', '.');
  }
  const num = Number(cleanVal);
  if (isNaN(num)) return String(val);
  if (num % 1 === 0) return String(num);
  return num.toFixed(1).replace('.', ',');
}

// Renderiza a tabela de OPs de componentes
function prodComp_render() {
  const tbody = document.getElementById('producao-componentes-body');
  const countBadge = document.getElementById('producao-componentes-count');
  if (!tbody) return;

  prodComp_load();

  const search = (document.getElementById('prod-comp-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('prod-comp-filter-status')?.value || 'all';

  let filtered = PROD_COMP_STATE.ops.filter(o => !o.deleted);

  // Filtro de status
  if (statusFilter !== 'all') {
    filtered = filtered.filter(op => op.status === statusFilter);
  }

  // Filtro de busca
  if (search) {
    filtered = filtered.filter(op => 
      op.id.toLowerCase().includes(search) ||
      op.sku.toLowerCase().includes(search) ||
      op.descricao.toLowerCase().includes(search) ||
      (op.itens && op.itens.some(item => 
        item.sku.toLowerCase().includes(search) || 
        item.descricao.toLowerCase().includes(search)
      ))
    );
  }

  // Inverte a ordem para mostrar as mais recentes no topo
  filtered = [...filtered].reverse();

  if (countBadge) {
    countBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'OP' : 'OPs'}`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-cell">Nenhuma ordem de produção de componente ativa.</td></tr>';
    return;
  }

  // Carrega tabelas de suporte para a renderização do conjunto (estoque)
  const estoqueMap = safeGetJSON('hrn_earv_estoque', {});

  // â”€â”€ Reserva de estoque por SKU entre OPs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Acumula o quanto de cada SKU já foi "consumido" pelas OPs processadas.
  // OPs são percorridas na ordem da tela (filtered já está ordenado).
  // Apenas componentes (nivel != '00') participam da reserva.
  const reservadoPorSku = {}; // { [sku]: quantidade já reservada pelas OPs anteriores }

  const rowsHtmlArray = [];

  filtered.forEach(op => {
    // Cabeçalho da OP
    const isOPConcluida = op.status === 'Concluído';
    const statusText = isOPConcluida 
      ? `<span class="earv-op-badge earv-op-badge--op06" style="padding: 0.25rem 0.6rem; font-weight: 700;">âœ“ CONCLUÍDA</span>`
      : `<span class="earv-op-badge earv-op-badge--op02" style="padding: 0.25rem 0.6rem; font-weight: 700;">âš™ EM PRODUÃ‡ÃƒO</span>`;

    let actionsHtml = '';
    if (!isOPConcluida) {
      // Verifica se todas as operações estão OK para habilitar ou estilizar o botão de finalizar
      const temPendentes = op.itens.some(item => 
        Object.values(item.operacoes).some(o => o.status === 'Pendente')
      );
      const btnClass = temPendentes ? 'earv-btn--outline' : 'earv-btn--primary';
      const btnStyle = temPendentes ? 'opacity: 0.5; cursor: not-allowed;' : '';
      
      actionsHtml = `
        <button class="earv-btn ${btnClass} earv-btn--sm" onclick="prodComp_finalizarOP('${op.id}')" style="margin-right: 0.5rem; padding: 0.35rem 0.75rem; font-size: 0.76rem; font-weight: 700; ${btnStyle}">
          ðŸ Finalizar OP
        </button>
        <button class="earv-btn earv-btn--outline earv-btn--sm" onclick="prodComp_deleteOP('${op.id}')" style="padding: 0.35rem 0.75rem; font-size: 0.76rem; font-weight: 700; border-color: var(--accent-red); color: var(--accent-red);">
          Cancelar
        </button>
      `;
    } else {
      actionsHtml = `<span style="color: var(--accent-green); font-size: 0.85rem; font-weight: 700; margin-right: 10px;">âœ“ Concluída e Integrada</span>`;
    }

    rowsHtmlArray.push(`
      <tr class="op-header-row" style="background-color: var(--bg-card); font-weight: 600; border-left: 4px solid ${isOPConcluida ? 'var(--accent-green)' : 'var(--accent-blue)'};">
        <td colspan="6" style="text-align: left; padding: 0.75rem 1rem;">
          <span style="font-weight: 800; color: var(--accent-blue); font-size: 0.95rem;">${op.id}</span>
          <span style="margin: 0 8px; color: var(--text-muted);">|</span>
          <span style="color: var(--text-primary); font-weight: 700;">${op.descricao}</span>
          <span style="margin: 0 8px; color: var(--text-muted);">|</span>
          Qtd: <strong style="color: var(--accent-orange); font-size: 0.95rem;">${op.quantidade}</strong>
          <span style="margin: 0 8px; color: var(--text-muted);">|</span>
          Data: <span style="font-size: 0.82rem; color: var(--text-secondary);">${op.dataCriacao}</span>
          <span style="margin: 0 12px;"></span>
          ${statusText}
        </td>
        <td colspan="6" style="text-align: right; padding: 0.75rem 1rem; white-space: nowrap;">
          ${actionsHtml}
        </td>
      </tr>
    `);

    // Linhas de itens e sub-itens da OP
    op.itens.forEach(item => {
      const isConcluido = isOPConcluida;
      const skuNorm = item.sku;
      const estFisico = (estoqueMap[skuNorm] !== undefined && estoqueMap[skuNorm] !== null)
        ? estoqueMap[skuNorm] : 0;

      // â”€â”€ Estoque disponível com reserva progressiva â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Para item final (nivel 00): usa o estoque físico direto (ele é produzido, não consumido)
      // Para componentes (nivel 01/02): desconta o que OPs anteriores já reservaram
      let est;
      let reservadoNessaLinha = 0;

      if (item.nivel === '00') {
        est = estFisico; // Item final: estoque físico sem desconto
      } else {
        const jaReservado = reservadoPorSku[skuNorm] || 0;
        est = Math.max(0, estFisico - jaReservado); // Estoque disponível após reservas anteriores
        // Quanto esta linha vai reservar: o mínimo entre o que precisa e o que há disponível
        reservadoNessaLinha = Math.min(item.quantidadeTotal, est);
      }

      // Estilo da coluna Estoque
      let stockHtml = '';
      if (item.nivel === '00') {
        // Item final â€” exibe estoque atual sem indicador de insuficiência
        if (est <= 0) {
          stockHtml = `<span class="earv-stock earv-stock--zero" title="Nenhuma unidade em estoque atualmente">0</span>`;
        } else {
          stockHtml = `<span class="earv-stock earv-stock--ok" title="Estoque atual antes da produção">${prodComp_fmtNum(est)}</span>`;
        }
      } else {
        // Componentes â€” mostra estoque disponível real (após reserva de OPs anteriores)
        const tooltip = estFisico !== est
          ? `Estoque físico: ${prodComp_fmtNum(estFisico)} | Já reservado por OPs anteriores: ${prodComp_fmtNum(reservadoPorSku[skuNorm] || 0)} | Disponível: ${prodComp_fmtNum(est)}`
          : '';
        if (est <= 0) {
          stockHtml = `<span class="earv-stock earv-stock--zero" title="${tooltip || 'Sem estoque disponível'}">0</span>`;
        } else if (est < item.quantidadeTotal) {
          stockHtml = `<span class="earv-stock earv-stock--zero" title="${tooltip || `Estoque insuficiente (${est} < ${item.quantidadeTotal})`}">${prodComp_fmtNum(est)}</span>`;
        } else {
          stockHtml = `<span class="earv-stock earv-stock--ok" title="${tooltip}">${prodComp_fmtNum(est)}</span>`;
        }
      }

      // Saldo após a operação:
      // - Nível 00 (item final): a OP PRODUZ â†’ saldo = estoque físico + quantidade produzida
      // - Nível 01/02 (componentes): CONSUMIDOS â†’ saldo = estoque disponível âˆ’ quantidade necessária
      const saldo = item.nivel === '00'
        ? estFisico + item.quantidadeTotal  // Produção soma ao estoque físico
        : est - item.quantidadeTotal;       // Consumo subtrai do estoque disponível real

      let saldoHtml = '';
      if (item.nivel === '00') {
        const saldoLabel = estFisico > 0
          ? `Estoque atual (${prodComp_fmtNum(estFisico)}) + Produção (${prodComp_fmtNum(item.quantidadeTotal)})`
          : `Resultado da produção`;
        saldoHtml = `<span style="font-weight: 700; color: var(--accent-green);" title="${saldoLabel}">+${prodComp_fmtNum(saldo)}</span>`;
      } else if (saldo < 0) {
        saldoHtml = `<span style="font-weight: 700; color: var(--accent-red);">${prodComp_fmtNum(saldo)}</span>`;
      } else {
        saldoHtml = `<span style="font-weight: 700; color: var(--accent-green);">+${prodComp_fmtNum(saldo)}</span>`;
      }

      // Atualiza a reserva acumulada do SKU APÃ“S calcular esta linha
      if (item.nivel !== '00' && reservadoNessaLinha > 0) {
        reservadoPorSku[skuNorm] = (reservadoPorSku[skuNorm] || 0) + reservadoNessaLinha;
      }

      // Renderiza as 6 colunas de operações com nome do responsável
      let opsColsHtml = '';
      ['op01', 'op02', 'op03', 'op04', 'op05', 'op06'].forEach(opKey => {
        const opInfo = item.operacoes[opKey];
        // Label da planilha: é o nome do responsável (ex: "Alberto")
        const opLabel = window.OP && window.OP[opKey] ? window.OP[opKey].label : opKey.toUpperCase();
        const responsavel = (!opInfo || opInfo.status === 'â€”') ? null : (opInfo.label && opInfo.label !== 'â€”' ? opInfo.label : null);

        if (!opInfo || opInfo.status === 'â€”') {
          opsColsHtml += `<td class="earv-td"><span class="earv-dash">â€”</span></td>`;
        } else if (opInfo.status === 'OK') {
          const clickAction = isConcluido ? '' : `onclick="prodComp_toggleOpStatus('${op.id}', '${item.sku}', '${opKey}')"`;
          const cursorStyle = isConcluido ? 'cursor: default;' : 'cursor: pointer;';
          opsColsHtml += `
            <td class="earv-td" style="padding: 4px !important; text-align: center;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${opLabel}</span>
                <button class="earv-op-btn op-btn--ok" style="${cursorStyle};width:100%;" ${clickAction} title="Clique para reverter">âœ“ OK${responsavel ? ` Â· ${responsavel}` : ''}</button>
              </div>
            </td>
          `;
        } else {
          // Status 'Pendente'
          if (isConcluido) {
            opsColsHtml += `
              <td class="earv-td" style="padding: 4px !important; text-align: center;">
                <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                  <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${opLabel}</span>
                  <button class="earv-op-btn op-btn--pendente op-btn--${opKey} op-btn--blocked" style="cursor:default;width:100%;" onclick="event.stopPropagation()">
                    ${responsavel ? `<span style="font-weight:700;">${responsavel}</span>` : opLabel}
                  </button>
                </div>
              </td>
            `;
          } else {
            const isBlocked = prodComp_isItemBlocked(op, item);
            if (isBlocked) {
              opsColsHtml += `
                <td class="earv-td" style="padding: 4px !important; text-align: center;">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                    <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${opLabel}</span>
                    <button class="earv-op-btn op-btn--pendente op-btn--${opKey} op-btn--blocked" title="Bloqueado: conclua os sub-itens primeiro" onclick="event.stopPropagation()" style="width:100%;">
                      ðŸ”’ ${responsavel ? `<span style="font-weight:700;">${responsavel}</span>` : opLabel}
                    </button>
                  </div>
                </td>
              `;
            } else {
              // Ativo e clicável: mostra nome do responsável em destaque
              // EXCEÃ‡ÃƒO: se é OP de Compras (op01) e o estoque cobre a necessidade, mostra badge informativa
              const escapedOpId = op.id.replace(/'/g, "\\'");
              const escapedSku  = item.sku.replace(/'/g, "\\'");

              const isComprasOp = (opKey === 'op01');
              const estoqueCobreNecessidade = saldo >= 0;

              if (isComprasOp && estoqueCobreNecessidade) {
                // Estoque suficiente: não precisa comprar â€” badge informativa verde
                const saldoFormatado = prodComp_fmtNum(saldo);
                opsColsHtml += `
                  <td class="earv-td" style="padding: 4px !important; text-align: center;">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                      <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${opLabel}</span>
                      <span class="op-btn--em-estoque" title="Estoque suficiente â€” saldo pós-consumo: +${saldoFormatado}">
                        <span style="display:block;font-size:0.78rem;font-weight:800;line-height:1.2;">âœ“ Em estoque</span>
                        <span style="display:block;font-size:0.63rem;opacity:0.8;line-height:1;">saldo: +${saldoFormatado}</span>
                      </span>
                    </div>
                  </td>
                `;
              } else {
                // Precisa comprar (ou outra operação): mostra botão clicável do responsável
                opsColsHtml += `
                  <td class="earv-td" style="padding: 4px !important; text-align: center;">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                      <span style="font-size:0.68rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${opLabel}</span>
                      <button class="earv-op-btn op-btn--pendente op-btn--${opKey} op-btn--resp-btn" 
                        onclick="prodComp_toggleOpStatus('${escapedOpId}', '${escapedSku}', '${opKey}')"
                        title="Clique para confirmar OK â€” ${responsavel || opLabel}"
                        style="width:100%; position:relative; overflow:hidden;">
                        <span class="op-resp-name" style="display:block;font-size:0.82rem;font-weight:700;color:inherit;line-height:1.2;">${responsavel || 'â€“'}</span>
                        <span class="op-resp-hint" style="display:block;font-size:0.65rem;opacity:0.7;line-height:1;">toque para OK</span>
                      </button>
                    </div>
                  </td>
                `;
              }
            }
          }
        }
      });

      // Recuos e setinhas com base no nível
      let descHtml = '';
      let rowClass = '';
      if (item.nivel === '00') {
        rowClass = 'earv-row-00';
        descHtml = `
          <div class="earv-desc-wrap">
            <span class="earv-toggle-btn earv-toggle-invisible">â–¶</span>
            <span class="earv-desc-text earv-desc--00">${item.descricao}</span>
          </div>
        `;
      } else if (item.nivel === '01') {
        rowClass = 'earv-row-01';
        descHtml = `
          <div class="earv-desc-wrap earv-indent-01">
            <span class="earv-arrow">â†³</span>
            <span class="earv-desc-text earv-desc--01">${item.descricao}</span>
          </div>
        `;
      } else if (item.nivel === '02') {
        rowClass = 'earv-row-02';
        descHtml = `
          <div class="earv-desc-wrap earv-indent-02">
            <span class="earv-arrow earv-arrow--muted">â†³</span>
            <span class="earv-desc-text earv-desc--02">${item.descricao}</span>
          </div>
        `;
      }

      const levelBadge = item.nivel === '00' 
        ? '<span class="earv-nivel-badge earv-nivel--00">Item Final</span>'
        : item.nivel === '01'
          ? '<span class="earv-nivel-badge earv-nivel--01">Componente</span>'
          : '<span class="earv-nivel-badge earv-nivel--02">Material</span>';

      rowsHtmlArray.push(`
        <tr class="${rowClass}" style="background-color: transparent;">
          <td class="earv-td earv-td--desc">${descHtml}</td>
          <td class="earv-td earv-td--sku ${item.nivel === '00' ? 'earv-sku--00' : item.nivel === '01' ? 'earv-sku--01' : 'earv-sku--02'}">${item.sku}</td>
          <td class="earv-td">${levelBadge}</td>
          <td class="earv-td earv-td--num" style="font-weight: 700; color: var(--accent-orange);">${prodComp_fmtNum(item.quantidadeTotal)}</td>
          <td class="earv-td earv-td--estoque">${stockHtml}</td>
          <td class="earv-td earv-td--estoque" style="text-align: center;">${saldoHtml}</td>
          ${opsColsHtml}
        </tr>
      `);
    });
  });

  tbody.innerHTML = rowsHtmlArray.join('');
}
window.prodComp_render = prodComp_render;

// Exporta tarefas das OPs ativas â€” formato por Kit â†’ por OP (01â†’06)
function prodComp_exportTarefas() {
  prodComp_load();

  const activeOps = PROD_COMP_STATE.ops.filter(op => !op.deleted && op.status === 'Em Produção');
  if (activeOps.length === 0) {
    if (typeof showToast === 'function') showToast('Não existem OPs ativas em produção para exportar tarefas.', 'error');
    else alert('Não existem OPs ativas em produção para exportar tarefas.');
    return;
  }

  const estoqueMap = safeGetJSON('hrn_earv_estoque', {});

  // Mapa para consolidar compras do mesmo SKU em múltiplas OPs
  // { sku: { descricao, responsavel, totalQty, ordens: [{ opId, qty }] } }
  const comprasConsolidado = {};

  const opKeys = ['op01', 'op02', 'op03', 'op04', 'op05', 'op06'];

  const verbos = {
    op01: 'Comprar',
    op02: 'Usinar',
    op03: 'Cromar',
    op04: 'Pintar',
    op05: 'Montar',
    op06: 'Embalar'
  };

  const dataGeracao = new Date().toLocaleDateString('pt-BR') +
    ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let txt = '';
  txt += `============================================================\n`;
  txt += `   HR NÃUTICA PCP  â€“  RELATÃ“RIO DE TAREFAS\n`;
  txt += `============================================================\n`;
  txt += `Gerado em: ${dataGeracao}\n`;
  txt += `Total de OPs em produção: ${activeOps.length}\n`;
  txt += `\n`;

  // Reserva progressiva de estoque (mesma lógica da tela)
  const reservadoPorSkuExport = {};

  activeOps.forEach(op => {
    const itemFinal = op.itens.find(i => i.nivel === '00');
    const componentes = op.itens.filter(i => i.nivel !== '00');
    const skuKit = itemFinal ? itemFinal.sku : op.sku;

    txt += `------------------------------------------------------------\n`;
    txt += `Kit ${skuKit}  (${op.id} | ${op.dataCriacao}) â€“ Qtd: ${op.quantidade}\n`;
    txt += `------------------------------------------------------------\n`;

    opKeys.forEach(opKey => {
      const opLabel = window.OP && window.OP[opKey] ? window.OP[opKey].label : opKey.toUpperCase();
      const opNum   = opKey.replace('op', '').padStart(2, '0');
      const verbo   = verbos[opKey] || 'Realizar';

      // Coleta as linhas de tarefa para esta OP
      const linhas = [];

      if (opKey === 'op01') {
        // Compras: apenas componentes com saldo NEGATIVO (falta estoque)
        componentes.forEach(item => {
          const opInfo = item.operacoes[opKey];
          if (!opInfo || opInfo.status === 'â€”') return;

          const estFisico = estoqueMap[item.sku] ?? 0;
          const jaReservado = reservadoPorSkuExport[item.sku] || 0;
          const estDisponivel = Math.max(0, estFisico - jaReservado);
          const saldo = estDisponivel - item.quantidadeTotal;

          // Atualiza reserva independente do saldo (reserva o que há disponível)
          const reservadoAqui = Math.min(item.quantidadeTotal, estDisponivel);
          reservadoPorSkuExport[item.sku] = jaReservado + reservadoAqui;

          if (saldo >= 0) return; // Estoque suficiente â€” não precisa comprar

          const responsavel = (opInfo.label && opInfo.label !== 'â€”') ? opInfo.label : opLabel;
          const qtyComprar  = Math.abs(saldo);

          linhas.push({ responsavel, sku: item.sku, qty: qtyComprar });

          // Registra para consolidação posterior
          if (!comprasConsolidado[item.sku]) {
            comprasConsolidado[item.sku] = {
              descricao: item.descricao,
              responsavel,
              totalQty: 0,
              ordens: []
            };
          }
          comprasConsolidado[item.sku].totalQty += qtyComprar;
          comprasConsolidado[item.sku].ordens.push({ opId: op.id, qty: qtyComprar });
        });
      } else {
        // Demais operações: checar item final (op05, op06) e componentes (op02, op03, op04)
        const candidatos = ['op05', 'op06'].includes(opKey)
          ? [itemFinal].filter(Boolean)                      // Montagem/Embalagem â†’ só item final
          : componentes;                                     // Usinagem/Cromo/Pintura â†’ componentes

        candidatos.forEach(item => {
          const opInfo = item.operacoes[opKey];
          if (!opInfo || opInfo.status === 'â€”') return;

          const responsavel = (opInfo.label && opInfo.label !== 'â€”') ? opInfo.label : opLabel;
          linhas.push({ responsavel, sku: item.sku, qty: item.quantidadeTotal });
        });
      }

      if (linhas.length === 0) {
        // Nenhuma tarefa nesta OP
        txt += `OP ${opNum}: â€”\n`;
      } else {
        // Agrupa por responsável (pode haver mais de um por OP)
        const porResp = {};
        linhas.forEach(l => {
          if (!porResp[l.responsavel]) porResp[l.responsavel] = [];
          porResp[l.responsavel].push(l);
        });

        Object.entries(porResp).forEach(([resp, itens]) => {
          txt += `OP ${opNum}: ${resp}\n`;
          itens.forEach(l => {
            txt += `${verbo}: ${l.qty} ${l.sku}\n`;
          });
        });
      }

      txt += `\n`;
    });
  });

  // â”€â”€ Seção de Consolidação â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Mostra SKUs de compra que aparecem em mais de uma ordem de produção
  const skusMultiplosOps = Object.entries(comprasConsolidado)
    .filter(([, v]) => v.ordens.length > 1);

  if (skusMultiplosOps.length > 0) {
    txt += `============================================================\n`;
    txt += `COMPRAS CONSOLIDADAS (mesmo item em múltiplas ordens)\n`;
    txt += `============================================================\n`;
    skusMultiplosOps.forEach(([sku, data]) => {
      txt += `${sku}  â€“  ${data.descricao}\n`;
      txt += `  Responsável: ${data.responsavel}\n`;
      txt += `  Total a comprar: ${data.totalQty} un\n`;
      data.ordens.forEach(o => {
        txt += `    â€¢ ${o.opId}: ${o.qty} un\n`;
      });
      txt += `\n`;
    });
  }

  txt += `============================================================\n`;
  txt += `Fim do relatório\n`;

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Tarefas_PCP_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.txt`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof showToast === 'function') showToast('âœ… Relatório de tarefas exportado!', 'success');
}
window.prodComp_exportTarefas = prodComp_exportTarefas;

// Inicializa eventos da nova aba
function prodComp_initEvents() {
  document.getElementById('prod-comp-search')?.addEventListener('input', prodComp_render);
  document.getElementById('prod-comp-filter-status')?.addEventListener('change', prodComp_render);
  document.getElementById('btn-prod-comp-export')?.addEventListener('click', prodComp_exportTarefas);

  // Evento para abrir o modal a partir do botão e salvar nova OP
  const modal = document.getElementById('modal-criar-op-componente');
  const closeBtn = document.getElementById('btn-close-modal-op-comp');
  const cancelBtn = document.getElementById('btn-cancel-op-comp');
  const saveBtn = document.getElementById('btn-save-op-comp');

  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const sku = document.getElementById('op-comp-sku').value;
      const desc = document.getElementById('op-comp-desc').value;
      const qty = parseInt(document.getElementById('op-comp-qty').value) || 0;

      if (!sku || qty <= 0) {
        alert('Por favor, preencha o SKU e uma quantidade válida maior que zero.');
        return;
      }

      prodComp_createOP(sku, qty, desc);
      modal.classList.add('hidden');
    });
  }
}

// Expõe a função de abrir o modal de criação de OP para componentes globalmente
function prodComp_openCreateModal(sku, suggestedQty, desc) {
  const modal = document.getElementById('modal-criar-op-componente');
  if (!modal) return;

  document.getElementById('op-comp-sku').value = sku || '';
  document.getElementById('op-comp-desc').value = desc || '';
  document.getElementById('op-comp-qty').value = suggestedQty || 10; // Padrão múltiplo ou sugestão

  modal.classList.remove('hidden');
}
window.prodComp_openCreateModal = prodComp_openCreateModal;

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  prodComp_load();
  prodComp_initEvents();
  // Se a aba estiver ativa na inicialização, renderiza
  if (document.getElementById('page-producao-componentes') && !document.getElementById('page-producao-componentes').classList.contains('hidden')) {
    prodComp_render();
  }
});

