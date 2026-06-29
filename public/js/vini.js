/* ═══════════════════════════════════════════
   vini.js – Módulo V.I.N.I & Entradas Previstas
   HR Náutica PCP – Refatorado com Kanban e Inativação
   ═══════════════════════════════════════════ */

'use strict';

// Funções utilitárias de segurança para ler e fazer o parse do RemoteStorage de forma robusta
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

function safeGetSet(key) {
  try {
    const val = RemoteStorage.getItem(key);
    if (!val || val === 'undefined' || val === 'null') return new Set();
    const parsed = JSON.parse(val);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.warn(`Erro ao ler ${key} do RemoteStorage, resetando.`, e);
    return new Set();
  }
}

function escapeJSString(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

const VINI_STATE = {
  necessidadeData: safeGetJSON('hrn_vini_necessidades', []),
  entradasPrevistasData: safeGetJSON('hrn_vini_entradas', []),
  inativados: safeGetSet('hrn_vini_inativados'),
  fornecedoresMap: safeGetJSON('hrn_vini_fornecedores_map', {}),
  selectedFornecedor: 'all',
  fabriData: safeGetJSON('hrn_vini_fabri_data', {}),
  expandedItems: safeGetSet('hrn_vini_expanded_items'),
  expandedComponents: safeGetSet('hrn_vini_expanded_comps'),
  materiaisUsuario: safeGetJSON('hrn_vini_materiais_usuario', {}),
  coberturaAlvo: 3,
  loaded: !!RemoteStorage.getItem('hrn_vini_necessidades'),
  viewType: 'table', // consolidado apenas em formato de tabela
  filterType: 'all', // 'all' | 'critical' | 'warning' | 'ok' | 'noDemand' | 'inactive' (usados na Tabela)
  prio2Filter: 'all', // 'all' | 'has-prio' | 'no-prio' | valor numérico
  sortColumn: 'produto',
  sortDirection: 'asc'
};

// Função de debounce para evitar lag na digitação/ajuste de sliders
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Formata números para exibir até uma casa decimal com vírgula
function fmtNum(val) {
  if (val === null || val === undefined || String(val).trim() === '' || String(val).trim() === '—') return '—';
  let cleanVal = val;
  if (typeof val === 'string' && val.includes(',')) {
    cleanVal = val.replace(/\./g, '').replace(',', '.');
  }
  const num = Number(cleanVal);
  if (isNaN(num)) return String(val);
  if (num % 1 === 0) return String(num);
  return num.toFixed(1).replace('.', ',');
}

// Formata cobertura em meses
function fmtCob(valor) {
  if (!isFinite(valor) || valor === Infinity || valor === null || valor === undefined) return 'Sem Giro';
  const formatado = Number(valor).toFixed(1).replace('.', ',');
  const isOne = Number(valor).toFixed(1) === '1,0' || Number(valor).toFixed(1) === '1.0';
  return `${formatado} ${isOne ? 'mês' : 'meses'}`;
}

// Verifica se o SKU é válido para ser exibido na aba VINI (Opção B - Remove apenas HR MP 088)
function isSkuValidoVini(sku) {
  if (!sku) return false;
  const skuNorm = String(sku).trim().toUpperCase();
  if (skuNorm === 'HR MP 088') {
    return false;
  }
  return true;
}

// Obtém status do item com base na cobertura virtual calculada e meta de cobertura
function getItemStatus(item) {
  // 1. Média mensal igual a 0 = Sem Giro
  if (Number(item.mediaMensal) === 0) {
    return 'semGiro';
  }

  // Usamos a cobertura virtual recalculada localmente no JavaScript, com fallback para o prio2 original
  let cob = item.coberturaVirtual;
  if (cob === undefined || cob === null || isNaN(Number(cob))) {
    cob = item.prio2 !== '—' && item.prio2 !== '' ? Number(item.prio2) : NaN;
  }

  // Se a cobertura for inválida, consideramos como Seguro
  if (isNaN(cob)) {
    return 'seguro';
  }

  const limiteCritico = VINI_STATE.coberturaAlvo / 3;

  // 2. Classificação baseada no limite crítico dinâmico em relação à meta de cobertura
  if (cob <= limiteCritico) {
    return 'critico';
  } else if (cob > limiteCritico && cob <= VINI_STATE.coberturaAlvo) {
    return 'atencao';
  } else {
    return 'seguro';
  }
}

// Converte datas do Excel (número de dias desde 1900) para pt-BR
function excelDateToDateStr(excelDate) {
  if (!excelDate) return '—';
  if (typeof excelDate === 'string') return excelDate;
  if (!isNaN(excelDate)) {
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toLocaleDateString('pt-BR');
  }
  return excelDate;
}

// Inativa um item pelo SKU
function inativarSku(sku) {
  if (!sku) return;
  VINI_STATE.inativados.add(sku);
  RemoteStorage.setItem('hrn_vini_inativados', JSON.stringify(Array.from(VINI_STATE.inativados)));
  showToast(`SKU ${sku} inativado. Ele foi ocultado da lista ativa.`, 'info');
  renderViniTable();
}
window.inativarSku = inativarSku;

// Reativa um item pelo SKU
function reativarSku(sku) {
  if (!sku) return;
  VINI_STATE.inativados.delete(sku);
  RemoteStorage.setItem('hrn_vini_inativados', JSON.stringify(Array.from(VINI_STATE.inativados)));
  showToast(`SKU ${sku} reativado e inserido de volta no planejamento.`, 'success');
  renderViniTable();
}
window.reativarSku = reativarSku;

// Processa dados do Excel de Fornecedores e extrai os vínculos de SKU com Fornecedor Padrão
function processFornecedoresExcel(arrayBuffer) {
  try {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const map = {};
    rows.forEach(row => {
      const skuKey = Object.keys(row).find(k => k.toUpperCase().includes('SKU') || k.toUpperCase() === 'CÓDIGO' || k.toUpperCase() === 'CODIGO');
      const fornKey = Object.keys(row).find(k => k.toUpperCase().includes('FORNECEDOR') || k.toUpperCase() === 'RESPONSÁVEL' || k.toUpperCase() === 'RESPONSAVEL');

      const sku = skuKey ? String(row[skuKey]).trim().toUpperCase() : '';
      const forn = fornKey ? String(row[fornKey]).trim().toUpperCase() : '';

      if (sku && forn) {
        map[sku] = forn;
      }
    });

    VINI_STATE.fornecedoresMap = map;
    RemoteStorage.setItem('hrn_vini_fornecedores_map', JSON.stringify(map));
    return true;
  } catch (err) {
    console.error('Erro ao processar planilha de fornecedores:', err);
    throw err;
  }
}

// Processa dados do Excel fabri1.xlsx de fabricação e monta o mapa de sub-itens e sub-sub-itens
// Lê TODAS as abas do arquivo e mescla os resultados num único mapa.
function processFabriExcel(arrayBuffer) {
  try {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const map = {};

    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows || rows.length === 0) return;

      // Detecta as colunas usando as chaves da primeira linha com dados
      const firstRow = rows[0];
      const colKeys = Object.keys(firstRow);

      const skuKitKey = colKeys.find(k => k.toUpperCase().includes('SKU KIT') || k.toUpperCase().includes('SKU FABRICADO') || k.toUpperCase() === 'SKU KIT/FABRICADO');
      const descKitKey = colKeys.find(k => k.toUpperCase().includes('DESCRIÇÃO KIT') || k.toUpperCase().includes('DESCRIÇÃO FABRICADO') || k.toUpperCase() === 'DESCRIÇÃO KIT/FABRICADO');
      const skuCompKey = colKeys.find(k => k.toUpperCase().includes('SKU COMPONENTE') || k.toUpperCase() === 'SKU COMPONENTE');
      const descCompKey = colKeys.find(k => k.toUpperCase().includes('DESCRIÇÃO COMPONENTE') || k.toUpperCase() === 'DESCRIÇÃO COMPONENTE');
      const fornCompKey = colKeys.find(k => k.toUpperCase().includes('FORNECEDOR COMPONENTE') || k.toUpperCase() === 'FORNECEDOR COMPONENTE');
      const qtyCompKey = colKeys.find(k => k.toUpperCase().includes('QUANTIDADE COMPONENTE') || k.toUpperCase() === 'QUANTIDADE COMPONENTE');
      const skuMatKey = colKeys.find(k => k.toUpperCase().includes('SKU MATERIAL') || k.toUpperCase() === 'SKU MATERIAL');
      const descMatKey = colKeys.find(k => k.toUpperCase().includes('DESCRIÇÃO MATERIAL') || k.toUpperCase() === 'DESCRIÇÃO MATERIAL');
      const fornMatKey = colKeys.find(k => k.toUpperCase().includes('FORNECEDOR MATERIAL') || k.toUpperCase() === 'FORNECEDOR MATERIAL');
      const qtyMatKey = colKeys.find(k => k.toUpperCase().includes('QTDE MATERIAL') || k.toUpperCase() === 'QTDE MATERIAL');
      // A coluna de unidade aparece truncada como "Un (" no Excel — busca por prefixo
      const unMatKey = colKeys.find(k => k.toUpperCase().startsWith('UN'));

      if (!skuKitKey) {
        console.warn(`[fabri1] Aba "${sheetName}" sem coluna de SKU kit — ignorada.`);
        return;
      }

      rows.forEach(row => {
        const skuKit = skuKitKey ? String(row[skuKitKey]).trim().toUpperCase() : '';
        if (!skuKit || skuKit === '' || skuKit === 'UNDEFINED') return;

        const skuComp = skuCompKey ? String(row[skuCompKey]).trim().toUpperCase() : '';
        // Ignora se não houver um SKU de componente válido
        if (!skuComp || skuComp === '' || skuComp === 'UNDEFINED') return;

        if (!map[skuKit]) {
          map[skuKit] = [];
        }

        const component = {
          skuComp: skuComp,
          descComp: descCompKey ? String(row[descCompKey]).trim() : '',
          fornComp: fornCompKey ? String(row[fornCompKey]).trim().toUpperCase() : '',
          qtyComp: qtyCompKey ? parseFloat(String(row[qtyCompKey]).replace(',', '.')) || 0 : 0,
          skuMat: skuMatKey ? String(row[skuMatKey]).trim().toUpperCase() : '',
          descMat: descMatKey ? String(row[descMatKey]).trim() : '',
          fornMat: fornMatKey ? String(row[fornMatKey]).trim().toUpperCase() : '',
          qtyMat: qtyMatKey ? parseFloat(String(row[qtyMatKey]).replace(',', '.')) || 0 : 0,
          unMat: unMatKey ? String(row[unMatKey]).trim() : ''
        };

        // Evita duplicatas (mesmo SKU componente já inserido neste item kit)
        const jaExiste = map[skuKit].some(c => c.skuComp === component.skuComp && c.skuMat === component.skuMat);
        if (!jaExiste) {
          map[skuKit].push(component);
        }
      });
    });

    VINI_STATE.fabriData = map;
    RemoteStorage.setItem('hrn_vini_fabri_data', JSON.stringify(map));
    console.log(`[fabri1] ${Object.keys(map).length} SKUs carregados de ${wb.SheetNames.length} aba(s): ${wb.SheetNames.join(', ')}`);
    return true;
  } catch (err) {
    console.error('Erro ao processar planilha de fabricação fabri1.xlsx:', err);
    throw err;
  }
}


// Expande ou recolhe um item de nível 1 na tabela
function toggleItemExpansion(sku) {
  if (!sku) return;
  if (VINI_STATE.expandedItems.has(sku)) {
    VINI_STATE.expandedItems.delete(sku);
  } else {
    VINI_STATE.expandedItems.add(sku);
  }
  RemoteStorage.setItem('hrn_vini_expanded_items', JSON.stringify(Array.from(VINI_STATE.expandedItems)));
  renderViniTable();
}
window.toggleItemExpansion = toggleItemExpansion;

// Expande ou recolhe um componente de nível 2 na tabela
function toggleCompExpansion(skuPai, skuComp) {
  if (!skuPai || !skuComp) return;
  const key = `${skuPai}|${skuComp}`;
  if (VINI_STATE.expandedComponents.has(key)) {
    VINI_STATE.expandedComponents.delete(key);
  } else {
    VINI_STATE.expandedComponents.add(key);
  }
  RemoteStorage.setItem('hrn_vini_expanded_comps', JSON.stringify(Array.from(VINI_STATE.expandedComponents)));
  renderViniTable();
}
window.toggleCompExpansion = toggleCompExpansion;

// Salva a quantidade e unidade do material (sub-sub-item) editados pelo usuário
function saveMaterialUsuario(key, qty, unit) {
  if (!key) return;
  if (!VINI_STATE.materiaisUsuario[key]) {
    VINI_STATE.materiaisUsuario[key] = {};
  }
  if (qty !== undefined) {
    VINI_STATE.materiaisUsuario[key].qty = parseFloat(qty) || 0;
  }
  if (unit !== undefined) {
    VINI_STATE.materiaisUsuario[key].unit = unit;
  }
  RemoteStorage.setItem('hrn_vini_materiais_usuario', JSON.stringify(VINI_STATE.materiaisUsuario));
}
window.saveMaterialUsuario = saveMaterialUsuario;

function updateMaterialQty(key, val) {
  saveMaterialUsuario(key, val, undefined);
}
window.updateMaterialQty = updateMaterialQty;

function updateMaterialUnit(key, val) {
  saveMaterialUsuario(key, undefined, val);
}
window.updateMaterialUnit = updateMaterialUnit;

// Processa dados do Excel e extrai as abas Necessidade e Entradas
function processExcelWorkbook(arrayBuffer) {
  try {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });

    // 1. Carrega aba EntradasPrevistas
    const epSheetName = 'EntradasPrevistas';
    let epData = [];
    if (wb.SheetNames.includes(epSheetName)) {
      const ws = wb.Sheets[epSheetName];
      epData = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    // Mapeçamento auxiliar de Entradas Previstas somadas por SKU
    const epMap = {};
    epData.forEach(item => {
      const sku = String(item['Código (SKU)'] || '').trim().toUpperCase();
      const qty = parseInt(item['Qtde']) || 0;
      if (sku) {
        epMap[sku] = (epMap[sku] || 0) + qty;
      }
    });

    // 2. Carrega aba de Necessidade PCP
    let pcpSheetName = 'NECESSIDADE PCP (3)';
    if (!wb.SheetNames.includes(pcpSheetName)) {
      pcpSheetName = wb.SheetNames.find(name => name.toUpperCase().includes('NECESSIDADE')) || wb.SheetNames[0];
    }

    if (!wb.SheetNames.includes(pcpSheetName)) {
      throw new Error('Aba de Necessidade não localizada na planilha.');
    }

    const ws = wb.Sheets[pcpSheetName];
    const rawNecessidade = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    // Obtém os cabeçalhos reais (linha 1) para descobrir o nome da coluna M (índice 12)
    const headersArray = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
    const colM_Header = headersArray[12]; // Coluna M

    const necessidadeData = rawNecessidade.map(row => {
      const sku = String(row['Código (SKU)'] || '').trim().toUpperCase();
      const produto = row['Produto'] || 'Produto sem nome';
      const entradasPrevistas = 0; // Zerado conforme solicitação do usuário (virá apenas de Produção de Componentes)

      const saidasPrevistas = parseFloat(row['Saídas previstas']) || 0;
      const estoqueFisico = parseFloat(row['Estoque físico']) || 0;
      
      // Lê o valor utilizando a chave que corresponde à coluna M (índice 12)
      const rawSaidasPeriodoVal = colM_Header && row[colM_Header] !== undefined ? row[colM_Header] : 0;
      const saidasPeriodo = parseFloat(String(rawSaidasPeriodoVal).replace(',', '.')) || 0;
      
      const prio2 = row['Prio 2'] !== undefined && row['Prio 2'] !== '' ? parseFloat(row['Prio 2']) : '—';

      const estoqueVirtual = estoqueFisico + entradasPrevistas - saidasPrevistas;

      // Parse robusto da Média Mensal (garante que strings erradas ou nulas virem números corretos)
      let mediaMensal = 0;
      const rawMedia = row['Média mensal'];
      if (rawMedia !== undefined && rawMedia !== null && rawMedia !== '') {
        const parsedMedia = parseFloat(String(rawMedia).replace(',', '.'));
        if (!isNaN(parsedMedia)) {
          mediaMensal = parsedMedia;
        }
      } else {
        mediaMensal = saidasPeriodo / 3;
      }
      mediaMensal = Number(mediaMensal.toFixed(2));

      // Coberturas baseadas em fórmulas seguras
      const coberturaFisica = mediaMensal > 0 ? Number((estoqueFisico / mediaMensal).toFixed(2)) : Infinity;
      const coberturaVirtual = mediaMensal > 0 ? Number(((estoqueFisico + entradasPrevistas - saidasPeriodo) / mediaMensal).toFixed(2)) : Infinity;

      return {
        produto,
        sku: sku || '—',  // Usa a variável local já normalizada (trim + toUpperCase)
        entradasPrevistas: 0, // Zerado conforme solicitação
        saidasPrevistas,
        estoqueFisico,
        estoqueVirtual,
        saidasPeriodo,
        mediaMensal,
        prio2,
        coberturaFisica,
        coberturaVirtual
      };
    });

    // Salva no estado
    VINI_STATE.necessidadeData = necessidadeData;
    VINI_STATE.entradasPrevistasData = epData;
    VINI_STATE.loaded = true;

    // Persiste
    RemoteStorage.setItem('hrn_vini_necessidades', JSON.stringify(necessidadeData));
    RemoteStorage.setItem('hrn_vini_entradas', JSON.stringify(epData));

    updatePrio2FilterOptions();
    return true;
  } catch (err) {
    console.error('Erro ao processar planilha:', err);
    throw err;
  }
}

// Carrega dados da planilha via Fetch
async function loadViniExcelData() {
  if (VINI_STATE.loaded && VINI_STATE.necessidadeData?.length > 0) return true;
  const tbody = document.getElementById('vini-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-cell">Nenhum planejamento V.I.N.I no banco central. Use "Sincronizar" para importar dados pela aplicação.</td></tr>';
  }
  return false;
}

// Renderiza a tabela do VINI e atualiza contadores/KPIs
function renderViniTable() {
  const tbody = document.getElementById('vini-body');
  if (!tbody) return;

  if (!VINI_STATE.loaded) {
    return;
  }

  // Atualiza o estoque físico e recálculos no V.I.N.I com base no estoque central e nos mapas de saídas
  if (window.EARV) {
    VINI_STATE.necessidadeData.forEach(item => {
      const skuNorm = String(item.sku || '').trim().toUpperCase();

      if (EARV.estoqueLoaded && EARV.estoqueMap) {
        item.estoqueFisico = EARV.estoqueMap[skuNorm] !== undefined ? EARV.estoqueMap[skuNorm] : 0;
      }
      if (EARV.estoqueLoaded && EARV.saidasPeriodoMap) {
        item.saidasPeriodo = EARV.saidasPeriodoMap[skuNorm] !== undefined ? EARV.saidasPeriodoMap[skuNorm] : 0;
        item.mediaMensal = Number((item.saidasPeriodo / 3).toFixed(2));
      }
      if (EARV.saidasPrevistasLoaded && EARV.saidasPrevistasMap) {
        item.saidasPrevistas = EARV.saidasPrevistasMap[skuNorm] !== undefined ? EARV.saidasPrevistasMap[skuNorm] : 0;
      }

      const localVirtual = typeof prodComp_getSaldoVirtualLocal === 'function' ? prodComp_getSaldoVirtualLocal(item.sku) : 0;
      const entradasTotal = localVirtual; // Apenas OPs de componentes (zerando entradas oficiais)
      item.entradasPrevistas = 0; // Limpa cache de entradas oficiais
      item.estoqueVirtual = item.estoqueFisico + entradasTotal - (item.saidasPrevistas || 0);
      item.coberturaFisica = item.mediaMensal > 0 ? item.estoqueFisico / item.mediaMensal : Infinity;
      item.coberturaVirtual = item.mediaMensal > 0 ? (item.estoqueFisico + entradasTotal) / item.mediaMensal : Infinity;
    });
    try {
      RemoteStorage.setItem('hrn_vini_necessidades', JSON.stringify(VINI_STATE.necessidadeData));
    } catch (e) { }
  }

  const itensFiltrados = VINI_STATE.necessidadeData.filter(item => isSkuValidoVini(item.sku));

  const searchText = (document.getElementById('vini-search')?.value || '').toLowerCase();

  // 2. Calcula contadores rápidos com base no fornecedor selecionado
  let countTotalActive = 0;
  let countCritical = 0;
  let countWarning = 0;
  let countOk = 0;
  let countNoDemand = 0;
  let countInactive = 0;

  itensFiltrados.forEach(item => {
    const isInactive = VINI_STATE.inativados.has(item.sku);
    const forn = VINI_STATE.fornecedoresMap[item.sku];

    // Checa se o item corresponde ao fornecedor selecionado
    if (VINI_STATE.selectedFornecedor !== 'all') {
      if (VINI_STATE.selectedFornecedor === 'SEM FORNECEDOR') {
        if (forn && forn.trim() !== '') return;
      } else {
        if (!forn || forn.trim().toUpperCase() !== VINI_STATE.selectedFornecedor) return;
      }
    }

    if (isInactive) {
      countInactive++;
      return;
    }

    countTotalActive++;
    const status = getItemStatus(item);
    if (status === 'critico') {
      countCritical++;
    } else if (status === 'atencao') {
      countWarning++;
    } else if (status === 'seguro') {
      countOk++;
    } else {
      countNoDemand++;
    }
  });

  // Atualiza as badges de KPIs no HTML
  const elTotal = document.getElementById('vini-kpi-total');
  const elCritical = document.getElementById('vini-kpi-critical');
  const elWarning = document.getElementById('vini-kpi-warning');
  const elOk = document.getElementById('vini-kpi-ok');
  const elNoDemand = document.getElementById('vini-kpi-no-demand');
  const elInactive = document.getElementById('vini-kpi-inactive');

  if (elTotal) elTotal.textContent = countTotalActive;
  if (elCritical) elCritical.textContent = countCritical;
  if (elWarning) elWarning.textContent = countWarning;
  if (elOk) elOk.textContent = countOk;
  if (elNoDemand) elNoDemand.textContent = countNoDemand;
  if (elInactive) elInactive.textContent = countInactive;

  // 3. Aplica filtros comuns
  let filtered = itensFiltrados;

  // Filtro de Fornecedor
  if (VINI_STATE.selectedFornecedor !== 'all') {
    filtered = filtered.filter(item => {
      const forn = VINI_STATE.fornecedoresMap[item.sku];
      if (VINI_STATE.selectedFornecedor === 'SEM FORNECEDOR') {
        return !forn || forn.trim() === '';
      }
      return forn && forn.trim().toUpperCase() === VINI_STATE.selectedFornecedor;
    });
  }

  // Filtro de Busca por Texto
  if (searchText) {
    filtered = filtered.filter(item =>
      item.produto.toLowerCase().includes(searchText) ||
      item.sku.toLowerCase().includes(searchText)
    );
  }

  // Filtro de Prioridade 2
  const prio2FilterVal = VINI_STATE.prio2Filter;
  if (prio2FilterVal === 'has-prio') {
    filtered = filtered.filter(item => item.prio2 !== '—');
  } else if (prio2FilterVal === 'no-prio') {
    filtered = filtered.filter(item => item.prio2 === '—');
  } else if (prio2FilterVal !== 'all') {
    filtered = filtered.filter(item => String(item.prio2) === prio2FilterVal);
  }



  // 5. Se for Tabela, aplica filtro por aba de KPI rápida
  const tabFilter = VINI_STATE.filterType;
  if (tabFilter === 'inactive') {
    // Exibe apenas inativos
    filtered = filtered.filter(item => VINI_STATE.inativados.has(item.sku));
  } else {
    // Para as outras abas, omite os inativos e aplica a respectiva regra
    filtered = filtered.filter(item => !VINI_STATE.inativados.has(item.sku));
    if (tabFilter === 'critical') {
      filtered = filtered.filter(item => getItemStatus(item) === 'critico');
    } else if (tabFilter === 'warning') {
      filtered = filtered.filter(item => getItemStatus(item) === 'atencao');
    } else if (tabFilter === 'ok') {
      filtered = filtered.filter(item => getItemStatus(item) === 'seguro');
    } else if (tabFilter === 'noDemand') {
      filtered = filtered.filter(item => getItemStatus(item) === 'semGiro');
    }
  }

  filtered = [...filtered].sort((a, b) => {
    const entA = prodComp_getSaldoVirtualLocal(a.sku);
    const entB = prodComp_getSaldoVirtualLocal(b.sku);
    const comprarA = Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * a.mediaMensal) - a.estoqueFisico - entA));
    const comprarB = Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * b.mediaMensal) - b.estoqueFisico - entB));

    let valA, valB;

    switch (VINI_STATE.sortColumn) {
      case 'produto':
        return VINI_STATE.sortDirection === 'asc'
          ? a.produto.localeCompare(b.produto, 'pt-BR')
          : b.produto.localeCompare(a.produto, 'pt-BR');
      case 'sku':
        return VINI_STATE.sortDirection === 'asc'
          ? a.sku.localeCompare(b.sku, 'pt-BR')
          : b.sku.localeCompare(a.sku, 'pt-BR');
      case 'entradasPrevistas':
        valA = entA;
        valB = entB;
        break;
      case 'saidasPrevistas':
        valA = a.saidasPrevistas;
        valB = b.saidasPrevistas;
        break;
      case 'estoqueFisico':
        valA = a.estoqueFisico;
        valB = b.estoqueFisico;
        break;
      case 'estoqueVirtual':
        valA = a.estoqueFisico + entA - a.saidasPrevistas;
        valB = b.estoqueFisico + entB - b.saidasPrevistas;
        break;
      case 'saidasPeriodo':
        valA = a.saidasPeriodo;
        valB = b.saidasPeriodo;
        break;
      case 'mediaMensal':
        valA = a.mediaMensal;
        valB = b.mediaMensal;
        break;
      case 'prio2':
        valA = a.prio2 === '—' ? 999999 : Number(a.prio2);
        valB = b.prio2 === '—' ? 999999 : Number(b.prio2);
        break;
      case 'coberturaFisica':
        valA = a.coberturaFisica;
        valB = b.coberturaFisica;
        break;
      case 'coberturaVirtual':
        valA = a.mediaMensal > 0 ? (a.estoqueFisico + entA) / a.mediaMensal : Infinity;
        valB = b.mediaMensal > 0 ? (b.estoqueFisico + entB) / b.mediaMensal : Infinity;
        break;
      case 'comprar':
        valA = comprarA;
        valB = comprarB;
        break;
      default:
        valA = a.produto;
        valB = b.produto;
        return valA.localeCompare(valB, 'pt-BR');
    }

    if (valA === valB) return 0;
    if (VINI_STATE.sortDirection === 'asc') {
      return valA > valB ? 1 : -1;
    } else {
      return valA < valB ? 1 : -1;
    }
  });

  // Atualiza setas visuais no cabeçalho da tabela
  document.querySelectorAll('#vini-table thead th.sortable-th').forEach(th => {
    const col = th.dataset.column;
    const iconSpan = th.querySelector('.sort-icon');
    if (iconSpan) {
      if (col === VINI_STATE.sortColumn) {
        th.classList.add('active-sort');
        iconSpan.textContent = VINI_STATE.sortDirection === 'asc' ? '▲' : '▼';
      } else {
        th.classList.remove('active-sort');
        iconSpan.textContent = '⇅';
      }
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-cell">Nenhum registro encontrado correspondente aos filtros.</td></tr>';
    return;
  }

  // Renderiza as linhas da tabela
  const rowsHtmlArray = [];

  filtered.forEach(item => {
    const localVirtual = prodComp_getSaldoVirtualLocal(item.sku);
    const entradasTotal = localVirtual; // Apenas OPs de componentes (zerando entradas oficiais)
    const estoqueVirtualTotal = item.estoqueFisico + entradasTotal - item.saidasPrevistas;

    // Coberturas baseadas em fórmulas seguras recalculadas com o virtual local
    const coberturaVirtualTotal = item.mediaMensal > 0 ? (item.estoqueFisico + entradasTotal) / item.mediaMensal : Infinity;
    const comprarTotal = Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * item.mediaMensal) - item.estoqueFisico - entradasTotal));

    const isInactive = VINI_STATE.inativados.has(item.sku);
    const isCritical = !isInactive && getItemStatus(item) === 'critico';

    let trClass = '';
    if (isInactive) trClass = 'tr-inactive-stock';
    else if (isCritical) trClass = 'tr-critical-stock';

    const highlightBuyClass = comprarTotal > 0 && !isInactive ? 'td-highlight-buy' : '';

    // Botão de Inativar ou Reativar conforme o estado
    let actionBtn = '';
    if (isInactive) {
      const showIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
      actionBtn = `<button class="btn-icon success btn-table-action" onclick="reativarSku('${escapeJSString(item.sku)}')" title="Reativar item">${showIcon}</button>`;
    } else {
      const hideIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
      const qtySugerida = comprarTotal > 0 ? comprarTotal : 10;
      actionBtn = `<div style="display:flex; gap: 4px; justify-content: center; align-items: center;">`;
      actionBtn += `
        <button class="earv-btn earv-btn--primary" 
                onclick="prodComp_openCreateModal('${escapeJSString(item.sku)}', ${qtySugerida}, '${escapeJSString(item.produto)}')"
                style="padding: 2px 8px; font-size: 0.76rem; border-radius: 4px; font-weight: bold; background-color: var(--accent-blue); border: none; color: white; cursor: pointer; height: auto;">
          Criar OP
        </button>
      `;
      actionBtn += `<button class="btn-icon danger btn-table-action" onclick="inativarSku('${escapeJSString(item.sku)}')" title="Inativar item" style="margin:0;">${hideIcon}</button>`;
      actionBtn += `</div>`;
    }

    const skuUp = String(item.sku || '').trim().toUpperCase();

    // Linha Nível 1 - Produto
    rowsHtmlArray.push(`
      <tr class="${trClass}">
        <td style="text-align: left; white-space: normal; min-width: 130px;">
          <div class="vini-tree-cell-wrapper level-0">
            <span class="vini-tree-text level-0-text">${item.produto}</span>
          </div>
        </td>
        <td style="font-weight:700; color:var(--accent-blue);">${item.sku}</td>
        <td>${fmtNum(entradasTotal)}</td>
        <td>${fmtNum(item.saidasPrevistas)}</td>
        <td style="font-weight:700; color: var(--text-primary);">${fmtNum(item.estoqueFisico)}</td>
        <td style="color: ${estoqueVirtualTotal < 0 ? 'var(--accent-red)' : 'var(--text-primary)'}">${fmtNum(estoqueVirtualTotal)}</td>
        <td>${fmtNum(item.saidasPeriodo)}</td>
        <td>${fmtNum(item.mediaMensal)}</td>
        <td>${item.prio2 === '—' ? '—' : fmtNum(item.prio2)}</td>
        <td style="color: ${item.coberturaFisica === Infinity ? 'var(--text-secondary)' : item.coberturaFisica < VINI_STATE.coberturaAlvo ? 'var(--accent-red)' : 'var(--accent-green)'}">${fmtCob(item.coberturaFisica)}</td>
        <td style="font-weight:600; color: ${coberturaVirtualTotal === Infinity ? 'var(--text-secondary)' : coberturaVirtualTotal < VINI_STATE.coberturaAlvo ? 'var(--accent-red)' : 'var(--accent-green)'}">${fmtCob(coberturaVirtualTotal)}</td>
        <td class="${highlightBuyClass}">${isInactive ? '—' : comprarTotal > 0 ? fmtNum(comprarTotal) : '✓ OK'}</td>
        <td style="text-align: center;">${actionBtn}</td>
      </tr>
    `);
  });

  tbody.innerHTML = rowsHtmlArray.join('');
}

// Obtém a lista de dados do VINI filtrada de acordo com o estado atual da UI
function getViniFilteredData() {
  if (!VINI_STATE.loaded) return [];

  const itensFiltrados = VINI_STATE.necessidadeData.filter(item => isSkuValidoVini(item.sku));
  let filtered = itensFiltrados;

  // 1. Filtro de Fornecedor
  if (VINI_STATE.selectedFornecedor !== 'all') {
    filtered = filtered.filter(item => {
      const forn = VINI_STATE.fornecedoresMap[item.sku];
      if (VINI_STATE.selectedFornecedor === 'SEM FORNECEDOR') {
        return !forn || forn.trim() === '';
      }
      return forn && forn.trim().toUpperCase() === VINI_STATE.selectedFornecedor;
    });
  }

  // 2. Filtro de Busca por Texto
  const searchText = (document.getElementById('vini-search')?.value || '').toLowerCase();
  if (searchText) {
    filtered = filtered.filter(item =>
      item.produto.toLowerCase().includes(searchText) ||
      item.sku.toLowerCase().includes(searchText)
    );
  }

  // 3. Filtro de Prioridade 2
  const prio2FilterVal = VINI_STATE.prio2Filter;
  if (prio2FilterVal === 'has-prio') {
    filtered = filtered.filter(item => item.prio2 !== '—');
  } else if (prio2FilterVal === 'no-prio') {
    filtered = filtered.filter(item => item.prio2 === '—');
  } else if (prio2FilterVal !== 'all') {
    filtered = filtered.filter(item => String(item.prio2) === prio2FilterVal);
  }

  // 4. Filtro de Aba rápida de KPI
  const tabFilter = VINI_STATE.filterType;
  if (tabFilter === 'inactive') {
    filtered = filtered.filter(item => VINI_STATE.inativados.has(item.sku));
  } else {
    filtered = filtered.filter(item => !VINI_STATE.inativados.has(item.sku));
    if (tabFilter === 'critical') {
      filtered = filtered.filter(item => getItemStatus(item) === 'critico');
    } else if (tabFilter === 'warning') {
      filtered = filtered.filter(item => getItemStatus(item) === 'atencao');
    } else if (tabFilter === 'ok') {
      filtered = filtered.filter(item => getItemStatus(item) === 'seguro');
    } else if (tabFilter === 'noDemand') {
      filtered = filtered.filter(item => getItemStatus(item) === 'semGiro');
    }
  }

  // 5. Aplica ordenação
  filtered = [...filtered].sort((a, b) => {
    const entA = prodComp_getSaldoVirtualLocal(a.sku);
    const entB = prodComp_getSaldoVirtualLocal(b.sku);
    const comprarA = Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * a.mediaMensal) - a.estoqueFisico - entA));
    const comprarB = Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * b.mediaMensal) - b.estoqueFisico - entB));

    let valA, valB;

    switch (VINI_STATE.sortColumn) {
      case 'produto':
        return VINI_STATE.sortDirection === 'asc'
          ? a.produto.localeCompare(b.produto, 'pt-BR')
          : b.produto.localeCompare(a.produto, 'pt-BR');
      case 'sku':
        return VINI_STATE.sortDirection === 'asc'
          ? a.sku.localeCompare(b.sku, 'pt-BR')
          : b.sku.localeCompare(a.sku, 'pt-BR');
      case 'entradasPrevistas':
        valA = entA;
        valB = entB;
        break;
      case 'saidasPrevistas':
        valA = a.saidasPrevistas;
        valB = b.saidasPrevistas;
        break;
      case 'estoqueFisico':
        valA = a.estoqueFisico;
        valB = b.estoqueFisico;
        break;
      case 'estoqueVirtual':
        valA = a.estoqueFisico + entA - a.saidasPrevistas;
        valB = b.estoqueFisico + entB - b.saidasPrevistas;
        break;
      case 'saidasPeriodo':
        valA = a.saidasPeriodo;
        valB = b.saidasPeriodo;
        break;
      case 'mediaMensal':
        valA = a.mediaMensal;
        valB = b.mediaMensal;
        break;
      case 'prio2':
        valA = a.prio2 === '—' ? 999999 : Number(a.prio2);
        valB = b.prio2 === '—' ? 999999 : Number(b.prio2);
        break;
      case 'coberturaFisica':
        valA = a.coberturaFisica;
        valB = b.coberturaFisica;
        break;
      case 'coberturaVirtual':
        valA = a.mediaMensal > 0 ? (a.estoqueFisico + entA) / a.mediaMensal : Infinity;
        valB = b.mediaMensal > 0 ? (b.estoqueFisico + entB) / b.mediaMensal : Infinity;
        break;
      case 'comprar':
        valA = comprarA;
        valB = comprarB;
        break;
      default:
        valA = a.produto;
        valB = b.produto;
        return valA.localeCompare(valB, 'pt-BR');
    }

    if (valA === valB) return 0;
    if (VINI_STATE.sortDirection === 'asc') {
      return valA > valB ? 1 : -1;
    } else {
      return valA < valB ? 1 : -1;
    }
  });

  return filtered;
}

// Exporta dados do VINI filtrados para CSV contendo apenas Produto, SKU e Comprar
function exportViniToCSV() {
  const filtrados = getViniFilteredData();
  if (filtrados.length === 0) {
    showToast('Nenhum registro filtrado disponível para exportar.', 'error');
    return;
  }

  const headers = ['Produto', 'SKU', 'Comprar'];

  const rows = filtrados.map(item => {
    const isInactive = VINI_STATE.inativados.has(item.sku);
    const entTotal = (item.entradasPrevistas || 0) + prodComp_getSaldoVirtualLocal(item.sku);
    const comprar = isInactive ? 0 : Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * item.mediaMensal) - item.estoqueFisico - entTotal));
    return [
      item.produto,
      item.sku,
      comprar > 0 ? comprar : 0
    ];
  });

  const csvContent = "\uFEFF" + [
    headers.join(';'),
    ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);

  const fornSuffix = VINI_STATE.selectedFornecedor === 'all' ? 'visao_geral' : VINI_STATE.selectedFornecedor.replace(/\s+/g, '_');
  const typeSuffix = VINI_STATE.filterType;
  link.setAttribute("download", `Planejamento_PCP_VINI_${fornSuffix}_${typeSuffix}.csv`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Planilha CSV filtrada exportada com sucesso!');
}

// Exporta relatório filtrado em TXT contendo apenas Produto, SKU e Comprar
function exportViniToTXT() {
  const filtrados = getViniFilteredData();
  if (filtrados.length === 0) {
    showToast('Nenhum registro filtrado disponível para exportar.', 'error');
    return;
  }

  const dataGeracao = new Date().toLocaleDateString('pt-BR') + ' às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fornName = VINI_STATE.selectedFornecedor === 'all' ? 'Visão Geral' : VINI_STATE.selectedFornecedor;
  const filterName = {
    all: 'Todos os Itens',
    critical: 'Itens Críticos',
    warning: 'Itens em Atenção',
    ok: 'Itens Seguros',
    noDemand: 'Itens Sem Giro',
    inactive: 'Itens Inativados'
  }[VINI_STATE.filterType] || VINI_STATE.filterType;

  let txt = `======================================================
     HR NÁUTICA PCP - RELATÓRIO DE COMPRAS (VINI)
======================================================
Filtro Fornecedor: ${fornName}
Filtro Categoria: ${filterName}
Horizonte de Cobertura Alvo: ${VINI_STATE.coberturaAlvo} meses
Gerado em: ${dataGeracao}
------------------------------------------------------
${'PRODUTO'.padEnd(40, ' ')} | ${'SKU'.padEnd(12, ' ')} | COMPRAR
------------------------------------------------------\n`;

  filtrados.forEach(item => {
    const isInactive = VINI_STATE.inativados.has(item.sku);
    const entTotal = (item.entradasPrevistas || 0) + prodComp_getSaldoVirtualLocal(item.sku);
    const comprar = isInactive ? 0 : Math.ceil(Math.max(0, (VINI_STATE.coberturaAlvo * item.mediaMensal) - item.estoqueFisico - entTotal));

    let prodName = item.produto;
    if (prodName.length > 40) {
      prodName = prodName.slice(0, 37) + '...';
    }

    txt += `${prodName.padEnd(40, ' ')} | ${item.sku.padEnd(12, ' ')} | ${comprar > 0 ? comprar : 0}\n`;
  });

  txt += `======================================================\nFim do Relatório. Total de itens: ${filtrados.length}`;

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);

  const fornSuffix = VINI_STATE.selectedFornecedor === 'all' ? 'visao_geral' : VINI_STATE.selectedFornecedor.replace(/\s+/g, '_');
  const typeSuffix = VINI_STATE.filterType;
  link.setAttribute("download", `Relatorio_PCP_VINI_${fornSuffix}_${typeSuffix}.txt`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Relatório TXT filtrado exportado com sucesso!');
}


// Preenche opções de Prioridade 2 com base nos dados reais
function updatePrio2FilterOptions() {
  const select = document.getElementById('vini-prio2-filter');
  if (!select) return;

  select.innerHTML = `
    <option value="all">Todas Prioridades</option>
    <option value="has-prio">Com Prio 2</option>
    <option value="no-prio">Sem Prio 2</option>
  `;

  const prioSet = new Set();
  if (Array.isArray(VINI_STATE.necessidadeData)) {
    VINI_STATE.necessidadeData.forEach(item => {
      if (item.prio2 !== '—' && !isNaN(item.prio2) && item.prio2 !== '' && item.prio2 !== undefined) {
        prioSet.add(Number(item.prio2));
      }
    });
  }

  Array.from(prioSet)
    .sort((a, b) => a - b)
    .forEach(val => {
      const opt = document.createElement('option');
      opt.value = String(val);
      opt.textContent = `Prio 2: ${fmtNum(val)}`;
      select.appendChild(opt);
    });

  if (VINI_STATE.prio2Filter !== 'all' && VINI_STATE.prio2Filter !== 'has-prio' && VINI_STATE.prio2Filter !== 'no-prio') {
    if (prioSet.has(Number(VINI_STATE.prio2Filter))) {
      select.value = VINI_STATE.prio2Filter;
    } else {
      VINI_STATE.prio2Filter = 'all';
      select.value = 'all';
    }
  } else {
    select.value = VINI_STATE.prio2Filter;
  }
}
window.updatePrio2FilterOptions = updatePrio2FilterOptions;

// Registra todos os ouvintes de evento
function initViniEvents() {
  const debouncedRender = debounce(renderViniTable, 80);

  // Slider de Cobertura Alvo
  const slider = document.getElementById('vini-months-slider');
  const sliderVal = document.getElementById('vini-months-value');

  if (slider && sliderVal) {
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      VINI_STATE.coberturaAlvo = val;
      sliderVal.textContent = val + (val === 1 ? ' mês' : ' meses');
      debouncedRender();
    });
  }

  // Busca de Texto
  const searchInput = document.getElementById('vini-search');
  if (searchInput) {
    const debouncedSearch = debounce(renderViniTable, 150);
    searchInput.addEventListener('input', () => {
      debouncedSearch();
    });
  }



  // Ouvintes de clique para as Abas de Filtros Rápidos (Tabela)
  const tabs = {
    all: document.getElementById('vini-filter-all'),
    critical: document.getElementById('vini-filter-critical-tab'),
    warning: document.getElementById('vini-filter-warning-tab'),
    ok: document.getElementById('vini-filter-ok'),
    noDemand: document.getElementById('vini-filter-no-demand'),
    inactive: document.getElementById('vini-filter-inactive-tab'),
  };

  Object.entries(tabs).forEach(([key, element]) => {
    if (element) {
      element.addEventListener('click', () => {
        VINI_STATE.filterType = key;
        Object.values(tabs).forEach(el => el?.classList.remove('active'));
        element.classList.add('active');
        renderViniTable();
      });
    }
  });

  // Ouvintes de clique nos cabeçalhos da tabela
  document.querySelectorAll('#vini-table thead th.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.column;
      if (VINI_STATE.sortColumn === col) {
        VINI_STATE.sortDirection = VINI_STATE.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        VINI_STATE.sortColumn = col;
        VINI_STATE.sortDirection = 'asc';
      }
      renderViniTable();
    });
  });

  // Botões de Exportação
  const btnExportCSV = document.getElementById('btn-vini-export-csv');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', () => {
      exportViniToCSV();
    });
  }

  const btnExportTXT = document.getElementById('btn-vini-export-txt');
  if (btnExportTXT) {
    btnExportTXT.addEventListener('click', () => {
      exportViniToTXT();
    });
  }

  // Filtro de Prioridade 2
  const prio2Select = document.getElementById('vini-prio2-filter');
  if (prio2Select) {
    prio2Select.addEventListener('change', (e) => {
      VINI_STATE.prio2Filter = e.target.value;
      renderViniTable();
    });
  }


}

// Reprocessa coberturas de dados já em cache
function reprocessNecessidadeData() {
  if (!Array.isArray(VINI_STATE.necessidadeData) || VINI_STATE.necessidadeData.length === 0) return;

  VINI_STATE.necessidadeData = VINI_STATE.necessidadeData.map(item => {
    const skuNorm = String(item.sku || '').trim().toUpperCase();

    let estoqueFisico = parseFloat(item.estoqueFisico) || 0;
    if (window.EARV && EARV.estoqueLoaded && EARV.estoqueMap) {
      estoqueFisico = EARV.estoqueMap[skuNorm] !== undefined ? EARV.estoqueMap[skuNorm] : 0;
    }

    let saidasPeriodo = parseFloat(item.saidasPeriodo) || 0;
    if (window.EARV && EARV.estoqueLoaded && EARV.saidasPeriodoMap) {
      saidasPeriodo = EARV.saidasPeriodoMap[skuNorm] !== undefined ? EARV.saidasPeriodoMap[skuNorm] : 0;
    }

    let saidasPrevistas = parseFloat(item.saidasPrevistas) || 0;
    if (window.EARV && EARV.saidasPrevistasLoaded && EARV.saidasPrevistasMap) {
      saidasPrevistas = EARV.saidasPrevistasMap[skuNorm] !== undefined ? EARV.saidasPrevistasMap[skuNorm] : 0;
    }

    const localVirtual = typeof prodComp_getSaldoVirtualLocal === 'function' ? prodComp_getSaldoVirtualLocal(item.sku) : 0;
    const entradasPrevistas = 0; // Zerado conforme solicitação do usuário
    const entradasTotal = localVirtual; // Apenas OPs locais de componentes

    const mediaMensal = saidasPeriodo > 0 ? Number((saidasPeriodo / 3).toFixed(2)) : 0;

    const estoqueVirtual = estoqueFisico + entradasTotal - saidasPrevistas;
    const coberturaFisica = mediaMensal > 0 ? estoqueFisico / mediaMensal : Infinity;
    const coberturaVirtual = mediaMensal > 0
      ? Number(((estoqueFisico + entradasTotal) / mediaMensal).toFixed(2))
      : Infinity;

    return {
      ...item,
      entradasPrevistas: 0,
      estoqueFisico,
      saidasPeriodo,
      saidasPrevistas,
      mediaMensal,
      estoqueVirtual,
      coberturaFisica,
      coberturaVirtual
    };
  });

  RemoteStorage.setItem('hrn_vini_necessidades', JSON.stringify(VINI_STATE.necessidadeData));
}

// Migração: normaliza SKUs existentes no cache para uppercase (compatibilidade com dados antigos)
function migrateSkusToUpperCase() {
  if (!Array.isArray(VINI_STATE.necessidadeData) || VINI_STATE.necessidadeData.length === 0) return;
  let mudou = false;
  VINI_STATE.necessidadeData = VINI_STATE.necessidadeData.map(item => {
    const skuNorm = String(item.sku || '').trim().toUpperCase();
    if (skuNorm !== item.sku) {
      mudou = true;
      return { ...item, sku: skuNorm };
    }
    return item;
  });
  if (mudou) {
    RemoteStorage.setItem('hrn_vini_necessidades', JSON.stringify(VINI_STATE.necessidadeData));
    console.log('[VINI] SKUs do cache migrados para uppercase.');
  }
}

// Limpa qualquer cache residual de entradas previstas e zera nos itens locais
function clearCachedEntradasPrevistas() {
  RemoteStorage.removeItem('hrn_vini_entradas');
  RemoteStorage.removeItem('hrn_prod_comp_entradas');
  if (Array.isArray(VINI_STATE.necessidadeData)) {
    let mudou = false;
    VINI_STATE.necessidadeData = VINI_STATE.necessidadeData.map(item => {
      if (item.entradasPrevistas !== 0) {
        mudou = true;
        return { ...item, entradasPrevistas: 0 };
      }
      return item;
    });
    if (mudou) {
      RemoteStorage.setItem('hrn_vini_necessidades', JSON.stringify(VINI_STATE.necessidadeData));
      console.log('[VINI] Cache local de entradas previstas foi zerado.');
    }
  }
}

// Inicializa o módulo
async function initViniModule() {
  initViniEvents();
  clearCachedEntradasPrevistas();
  migrateSkusToUpperCase();
  reprocessNecessidadeData();
  await loadViniExcelData();
  updatePrio2FilterOptions();
  renderViniTable();
}

// Inicializa no DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initViniModule();
});

// Adiciona estilos chave de animação para spin
if (!document.getElementById('hrn-vini-spin-styles')) {
  const styleSheet = document.createElement("style");
  styleSheet.id = 'hrn-vini-spin-styles';
  styleSheet.innerText = `
  @keyframes spin {
    100% { transform: rotate(360deg); }
  }
  `;
  document.head.appendChild(styleSheet);
}





