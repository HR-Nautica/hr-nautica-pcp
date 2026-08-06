/* ═══════════════════════════════════════════
   analise.js – Módulo de Análise de Produção
   HR Náutica PCP
   ═══════════════════════════════════════════ */

'use strict';

function normalizeKey(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

function excelDateToISO(excelDate) {
  if (!excelDate) return new Date().toISOString();
  if (typeof excelDate === 'string') {
    const parts = excelDate.split('/');
    if (parts.length === 3) {
      const d = new Date(parts[2], parts[1] - 1, parts[0]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(excelDate);
    if (!isNaN(d.getTime())) return d.toISOString();
    return new Date().toISOString();
  }
  const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  return date.toISOString();
}

const ANALISE_STATE = {
  coberturaData: safeGetJSON('hrn_analise_cobertura_data', []),
  coberturaAlvo: Number(RemoteStorage.getItem('hrn_analise_cobertura_alvo')) || 3,
  loaded: !!RemoteStorage.getItem('hrn_analise_cobertura_data'),
  filterType: 'all', // 'all' | 'critical' | 'warning' | 'ok'
  searchText: '',
  sortColumn: 'prioridadeGeral',
  sortDirection: 'asc'
};

// Formata cobertura em meses (comportamento similar ao vini.js)
function fmtAnaliseCob(valor) {
  if (!isFinite(valor) || valor === Infinity || valor === null || valor === undefined) return 'Sem Giro';
  return `${Number(valor).toFixed(1)} ${valor === 1 ? 'mês' : 'meses'}`;
}

function excelRoundDown(val, decimals) {
  if (val === null || val === undefined || isNaN(val)) return null;
  const factor = Math.pow(10, decimals);
  const eps = 1e-9;
  const sign = Math.sign(val);
  const absVal = Math.abs(val) + eps;
  return sign * Math.floor(absVal * factor) / factor;
}

// Obtém a classificação de criticidade de um item com base na prioridade física (prio2)
function getAnaliseItemStatus(item, targetCoverage) {
  if (item.prio2 === null || item.prio2 === undefined || isNaN(Number(item.prio2))) {
    return 'ok';
  }

  const prioNum = Number(item.prio2);
  if (prioNum <= targetCoverage) {
    return 'critical';
  } else if (prioNum > targetCoverage && prioNum <= targetCoverage + 1.0) {
    return 'warning';
  } else {
    return 'ok';
  }
}

// Sincroniza as peças em Rastreio de Operações a partir da aba correspondente da Planilha
function syncRastreioPecas(wb) {
  try {
    // 1. Encontra a aba de Rastreio de Peças
    let sheetName = wb.SheetNames.find(name => {
      const n = name.toLowerCase();
      return n.includes('rastreio') || n.includes('producao') || n.includes('produção') || n.includes('peças') || n.includes('pecas') || n.includes('fluxo') || n.includes('lote');
    });
    
    if (!sheetName) {
      console.warn('[RASTREIO] Nenhuma aba de Rastreio/Produção localizada na planilha.');
      return;
    }
    
    console.log(`[RASTREIO] Sincronizando aba de Rastreio: "${sheetName}"`);
    
    const ws = wb.Sheets[sheetName];
    // sheet_to_json a partir da linha 0
    const rowsJson = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (!rowsJson || rowsJson.length === 0) {
      console.warn('[RASTREIO] Aba de Rastreio vazia.');
      return;
    }
    
    let pecasLocais = DB.getPecas();
    let opsLocais = DB.getOps();
    let hasChanges = false;
    let opsChanged = false;
    let pecasMovidas = 0;
    let pecasAdicionadas = 0;
    
    // Normalização das localizações para códigos de operação
    const locToOp = (loc) => {
      if (!loc) return '01';
      const l = loc.toLowerCase().replace(/\r?\n/g, ' ').trim();
      if (l.includes('fundid') || l.includes('fundindo') || l.includes('produzindo fund')) return '01';
      if (l.includes('vulcaniz')) return '02';
      if (l.includes('polimento')) return '03';
      if (l.includes('estoque bruto') || l.includes('codan)')) return '03';
      if (l.includes('usinagem')) return '04';
      if (l.includes('estoque usinado')) return '04';
      if (l.includes('pintura')) return '05';
      if (l.includes('embuchamento')) return '06';
      if (l.includes('grava')) return '07';
      if (l.includes('entrada')) return '07';
      return '01';
    };
    
    const opToEtapa = {
      '01': 'Injeção/Fundição',
      '02': 'Pintura/Polimento',
      '03': 'Pintura/Polimento',
      '04': 'Usinagem',
      '05': 'Pintura/Polimento',
      '06': 'Em Produção',
      '07': 'Em Produção',
    };
    
    // Mapa para criar OPs temporárias se necessário
    const opMap = {};
    opsLocais.forEach(op => {
      const key = `${op.modelo}|${op.etapa}`;
      opMap[key] = { id: op.id, numero: op.numero };
    });
    
    const now = new Date().toISOString();
    
    rowsJson.forEach((row, idx) => {
      const nome = String(row['Descrição'] || row['descricao'] || row['Modelo'] || row['Produto'] || row['nome'] || '').trim();
      const sku = String(row['Código (SKU)'] || row['Codigo (SKU)'] || row['SKU'] || row['Código'] || '').trim().toUpperCase();
      const bruto = String(row['Bruto'] || row['bruto'] || row['Bruto/Coquilha'] || '').trim();
      const localizacao = String(row['Localização'] || row['Localizacao'] || row['Etapa'] || row['Operação'] || '').trim();
      const qty = parseInt(row['Acompanhamento de Peças (qty)'] || row['Acompanhamento de Pecas (qty)'] || row['qty'] || row['Qtd'] || row['Quantidade'] || '0', 10);
      
      if (!nome || !sku || qty === 0) return;
      
      const opCode = locToOp(localizacao);
      const etapa = opToEtapa[opCode] || 'Em Produção';
      const loteNum = `${sku}-L${String(idx + 1).padStart(3, '0')}`;
      
      // Procura se a peça já existe localmente
      const pecaExistente = pecasLocais.find(p => p.numero === loteNum);
      
      if (pecaExistente) {
        let mudouOp = false;
        let oldOp = pecaExistente.operacaoAtual;
        
        if (pecaExistente.operacaoAtual !== opCode) {
          mudouOp = true;
          pecaExistente.operacaoAtual = opCode;
          pecaExistente.atualizadoEm = now;
          if (!pecaExistente.historico) pecaExistente.historico = [];
          
          pecaExistente.historico.push({
            op: opCode,
            data: now,
            obs: `Atualizado via Planilha (de ${oldOp} para ${opCode})`
          });
          
          console.log(`[RASTREIO] Peça ${loteNum} movida para Op. ${opCode}`);
          pecasMovidas++;
          hasChanges = true;
        }
        
        if (pecaExistente.qty !== qty) {
          pecaExistente.qty = qty;
          hasChanges = true;
        }
        
        // Se a operação mudou e tem OP vinculada, move a OP no Kanban
        if (mudouOp && pecaExistente.opNumero) {
          const op = opsLocais.find(o => o.numero === pecaExistente.opNumero);
          if (op && op.etapa !== etapa) {
            op.etapa = etapa;
            opsChanged = true;
            DB.addAtividade(`OP ${op.numero} movida para ${etapa} (Sincronizado via Planilha)`, 'teal');
          }
        }
      } else {
        // Se a peça não existe, cria a OP e a peça correspondente
        const mapKey = `${nome}|${etapa}`;
        let opId = opMap[mapKey]?.id;
        let opNumero = opMap[mapKey]?.numero;
        
        if (!opId) {
          const novaOp = DB.addOp({
            modelo: nome,
            qty: qty,
            cliente: 'Estoque Interno',
            prazo: '',
            etapa,
            prioridade: 'Normal',
            obs: `Criada via Planilha. Bruto: ${bruto}. Loc: ${localizacao}`,
          });
          opId = novaOp.id;
          opNumero = novaOp.numero;
          opMap[mapKey] = { id: opId, numero: opNumero };
          // Recarrega do banco local para incluir a nova OP no array
          opsLocais = DB.getOps();
          opsChanged = true;
        }
        
        const novaPeca = {
          id: DB._id(),
          numero: loteNum,
          modelo: nome,
          tipoFundicao: bruto,
          qty: qty,
          operacaoAtual: opCode,
          opId: opId,
          opNumero: opNumero,
          obs: `Sincronizada via Planilha. Loc: ${localizacao} | Bruto: ${bruto}`,
          historico: [{ op: opCode, data: now, obs: `Importada via Planilha – ${localizacao}` }],
          criadoEm: now,
          atualizadoEm: now
        };
        
        pecasLocais.push(novaPeca);
        console.log(`[RASTREIO] Nova peça ${loteNum} cadastrada da planilha.`);
        pecasAdicionadas++;
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      DB.savePecas(pecasLocais);
    }
    if (opsChanged) {
      DB.saveOps(opsLocais);
    }
    
    if (pecasMovidas > 0 || pecasAdicionadas > 0) {
      DB.addAtividade(`Sincronização de Rastreio: ${pecasMovidas} peças movidas, ${pecasAdicionadas} novas peças criadas.`, 'teal');
    }
    
  } catch (err) {
    console.error('[RASTREIO] Erro ao sincronizar peças da Planilha:', err);
  }
}

function getExcelRowValue(row, possibleNames, defaultVal = '') {
  if (!row) return defaultVal;
  const keys = Object.keys(row);
  for (const name of possibleNames) {
    const targetClean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedKey = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === targetClean);
    if (matchedKey !== undefined && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
      return row[matchedKey];
    }
  }
  return defaultVal;
}

function parseExcelFloat(val, defaultVal = 0) {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
  const str = String(val).replace(/\s+/g, '').replace(',', '.');
  const num = parseFloat(str);
  return isNaN(num) ? defaultVal : num;
}

function getAnaliseCatalogoItems() {
  if (typeof DB !== 'undefined' && typeof DB.getModelos === 'function') {
    const modelos = DB.getModelos();
    if (Array.isArray(modelos) && modelos.length > 0) return modelos;
  }
  return typeof CATALOGO_DATA !== 'undefined' && Array.isArray(CATALOGO_DATA) ? CATALOGO_DATA : [];
}

function mergeAnaliseWithCatalogo(sourceItems = []) {
  const bySku = new Map();
  const byName = new Map();
  sourceItems.forEach(item => {
    const skuKey = String(item.sku || '').trim().toUpperCase();
    const nameKey = normalizeKey(item.produto || item.nome);
    if (skuKey) bySku.set(skuKey, item);
    if (nameKey) byName.set(nameKey, item);
  });

  return getAnaliseCatalogoItems().map((modelo, index) => {
    const sku = String(modelo.sku || '').trim().toUpperCase();
    const source = bySku.get(sku) || byName.get(normalizeKey(modelo.nome)) || {};
    const estoqueFisico = parseExcelFloat(source.estoqueFisico, 0);
    const saidasPrevistas = parseExcelFloat(source.saidasPrevistas, 0);
    const mediaMensal = parseExcelFloat(source.mediaMensal, 0);

    return {
      ...source,
      originalIndex: index + 1,
      prioridadeGeral: source.prioridadeGeral || String(index + 1).padStart(2, '0'),
      produto: modelo.nome || source.produto || 'Produto sem nome',
      sku: modelo.sku || source.sku || `SKU-${index + 1}`,
      codigoBruto: modelo.codigoBruto || source.codigoBruto || '-',
      entradasPrevistas: null,
      saidasPrevistas,
      estoqueFisico,
      estoque1: estoqueFisico - saidasPrevistas,
      estoqueVirtual: estoqueFisico - saidasPrevistas,
      mediaMensal,
      coberturaVirtual: mediaMensal > 0 ? estoqueFisico / mediaMensal : Infinity,
      prio2: source.prio2 ?? null,
      prio2Excel: source.prio2Excel ?? null,
      localizacao: source.localizacao || '-',
      bucha: modelo.modeloBucha || modelo.bucha || source.bucha || '-'
    };
  });
}

// Processa o arquivo Excel e extrai os dados
function processAnaliseExcel(arrayBuffer) {
  try {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Trata como a planilha padrão de Cobertura (3-Cobertura)
    let sheetName = '3-Cobertura';
    if (!wb.SheetNames.includes(sheetName)) {
      sheetName = wb.SheetNames.find(name => name.toLowerCase().includes('cobertura')) || wb.SheetNames[0];
    }

    if (!wb.SheetNames.includes(sheetName)) {
      throw new Error('Aba de Cobertura não localizada na planilha.');
    }

    const ws = wb.Sheets[sheetName];
    // A linha 6 contém os cabeçalhos. H, I e N são lidas pela posição absoluta da coluna.
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, range: 5, defval: '' });
    const headers = matrix[0] || [];
    const sourceRows = matrix.slice(1).map(values => ({
      values,
      row: Object.fromEntries(headers.map((header, index) => [String(header || `COL_${index}`), values[index]]))
    }));

    if (sourceRows.length === 0) {
      throw new Error('Nenhum dado encontrado na aba de Cobertura.');
    }

    let rowIdx = 0;
    const importedData = sourceRows.map(({ row, values }) => {
      const produto = String(getExcelRowValue(row, ['Produto', 'Descrição', 'Nome', 'Modelo'])).trim();
      const sku = String(getExcelRowValue(row, ['Código (SKU)', 'Codigo (SKU)', 'SKU', 'Código'])).trim().toUpperCase();
      const codigoBruto = String(getExcelRowValue(row, ['Código Bruto', 'Codigo Bruto', 'Bruto'])).trim();
      
      const prioridadeGeralRaw = String(getExcelRowValue(row, ['Prioridade GERAL', 'Prioridade', 'Rank', 'Geral'])).trim();
      
      const entradasPrevistas = null;
      const saidasPrevistas = parseExcelFloat(values[7], 0); // Coluna H
      const estoqueFisico = parseExcelFloat(values[8], 0); // Coluna I
      const estoque1 = estoqueFisico - saidasPrevistas;
      const estoqueVirtual = estoqueFisico - saidasPrevistas;
      const mediaMensal = parseExcelFloat(values[13], 0); // Coluna N
      
      const rawPrio = getExcelRowValue(row, ['Prio2', 'Prio 2', 'Prioridade2'], null);
      const prioVal = rawPrio !== null && rawPrio !== '' ? parseExcelFloat(rawPrio, null) : null;

      const coberturaVirtual = mediaMensal > 0 ? estoqueFisico / mediaMensal : Infinity;
      const localizacao = String(getExcelRowValue(row, ['Localização', 'Localizacao', 'Loc'], '-')).trim();
      const bucha = String(getExcelRowValue(row, ['bucha', 'Bucha'], '-')).trim();

      rowIdx++;
      const prioridadeGeral = prioridadeGeralRaw || String(rowIdx).padStart(2, '0');

      return {
        originalIndex: rowIdx,
        prioridadeGeral,
        produto,
        sku,
        codigoBruto,
        entradasPrevistas,
        saidasPrevistas,
        estoqueFisico,
        estoque1,
        estoqueVirtual,
        mediaMensal,
        prio2: prioVal,
        prio2Excel: prioVal,
        coberturaVirtual,
        localizacao,
        bucha
      };
    }).filter(item => (item.sku || item.produto) && item.produto !== 'undefined');

    const parsedData = mergeAnaliseWithCatalogo(importedData);

    ANALISE_STATE.coberturaData = parsedData;
    ANALISE_STATE.loaded = true;

    RemoteStorage.setItem('hrn_analise_cobertura_data', JSON.stringify(parsedData));

    // Sincroniza também as peças em Rastreio (se houver a aba correspondente no mesmo arquivo)
    syncRastreioPecas(wb);

    return true;
  } catch (err) {
    console.error('[ANALISE] Erro ao processar planilha de cobertura:', err);
    throw err;
  }
}

// Carrega dados da planilha via Fetch automaticamente no início
async function loadAnaliseExcelData() {
  if (ANALISE_STATE.loaded && ANALISE_STATE.coberturaData?.length > 0) {
    renderAnaliseTable();
    return true;
  }
  const tbody = document.getElementById('analise-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="14" class="empty-cell">Nenhum dado de cobertura no banco central. Use "Sincronizar Cobertura" para importar uma planilha pela aplicação.</td></tr>';
  }
  return false;
}

// Renderiza a tabela de analise de producao
function renderAnaliseTable() {
  const tbody = document.getElementById('analise-body');
  if (!tbody) return;

  if (!ANALISE_STATE.loaded) {
    return;
  }

  // O catálogo é sempre a lista mestre; a planilha apenas alimenta seus valores.
  ANALISE_STATE.coberturaData = mergeAnaliseWithCatalogo(ANALISE_STATE.coberturaData);

  // Recalcula os indicadores conforme o mapeamento vigente.
  ANALISE_STATE.coberturaData.forEach(item => {
    item.entradasPrevistas = null;
    item.estoqueVirtual = item.estoqueFisico - (item.saidasPrevistas || 0);
    item.coberturaVirtual = item.mediaMensal > 0 ? item.estoqueFisico / item.mediaMensal : Infinity;
    
    // Se o prio2 veio diretamente do Excel (prio2Excel), preserva o valor da planilha
    if (item.prio2Excel !== undefined && item.prio2Excel !== null) {
      item.prio2 = item.prio2Excel;
    } else {
      const estoque1 = item.estoqueFisico - item.saidasPrevistas;
      if (estoque1 < 0) {
        item.prio2 = -1.0;
      } else {
        const hasMax = /max\./i.test(item.produto);
        if (hasMax) {
          item.prio2 = null;
        } else {
          const mediaMensal = Number(item.mediaMensal) || 0;
          let rawVal;
          if (item.estoqueVirtual < 0) {
            rawVal = mediaMensal > 0 ? (item.estoqueVirtual / mediaMensal) : 0;
          } else {
            if (mediaMensal < 2) {
              rawVal = 5.0;
            } else {
              rawVal = estoque1 / mediaMensal;
            }
          }
          item.prio2 = excelRoundDown(rawVal, 1);
        }
      }
    }
  });

  // 1. Calcula contadores rápidos de KPIs
  let countTotal = 0;
  let countCritical = 0;
  let countWarning = 0;
  let countOk = 0;

  ANALISE_STATE.coberturaData.forEach(item => {
    countTotal++;
    const status = getAnaliseItemStatus(item, ANALISE_STATE.coberturaAlvo);
    if (status === 'critical') {
      countCritical++;
    } else if (status === 'warning') {
      countWarning++;
    } else {
      countOk++;
    }
  });

  // Atualiza as badges no HTML
  const elTotal = document.getElementById('analise-kpi-total');
  const elCritical = document.getElementById('analise-kpi-critical');
  const elWarning = document.getElementById('analise-kpi-warning');
  const elOk = document.getElementById('analise-kpi-ok');

  if (elTotal) elTotal.textContent = countTotal;
  if (elCritical) elCritical.textContent = countCritical;
  if (elWarning) elWarning.textContent = countWarning;
  if (elOk) elOk.textContent = countOk;

  // 2. Aplica filtros
  let filtered = ANALISE_STATE.coberturaData;

  // Filtro de pesquisa de texto
  if (ANALISE_STATE.searchText) {
    const search = ANALISE_STATE.searchText.toLowerCase();
    filtered = filtered.filter(item =>
      item.produto.toLowerCase().includes(search) ||
      item.sku.toLowerCase().includes(search)
    );
  }

  // Filtro de KPIs rápidos
  if (ANALISE_STATE.filterType === 'critical') {
    filtered = filtered.filter(item => getAnaliseItemStatus(item, ANALISE_STATE.coberturaAlvo) === 'critical');
  } else if (ANALISE_STATE.filterType === 'warning') {
    filtered = filtered.filter(item => getAnaliseItemStatus(item, ANALISE_STATE.coberturaAlvo) === 'warning');
  } else if (ANALISE_STATE.filterType === 'ok') {
    filtered = filtered.filter(item => getAnaliseItemStatus(item, ANALISE_STATE.coberturaAlvo) === 'ok');
  }

  // 3. Aplica ordenação
  filtered = [...filtered].sort((a, b) => {
    let valA, valB;
    
    // Calcula valores recomendados dinamicamente para comparação, caso ordene por "Qtd Produzir"
    const diffA = a.estoqueVirtual - (a.mediaMensal * ANALISE_STATE.coberturaAlvo);
    const colocarOpA = diffA < 0 ? Math.ceil(Math.abs(diffA) / 10) * 10 : 0;
    const diffB = b.estoqueVirtual - (b.mediaMensal * ANALISE_STATE.coberturaAlvo);
    const colocarOpB = diffB < 0 ? Math.ceil(Math.abs(diffB) / 10) * 10 : 0;

    switch (ANALISE_STATE.sortColumn) {
      case 'prioridadeGeral':
        if (a.originalIndex !== undefined && b.originalIndex !== undefined) {
          valA = a.originalIndex;
          valB = b.originalIndex;
        } else {
          valA = parseInt(a.prioridadeGeral) || 999;
          valB = parseInt(b.prioridadeGeral) || 999;
        }
        break;
      case 'produto':
        return ANALISE_STATE.sortDirection === 'asc'
          ? a.produto.localeCompare(b.produto, 'pt-BR')
          : b.produto.localeCompare(a.produto, 'pt-BR');
      case 'sku':
        return ANALISE_STATE.sortDirection === 'asc'
          ? a.sku.localeCompare(b.sku, 'pt-BR')
          : b.sku.localeCompare(a.sku, 'pt-BR');
      case 'codigoBruto':
        return ANALISE_STATE.sortDirection === 'asc'
          ? a.codigoBruto.localeCompare(b.codigoBruto, 'pt-BR')
          : b.codigoBruto.localeCompare(a.codigoBruto, 'pt-BR');
      case 'entradasPrevistas':
        valA = a.entradasPrevistas;
        valB = b.entradasPrevistas;
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
        valA = a.estoqueVirtual;
        valB = b.estoqueVirtual;
        break;
      case 'mediaMensal':
        valA = a.mediaMensal;
        valB = b.mediaMensal;
        break;
      case 'cobertura':
        valA = a.coberturaVirtual;
        valB = b.coberturaVirtual;
        break;
      case 'prio2':
        // Nulls (Sem prio) vão para o final
        valA = a.prio2 === null ? 9999 : Number(a.prio2);
        valB = b.prio2 === null ? 9999 : Number(b.prio2);
        break;
      case 'colocarOp':
        valA = colocarOpA;
        valB = colocarOpB;
        break;
      case 'localizacao':
        return ANALISE_STATE.sortDirection === 'asc'
          ? a.localizacao.localeCompare(b.localizacao, 'pt-BR')
          : b.localizacao.localeCompare(a.localizacao, 'pt-BR');
      default:
        valA = a.prioridadeGeral;
        valB = b.prioridadeGeral;
    }

    if (valA === valB) return 0;
    if (ANALISE_STATE.sortDirection === 'asc') {
      return valA > valB ? 1 : -1;
    } else {
      return valA < valB ? 1 : -1;
    }
  });

  // Atualiza setas visuais no cabeçalho
  document.querySelectorAll('#analise-table thead th.sortable-th').forEach(th => {
    const col = th.dataset.column;
    const iconSpan = th.querySelector('.sort-icon');
    if (iconSpan) {
      if (col === ANALISE_STATE.sortColumn) {
        th.classList.add('active-sort');
        iconSpan.textContent = ANALISE_STATE.sortDirection === 'asc' ? '▲' : '▼';
      } else {
        th.classList.remove('active-sort');
        iconSpan.textContent = '⇅';
      }
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" class="empty-cell">Nenhum produto encontrado correspondente aos filtros.</td></tr>';
    return;
  }

  // Renderiza as linhas
  tbody.innerHTML = filtered.map(item => {
    // Cálculo dinâmico com base na meta de cobertura
    const diff = item.estoqueVirtual - (item.mediaMensal * ANALISE_STATE.coberturaAlvo);
    const need = diff < 0 ? Math.ceil(Math.abs(diff) / 10) * 10 : 0;

    const status = getAnaliseItemStatus(item, ANALISE_STATE.coberturaAlvo);
    
    let trClass = '';
    let statusBadge = '';
    if (status === 'critical') {
      trClass = 'tr-critical-stock';
      statusBadge = '<span class="chip chip--red" style="font-size:0.65rem">Crítico</span>';
    } else if (status === 'warning') {
      trClass = 'tr-warning-stock';
      statusBadge = '<span class="chip chip--orange" style="font-size:0.65rem">Atenção</span>';
    } else {
      statusBadge = '<span class="chip chip--green" style="font-size:0.65rem">Estável</span>';
    }

    // Botão de ação
    let actionBtn = '';
    if (need > 0) {
      actionBtn = `<button class="btn-primary" style="padding:4px 8px;font-size:0.7rem;height:auto" onclick="abrirNovaOPPreenchida('${escapeJSString(item.produto)}', ${need}, ${item.prio2})">Criar OP</button>`;
    } else {
      actionBtn = `<span style="color:var(--text-muted);font-size:0.7rem;font-weight:600">✓ OK</span>`;
    }

    const formattedPrio = item.prio2 !== null ? item.prio2.toFixed(1) : '—';
    const formattedNeed = need > 0 ? `<strong>${need}</strong>` : '0';

    return `<tr class="${trClass}">
      <td><span style="color:var(--text-muted);font-weight:700">${item.prioridadeGeral || '—'}</span></td>
      <td style="text-align:left !important;color:var(--text-primary);font-weight:500">${item.produto}</td>
      <td><span class="chip chip--blue" style="font-size:0.68rem;font-family:monospace;font-weight:700">${item.sku}</span></td>
      <td><span style="color:var(--text-secondary);font-size:0.72rem">${item.codigoBruto || '—'}</span></td>
      <td>${item.estoqueFisico}</td>
      <td><span style="color:var(--text-muted);font-weight:600">N/A</span></td>
      <td>${item.saidasPrevistas}</td>
      <td><strong style="color:${item.estoqueVirtual < 0 ? 'var(--accent-red)' : 'var(--text-primary)'}">${item.estoqueVirtual}</strong></td>
      <td>${item.mediaMensal.toFixed(1)}</td>
      <td>${fmtAnaliseCob(item.coberturaVirtual)}</td>
      <td><div style="display:flex;flex-direction:column;align-items:center;gap:3px"><strong>${formattedPrio}</strong> ${statusBadge}</div></td>
      <td style="color:${need > 0 ? 'var(--accent-red)' : 'var(--text-primary)'}">${formattedNeed}</td>
      <td style="font-size:0.7rem">${item.localizacao}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');

  // 4. Configura barra de rolagem dupla (superior e inferior)
  setTimeout(() => {
    const tableWrap = document.getElementById('analise-table-wrap');
    const doubleScroll = document.getElementById('analise-double-scroll');
    const doubleScrollChild = document.getElementById('analise-double-scroll-child');

    if (tableWrap && doubleScroll && doubleScrollChild) {
      doubleScrollChild.style.width = tableWrap.scrollWidth + 'px';

      doubleScroll.onscroll = function() {
        if (tableWrap.scrollLeft !== doubleScroll.scrollLeft) {
          tableWrap.scrollLeft = doubleScroll.scrollLeft;
        }
      };
      tableWrap.onscroll = function() {
        if (doubleScroll.scrollLeft !== tableWrap.scrollLeft) {
          doubleScroll.scrollLeft = tableWrap.scrollLeft;
        }
      };
    }
  }, 50);
}

// Prefills and opens the Create OP Modal from a recommendation
function abrirNovaOPPreenchida(produto, qty, prio2) {
  // Chamamos o preenchimento padrão
  if (typeof openNovaOp === 'function') {
    openNovaOp();
  }

  // Preenchemos os campos específicos
  const modeloSelect = document.getElementById('op-modelo');
  if (modeloSelect) {
    // Tenta encontrar a opção correspondente ao produto
    let found = false;
    for (let i = 0; i < modeloSelect.options.length; i++) {
      if (modeloSelect.options[i].value === produto) {
        modeloSelect.selectedIndex = i;
        found = true;
        break;
      }
    }
    
    // Se não encontrou pelo nome completo, tenta correspondência parcial
    if (!found) {
      for (let i = 0; i < modeloSelect.options.length; i++) {
        if (produto.toLowerCase().includes(modeloSelect.options[i].value.toLowerCase()) ||
            modeloSelect.options[i].value.toLowerCase().includes(produto.toLowerCase())) {
          modeloSelect.selectedIndex = i;
          break;
        }
      }
    }
  }

  const qtyInput = document.getElementById('op-qty');
  if (qtyInput) {
    qtyInput.value = qty;
  }

  const clienteInput = document.getElementById('op-cliente');
  if (clienteInput) {
    clienteInput.value = 'Estoque Interno';
  }

  const prioridadeSelect = document.getElementById('op-prioridade');
  if (prioridadeSelect) {
    if (prio2 !== null && prio2 <= 1.0) {
      prioridadeSelect.value = 'Alta';
    } else {
      prioridadeSelect.value = 'Normal';
    }
  }

  const obsInput = document.getElementById('op-obs');
  if (obsInput) {
    obsInput.value = 'Ordem de produção planejada automaticamente com base na análise de criticidade.';
  }

  // Seta um prazo de entrega padrão para hoje + 7 dias
  const prazoInput = document.getElementById('op-prazo');
  if (prazoInput) {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 7);
    prazoInput.value = defaultDate.toISOString().split('T')[0];
  }

  // Atualiza a pré-visualização de insumos do modal de OP
  if (typeof updateOpInsumosPreview === 'function') {
    updateOpInsumosPreview();
  }
}
window.abrirNovaOPPreenchida = abrirNovaOPPreenchida;

// Exporta a lista de peças com necessidade de produção (Qtd a Produzir > 0) para CSV compatível com Excel
function exportAnaliseToExcel() {
  if (!ANALISE_STATE.loaded || !ANALISE_STATE.coberturaData.length) {
    showToast('Nenhum dado disponível para exportar.', 'error');
    return;
  }

  const targetCoverage = ANALISE_STATE.coberturaAlvo;
  const itemsToProduce = ANALISE_STATE.coberturaData.map(item => {
    const diff = item.estoqueVirtual - (item.mediaMensal * targetCoverage);
    const need = diff < 0 ? Math.ceil(Math.abs(diff) / 10) * 10 : 0;
    return { ...item, need };
  }).filter(item => item.need > 0);

  if (itemsToProduce.length === 0) {
    showToast('Nenhuma peça precisa ser produzida com a meta de cobertura atual.', 'info');
    return;
  }

  const headers = [
    'Geral (Rank)',
    'Produto',
    'SKU',
    'Código Bruto',
    'Estoque Físico',
    'Entradas Previstas',
    'Saídas Previstas',
    'Estoque Virtual',
    'Média Mensal',
    'Cobertura (meses)',
    'Prioridade (Prio2)',
    'Qtd a Produzir',
    'Localização',
    'Bucha'
  ];

  const rows = itemsToProduce.map(item => [
    item.prioridadeGeral,
    item.produto,
    item.sku,
    item.codigoBruto,
    item.estoqueFisico,
    'N/A',
    item.saidasPrevistas,
    item.estoqueVirtual,
    item.mediaMensal.toFixed(2),
    item.coberturaVirtual.toFixed(2),
    item.prio2 !== null ? item.prio2.toFixed(2) : '—',
    item.need,
    item.localizacao,
    item.bucha
  ]);

  const csvContent = "\uFEFF" + [
    headers.join(';'),
    ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Necessidades_Producao_PCP_Cobertura_${targetCoverage}_meses.csv`);
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast(`Lista de ${itemsToProduce.length} peças a produzir exportada com sucesso!`);
}
window.exportAnaliseToExcel = exportAnaliseToExcel;

// Inicialização de Listeners do módulo de Análise de Produção
function initAnaliseListeners() {
  if (ANALISE_STATE.listenersInitialized) return;
  ANALISE_STATE.listenersInitialized = true;

  // 1. Slider de cobertura
  const slider = document.getElementById('analise-months-slider');
  const badge = document.getElementById('analise-months-value');
  if (slider && badge) {
    slider.value = ANALISE_STATE.coberturaAlvo;
    badge.textContent = `${ANALISE_STATE.coberturaAlvo} ${ANALISE_STATE.coberturaAlvo === 1 ? 'mês' : 'meses'}`;

    slider.addEventListener('input', debounce((e) => {
      const val = Number(e.target.value);
      ANALISE_STATE.coberturaAlvo = val;
      badge.textContent = `${val} ${val === 1 ? 'mês' : 'meses'}`;
      RemoteStorage.setItem('hrn_analise_cobertura_alvo', val);
      renderAnaliseTable();
    }, 150));
  }

  // 2. Campo de busca de texto
  const searchInput = document.getElementById('analise-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      ANALISE_STATE.searchText = e.target.value.trim();
      renderAnaliseTable();
    }, 200));
  }

  // 3. Abas de filtros rápidos (KPIs)
  const filterTabs = {
    'analise-filter-all': 'all',
    'analise-filter-critical-tab': 'critical',
    'analise-filter-warning-tab': 'warning',
    'analise-filter-ok': 'ok'
  };

  Object.entries(filterTabs).forEach(([id, type]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        ANALISE_STATE.filterType = type;
        
        // Remove class active de todos
        Object.keys(filterTabs).forEach(keyId => {
          document.getElementById(keyId)?.classList.remove('active');
        });
        
        // Adiciona active no clicado
        el.classList.add('active');
        renderAnaliseTable();
      });
    }
  });

  // 4. Ordenação nas colunas de cabeçalho
  document.querySelectorAll('#analise-table thead th.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.column;
      if (ANALISE_STATE.sortColumn === col) {
        // Inverte direção
        ANALISE_STATE.sortDirection = ANALISE_STATE.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        ANALISE_STATE.sortColumn = col;
        ANALISE_STATE.sortDirection = 'asc';
      }
      renderAnaliseTable();
    });
  });

  // 5. Botão de exportação para Excel
  const btnExportExcel = document.getElementById('btn-analise-export-excel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', (e) => {
      e.preventDefault();
      exportAnaliseToExcel();
    });
  }

  // 6. Botão de sincronização de planilha (Abre seletor de arquivos para importação manual)
  const btnSync = document.getElementById('btn-analise-sync');
  const inpFile = document.getElementById('input-analise-excel');

  if (btnSync && inpFile) {
    btnSync.addEventListener('click', (e) => {
      e.preventDefault();
      inpFile.click();
    });

    inpFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      showToast('Lendo e processando planilha local...', 'info');

      btnSync.disabled = true;
      const originalHTML = btnSync.innerHTML;
      btnSync.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Sincronizando...`;

      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const data = new Uint8Array(evt.target.result);
          processAnaliseExcel(data.buffer);
          showToast('Planilha de Cobertura importada e salva localmente!', 'success');
          renderAnaliseTable();
          if (typeof STATE !== 'undefined') {
            if (STATE.currentPage === 'fluxo' && typeof renderFluxo === 'function') {
              renderFluxo();
            } else if (STATE.currentPage === 'relatorios' && typeof renderRelatorios === 'function') {
              renderRelatorios();
            }
          }
        } catch (err) {
          console.error(err);
          showToast('Erro ao ler a planilha. Certifique-se de que é a planilha CODAN atualizada.', 'error');
        } finally {
          btnSync.disabled = false;
          btnSync.innerHTML = originalHTML;
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    });
  }

  // 7. Botão de ajuda / explicação da aba
  const btnAjuda = document.getElementById('btn-analise-ajuda');
  const modalAjuda = document.getElementById('modal-ajuda-analise');
  const btnAjudaClose = document.getElementById('modal-ajuda-analise-close');
  const btnAjudaFechar = document.getElementById('btn-ajuda-analise-fechar');

  if (btnAjuda && modalAjuda) {
    btnAjuda.addEventListener('click', (e) => {
      e.preventDefault();
      modalAjuda.classList.remove('hidden');
    });
    
    const fechar = (e) => {
      e.preventDefault();
      modalAjuda.classList.add('hidden');
    };
    
    if (btnAjudaClose) btnAjudaClose.addEventListener('click', fechar);
    if (btnAjudaFechar) btnAjudaFechar.addEventListener('click', fechar);
  }

  // 8. Listener de redimensionamento para ajustar largura da rolagem superior
  window.addEventListener('resize', debounce(() => {
    const tableWrap = document.getElementById('analise-table-wrap');
    const doubleScrollChild = document.getElementById('analise-double-scroll-child');
    if (tableWrap && doubleScrollChild) {
      doubleScrollChild.style.width = tableWrap.scrollWidth + 'px';
    }
  }, 100));
}

function seedAnaliseFromCatalogo() {
  return mergeAnaliseWithCatalogo([]);
}

function initAnaliseModule() {
  try {
    initAnaliseListeners();
    const stored = safeGetJSON('hrn_analise_cobertura_data', null);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      ANALISE_STATE.coberturaData = mergeAnaliseWithCatalogo(stored);
    } else if (!ANALISE_STATE.coberturaData || ANALISE_STATE.coberturaData.length === 0) {
      const seeded = seedAnaliseFromCatalogo();
      if (seeded && seeded.length > 0) {
        ANALISE_STATE.coberturaData = seeded;
        RemoteStorage.setItem('hrn_analise_cobertura_data', JSON.stringify(seeded));
      }
    }
    ANALISE_STATE.loaded = true;
    renderAnaliseTable();
  } catch (err) {
    console.error('[ANALISE] Erro na inicialização do módulo:', err);
  }
}

// Expõe inicializadores globalmente para app.js
window.loadAnaliseExcelData = loadAnaliseExcelData;
window.renderAnaliseTable = renderAnaliseTable;
window.initAnaliseListeners = initAnaliseListeners;
window.initAnaliseModule = initAnaliseModule;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnaliseModule);
} else {
  initAnaliseModule();
}
