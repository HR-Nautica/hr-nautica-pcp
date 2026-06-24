/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   estoqueArvore.js  â€“  Estrutura de Itens e Operações (EARV)
   HR Náutica PCP  |  Ãrvore expansível com coluna de estoque
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
'use strict';

/* â”€â”€ Estado global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const EARV = {
  rows:               [],       // todas as linhas brutas
  familyTree:         [],       // árvore organizada [{row, familyKey, components:[{row, materials:[]}]}]
  expandedFamilies:   new Set(),// chaves das famílias expandidas
  expandedComponents: new Set(),// chaves dos componentes expandidos (level-01 com filhos)
  estoqueMap:         {},       // SKU â†’ quantidade em estoque
  saidasPeriodoMap:   {},       // SKU â†’ consumo/saídas no período (coluna M do estoque)
  saidasPrevistasMap: {},       // SKU â†’ saídas previstas (outra planilha)
  estoqueLoaded:      false,
  saidasPrevistasLoaded: false, // flag que indica se planilha de saídas previstas foi importada/carregada
  loaded:             false,
  sortCol:            null,
  sortDir:            'asc'
};

/* â”€â”€ Config das Operações â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const OP = {
  op01: { col:'OP 01 (Compras)',   label:'Compras',   cls:'op01' },
  op02: { col:'OP 02 (Usinagem)',  label:'Usinagem',  cls:'op02' },
  op03: { col:'OP 03 (Cromo)',     label:'Cromo',     cls:'op03' },
  op04: { col:'OP 04 (Pintura)',   label:'Pintura',   cls:'op04' },
  op05: { col:'OP 05 (Montagem)',  label:'Montagem',  cls:'op05' },
  op06: { col:'OP 06 (Embalagem)', label:'Embalagem', cls:'op06' }
};

/* â”€â”€ Converte número de forma robusta (brasileiro/americano) â”€â”€ */
function parseRobustFloat(val) {
  if (typeof val === 'number') return val;
  if (val === null || val === undefined) return NaN;
  
  let str = String(val).trim();
  if (!str) return NaN;
  
  if (str.includes(',')) {
    // Se tem vírgula, assume formato brasileiro (ex: 1.234,56 ou 0,4)
    str = str.replace(/\./g, '').replace(',', '.');
  }
  
  return parseFloat(str);
}

/* â”€â”€ Converte ArrayBuffer da planilha de árvore â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_processTreeExcel(ab) {
  const wb = XLSX.read(ab, { type:'array' });
  const sheetName = wb.SheetNames.includes('arvore') ? 'arvore' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:'' });
  if (!rows || rows.length === 0) throw new Error('Planilha vazia.');
  EARV.rows = rows;
  EARV.familyTree = earv_buildTree(rows);
  EARV.loaded = true;
  try { RemoteStorage.setItem('hrn_estoque_arvore', JSON.stringify(rows)); } catch(e) {}
  return rows.length;
}

/* â”€â”€ Converte ArrayBuffer da planilha de estoque â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_processPCPExcel(ab) {
  const wb = XLSX.read(ab, { type:'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  
  // Lê no formato array de arrays para podermos acessar por coluna física
  const rowsRaw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  const map = {};
  const mapPer = {};
  let count = 0;
  
  if (rowsRaw && rowsRaw.length > 0) {
    // 1. Procura a linha de cabeçalho de forma inteligente
    let headerIdx = -1;
    let colSkuIdx = -1;
    let colStockIdx = -1;
    let colPerIdx = -1;
    
    const skuTerms = ['SKU', 'CÃ“DIGO', 'CODIGO', 'PRODUTO', 'CÃ“D.'];
    const stockTerms = ['ESTOQUE', 'ESTOQUE FÍSICO', 'ESTOQUE FISICO', 'SALDO', 'SALDO ATUAL', 'QTD'];
    const perTerms = ['SAÍDAS PER.', 'SAIDAS PER.', 'SAÍDAS NO PERÍODO', 'SAIDAS NO PERIODO', 'SAÍDAS PERÍODO', 'SAIDAS PERIODO', 'SAÍDAS DO PERÍODO', 'SAIDAS DO PERIODO', 'CONSUMO'];
    
    // Varre as primeiras 15 linhas para achar os cabeçalhos
    for (let r = 0; r < Math.min(rowsRaw.length, 15); r++) {
      const row = rowsRaw[r];
      if (!row || !Array.isArray(row)) continue;
      
      let foundSku = -1;
      let foundStock = -1;
      let foundPer = -1;
      
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toUpperCase();
        if (!val) continue;
        
        if (skuTerms.some(term => val === term || val.startsWith('SKU') || val.startsWith('CÃ“DIGO') || val.startsWith('CODIGO'))) {
          foundSku = c;
        }
        // Evita que 'Estoque mínimo' ou 'Estoque máximo' sobrescrevam o estoque físico principal
        const matchesStock = stockTerms.some(term => val.includes(term));
        const isNotLimits = !val.includes('MÍN') && !val.includes('MIN') && !val.includes('MÃX') && !val.includes('MAX') && !val.includes('VIRTUAL');
        if (matchesStock && isNotLimits) {
          foundStock = c;
        }
        if (perTerms.some(term => val.includes(term))) {
          foundPer = c;
        }
      }
      
      if (foundSku !== -1 && foundStock !== -1) {
        headerIdx = r;
        colSkuIdx = foundSku;
        colStockIdx = foundStock;
        colPerIdx = foundPer;
        console.log(`[PCP] Cabeçalho dinâmico detectado na linha ${r}. SKU na col ${foundSku}, Estoque na col ${foundStock}, Período na col ${foundPer}`);
        break;
      }
    }
    
    // Fallback: se não detectou a linha de cabeçalho, assume colunas físicas B (1), I (8) e M (12)
    if (colSkuIdx === -1 || colStockIdx === -1) {
      console.log(`[PCP] Cabeçalho inteligente não detectado. Usando padrão colunas B (1), I (8) e M (12).`);
      colSkuIdx = 1;
      colStockIdx = 8;
      colPerIdx = 12;
      headerIdx = 0;
    }
    
    if (colPerIdx === -1) {
      colPerIdx = 12; // Fallback para coluna M se não encontrou cabeçalho dela especificamente
    }
    
    // Extrai os dados a partir de headerIdx + 1
    for (let r = headerIdx + 1; r < rowsRaw.length; r++) {
      const row = rowsRaw[r];
      if (!row || row.length <= colSkuIdx) continue;
      
      const skuVal = String(row[colSkuIdx] || '').trim();
      const stockVal = String(row[colStockIdx] || '').trim();
      const perVal = colPerIdx < row.length ? String(row[colPerIdx] || '').trim() : '';
      
      if (skuVal && skuVal !== 'undefined' && skuVal !== '') {
        const skuNorm = skuVal.toUpperCase();
        
        const stock = parseRobustFloat(stockVal);
        if (!isNaN(stock)) {
          map[skuNorm] = stock;
          count++;
        }
        
        if (perVal !== '') {
          const per = parseRobustFloat(perVal);
          if (!isNaN(per)) {
            mapPer[skuNorm] = per;
          }
        }
      }
    }
  }

  // 2. Fallback por chaves nomeadas do objeto para NecessidadePCP tradicional
  if (count === 0) {
    const rowsObj = XLSX.utils.sheet_to_json(ws, { defval:'' });
    rowsObj.forEach(r => {
      const sku = String(r['Código'] || r['Codigo'] || r['SKU'] || r['Código (SKU)'] || '').trim().toUpperCase();
      const rawStock = r['Estoque físico'] ?? r['Estoque Físico'] ?? r['Estoque fisico'] ??
                       r['Saldo Atual'] ?? r['saldo_atual'] ?? r['estoque'] ?? r['Estoque'] ?? '';
      const rawPer = r['Saídas Per.'] ?? r['Saídas per.'] ?? r['saídas per.'] ?? r['Saídas no Período'] ?? r['Saídas no período'] ?? r['Saidas no Periodo'] ?? 
                     r['saidas_no_periodo'] ?? r['Consumo'] ?? r['Média Mensal'] ?? r['media_mensal'] ?? '';
      
      if (sku && sku !== 'UNDEFINED') {
        if (rawStock !== '') {
          const stock = parseRobustFloat(rawStock);
          if (!isNaN(stock)) {
            map[sku] = stock;
            count++;
          }
        }
        if (rawPer !== '') {
          const per = parseRobustFloat(rawPer);
          if (!isNaN(per)) {
            mapPer[sku] = per;
          }
        }
      }
    });
  }

  EARV.saidasPeriodoMap = mapPer;
  EARV.estoqueMap = map;
  EARV.estoqueLoaded = true;
  try {
    RemoteStorage.setItem('hrn_earv_estoque', JSON.stringify(map));
    RemoteStorage.setItem('hrn_earv_saidas_periodo', JSON.stringify(mapPer));
  } catch(e) {}
  return count;
}

/* â”€â”€ Converte ArrayBuffer da planilha de Saídas Previstas â”€â”€â”€â”€â”€â”€ */
function earv_processSaidasPrevistasExcel(ab) {
  const wb = XLSX.read(ab, { type:'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  
  // Lê no formato array de arrays
  const rowsRaw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  
  const map = {};
  let count = 0;
  
  if (rowsRaw && rowsRaw.length > 0) {
    let headerIdx = -1;
    let colSkuIdx = -1;
    let colPrevIdx = -1;
    
    const skuTerms = ['SKU', 'CÃ“DIGO', 'CODIGO', 'PRODUTO', 'CÃ“D.'];
    const prevTerms = ['SAÍDAS PREVISTAS', 'SAIDAS PREVISTAS', 'VENDIDO', 'SAÍDAS', 'SAIDAS', 'QTD PREVISTA', 'QUANTIDADE PREVISTA'];
    
    // Varre as primeiras 15 linhas para achar os cabeçalhos
    for (let r = 0; r < Math.min(rowsRaw.length, 15); r++) {
      const row = rowsRaw[r];
      if (!row || !Array.isArray(row)) continue;
      
      let foundSku = -1;
      let foundPrev = -1;
      
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toUpperCase();
        if (!val) continue;
        
        if (skuTerms.some(term => val === term || val.startsWith('SKU') || val.startsWith('CÃ“DIGO') || val.startsWith('CODIGO'))) {
          foundSku = c;
        }
        if (prevTerms.some(term => val.includes(term))) {
          foundPrev = c;
        }
      }
      
      if (foundSku !== -1 && foundPrev !== -1) {
        headerIdx = r;
        colSkuIdx = foundSku;
        colPrevIdx = foundPrev;
        console.log(`[PCP] Cabeçalho de Saídas Previstas detectado na linha ${r}. SKU na col ${foundSku}, Saídas na col ${foundPrev}`);
        break;
      }
    }
    
    // Fallback: assume B (1) e C (2)
    if (colSkuIdx === -1 || colPrevIdx === -1) {
      console.log(`[PCP] Cabeçalho inteligente de Saídas Previstas não detectado. Usando colunas padrão B (1) e C (2).`);
      colSkuIdx = 1;
      colPrevIdx = 2;
      headerIdx = 0;
    }
    
    // Extrai dados
    for (let r = headerIdx + 1; r < rowsRaw.length; r++) {
      const row = rowsRaw[r];
      if (!row || row.length <= colSkuIdx) continue;
      
      const skuVal = String(row[colSkuIdx] || '').trim();
      const prevVal = colPrevIdx < row.length ? String(row[colPrevIdx] || '').trim() : '';
      
      if (skuVal && skuVal !== 'undefined' && skuVal !== '') {
        const skuNorm = skuVal.toUpperCase();
        const prev = parseRobustFloat(prevVal);
        if (!isNaN(prev)) {
          map[skuNorm] = prev;
          count++;
        }
      }
    }
  }
  
  // Fallback por chaves de objeto
  if (count === 0) {
    const rowsObj = XLSX.utils.sheet_to_json(ws, { defval:'' });
    rowsObj.forEach(r => {
      const sku = String(r['Código'] || r['Codigo'] || r['SKU'] || r['Código (SKU)'] || '').trim().toUpperCase();
      const rawPrev = r['Saídas Previstas'] ?? r['Saídas previstas'] ?? r['Saidas Previstas'] ?? 
                      r['saidas_previstas'] ?? r['Saídas'] ?? r['Saidas'] ?? r['Vendido'] ?? r['vendido'] ?? '';
      
      if (sku && sku !== 'UNDEFINED' && rawPrev !== '') {
        const prev = parseRobustFloat(rawPrev);
        if (!isNaN(prev)) {
          map[sku] = prev;
          count++;
        }
      }
    });
  }
  
  EARV.saidasPrevistasMap = map;
  EARV.saidasPrevistasLoaded = true;
  try {
    RemoteStorage.setItem('hrn_earv_saidas_previstas', JSON.stringify(map));
  } catch(e) {}
  return count;
}

/* â”€â”€ Constrói a árvore de famílias â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_buildTree(rows) {
  const families = [];
  let curFam  = null;
  let curComp = null;

  rows.forEach(r => {
    const pos = String(r['Posição'] ?? '').trim();
    if (pos === '00') {
      curFam  = { row: r, familyKey: r['Chave_Familia'] || r['SKU'], components: [] };
      curComp = null;
      families.push(curFam);
    } else if (pos === '01') {
      curComp = { row: r, compKey: (curFam?.familyKey || '') + '|' + r['SKU'], materials: [] };
      if (curFam) curFam.components.push(curComp);
    } else if (pos === '02') {
      if (curComp) curComp.materials.push(r);
    }
  });
  return families;
}

/* â”€â”€ Filtra famílias de acordo com busca / nível / operação â”€â”€â”€ */
function earv_getFiltered() {
  const search = (document.getElementById('estoque-arv-search')?.value || '').toLowerCase().trim();
  const posF   = document.getElementById('estoque-arv-filter-pos')?.value   || 'all';
  const opF    = document.getElementById('estoque-arv-filter-op')?.value    || 'all';

  let fams = EARV.familyTree;

  /* Filtro de texto â€“ inclui a família se QUALQUER linha bater */
  if (search) {
    fams = fams.filter(fam => {
      const allRows = [fam.row, ...fam.components.flatMap(c => [c.row, ...c.materials])];
      return allRows.some(r =>
        String(r['SKU']       || '').toLowerCase().includes(search) ||
        String(r['Descrição'] || '').toLowerCase().includes(search)
      );
    });
  }

  /* Filtro de operação â€“ inclui família se QUALQUER linha tiver a op */
  if (opF !== 'all' && OP[opF]) {
    const col = OP[opF].col;
    fams = fams.filter(fam => {
      const allRows = [fam.row, ...fam.components.flatMap(c => [c.row, ...c.materials])];
      return allRows.some(r => { const v = String(r[col]||'').trim(); return v && v !== '-'; });
    });
  }

  /* Filtro de nível â€“ aplica somente no modo de exibição, não no filtro de famílias */
  if (posF !== 'all') {
    if (posF === '00') {
      // mantém apenas famílias (rende só a linha 00)
    } else if (posF === '01') {
      fams = fams.filter(f => f.components.length > 0);
    } else if (posF === '02') {
      fams = fams.filter(f => f.components.some(c => c.materials.length > 0));
    }
  }

  /* Ordenação */
  if (EARV.sortCol) {
    const dir = EARV.sortDir === 'asc' ? 1 : -1;
    fams = [...fams].sort((a, b) => {
      let av = '', bv = '';
      if (EARV.sortCol === 'desc')    { av = a.row['Descrição']||''; bv = b.row['Descrição']||''; }
      if (EARV.sortCol === 'sku')     { av = a.row['SKU']||''; bv = b.row['SKU']||''; }
      if (EARV.sortCol === 'estoque') {
        av = EARV.estoqueMap[String(a.row['SKU']||'').trim().toUpperCase()] ?? -1;
        bv = EARV.estoqueMap[String(b.row['SKU']||'').trim().toUpperCase()] ?? -1;
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), 'pt-BR') * dir;
    });
  }

  return fams;
}

/* â”€â”€ Renderiza badge de operação â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_opBadge(val, opKey) {
  const v = String(val || '').trim();
  if (!v || v === '-') return '<span class="earv-dash">â€”</span>';
  return `<span class="earv-op-badge earv-op-badge--${OP[opKey].cls}">${v}</span>`;
}

/* â”€â”€ Renderiza célula de estoque â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_stockCell(sku) {
  if (!EARV.estoqueLoaded) return '<span class="earv-dash" title="Clique em Sincronizar Estoque">â€”</span>';
  const skuNorm = String(sku || '').trim().toUpperCase();
  const s = EARV.estoqueMap[skuNorm];
  if (s === undefined) return '<span class="earv-dash">?</span>';
  if (s <= 0)  return `<span class="earv-stock earv-stock--zero">0</span>`;
  return `<span class="earv-stock earv-stock--ok">${Number(s % 1 === 0 ? s : s.toFixed(2))}</span>`;
}

/* â”€â”€ Atualiza KPIs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_updateKpis() {
  const fams = EARV.familyTree;
  const allRows = EARV.rows;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // KPIs de estoque (somente level-00)
  const level00 = fams.map(f => String(f.row['SKU']||'').trim());
  let comEstoque = 0, semEstoque = 0;
  if (EARV.estoqueLoaded) {
    level00.forEach(sku => {
      const s = EARV.estoqueMap[sku.toUpperCase()];
      if (s !== undefined) { if (s > 0) comEstoque++; else semEstoque++; }
    });
  }

  const count = (col) => allRows.filter(r => { const v = String(r[col]||'').trim(); return v && v !== '-'; }).length;

  set('kpi-arv-total',        allRows.length);
  set('kpi-arv-familias',     fams.length);
  set('kpi-arv-com-estoque',  comEstoque);
  set('kpi-arv-sem-estoque',  semEstoque);
  set('kpi-arv-op01', count(OP.op01.col));
  set('kpi-arv-op02', count(OP.op02.col));
  set('kpi-arv-op03', count(OP.op03.col));
  set('kpi-arv-op04', count(OP.op04.col));
  set('kpi-arv-op05', count(OP.op05.col));
  set('kpi-arv-op06', count(OP.op06.col));
}

/* â”€â”€ Renderiza linha nível 00 (Item Final) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_rowLevel00(fam, isExpanded, hasChildrenOverride) {
  const r    = fam.row;
  const sku  = String(r['SKU']||'').trim();
  const desc = String(r['Descrição']||'').trim();
  const qty  = r['Quantidade'] ?? '';
  const hasChildren = hasChildrenOverride !== undefined ? hasChildrenOverride : fam.components.length > 0;
  const toggleIcon  = hasChildren ? (isExpanded ? 'â–¼' : 'â–¶') : '';
  const expandClass = isExpanded ? 'earv-expanded' : '';

  return `
  <tr class="earv-row-00 ${expandClass}" data-family="${fam.familyKey}" style="cursor:${hasChildren?'pointer':'default'};"
    onclick="earv_toggleFamily('${fam.familyKey.replace(/'/g,"\\'")}')">
    <td class="earv-td earv-td--desc">
      <div class="earv-desc-wrap">
        <span class="earv-toggle-btn ${hasChildren?'':'earv-toggle-invisible'}">${toggleIcon}</span>
        <span class="earv-desc-text earv-desc--00">${desc}</span>
      </div>
    </td>
    <td class="earv-td earv-td--sku earv-sku--00">${sku}</td>
    <td class="earv-td"><span class="earv-nivel-badge earv-nivel--00">Item Final</span></td>
    <td class="earv-td earv-td--num">${qty}</td>
    <td class="earv-td earv-td--estoque" onclick="event.stopPropagation()">${earv_stockCell(sku)}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op01.col],'op01')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op02.col],'op02')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op03.col],'op03')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op04.col],'op04')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op05.col],'op05')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op06.col],'op06')}</td>
  </tr>`;
}

/* â”€â”€ Renderiza linha nível 01 (Componente) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_rowLevel01(comp, isExpanded, hasMatOverride) {
  const r    = comp.row;
  const sku  = String(r['SKU']||'').trim();
  const desc = String(r['Descrição']||'').trim();
  const qty  = r['Quantidade'] ?? '';
  const hasMat = hasMatOverride !== undefined ? hasMatOverride : comp.materials.length > 0;
  const toggleIcon = hasMat ? (isExpanded ? 'â–¼' : 'â–¶') : '';

  return `
  <tr class="earv-row-01" data-comp="${comp.compKey}" style="cursor:${hasMat?'pointer':'default'};"
    onclick="${hasMat ? `earv_toggleComp('${comp.compKey.replace(/'/g,"\\'")}')` : ''}">
    <td class="earv-td earv-td--desc">
      <div class="earv-desc-wrap earv-indent-01">
        <span class="earv-toggle-btn earv-toggle-sm ${hasMat?'':'earv-toggle-invisible'}">${toggleIcon}</span>
        <span class="earv-arrow">â†³</span>
        <span class="earv-desc-text earv-desc--01">${desc}</span>
      </div>
    </td>
    <td class="earv-td earv-td--sku earv-sku--01">${sku}</td>
    <td class="earv-td"><span class="earv-nivel-badge earv-nivel--01">Componente</span></td>
    <td class="earv-td earv-td--num">${qty}</td>
    <td class="earv-td earv-td--estoque" onclick="event.stopPropagation()">${earv_stockCell(sku)}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op01.col],'op01')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op02.col],'op02')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op03.col],'op03')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op04.col],'op04')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op05.col],'op05')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op06.col],'op06')}</td>
  </tr>`;
}

/* â”€â”€ Renderiza linha nível 02 (Material) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_rowLevel02(r) {
  const sku  = String(r['SKU']||'').trim();
  const desc = String(r['Descrição']||'').trim();
  const qty  = r['Quantidade'] ?? '';

  return `
  <tr class="earv-row-02">
    <td class="earv-td earv-td--desc">
      <div class="earv-desc-wrap earv-indent-02">
        <span class="earv-arrow earv-arrow--muted">â†³</span>
        <span class="earv-desc-text earv-desc--02">${desc}</span>
      </div>
    </td>
    <td class="earv-td earv-td--sku earv-sku--02">${sku}</td>
    <td class="earv-td"><span class="earv-nivel-badge earv-nivel--02">Material</span></td>
    <td class="earv-td earv-td--num">${qty}</td>
    <td class="earv-td earv-td--estoque">${earv_stockCell(sku)}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op01.col],'op01')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op02.col],'op02')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op03.col],'op03')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op04.col],'op04')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op05.col],'op05')}</td>
    <td class="earv-td">${earv_opBadge(r[OP.op06.col],'op06')}</td>
  </tr>`;
}

/* â”€â”€ Auxiliar para checar se linha atende aos filtros â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_rowMatches(row, search, opF) {
  if (search) {
    const sku = String(row['SKU'] || '').toLowerCase();
    const desc = String(row['Descrição'] || '').toLowerCase();
    if (!sku.includes(search) && !desc.includes(search)) {
      return false;
    }
  }
  if (opF !== 'all' && OP[opF]) {
    const col = OP[opF].col;
    const val = String(row[col] || '').trim();
    if (!val || val === '-') {
      return false;
    }
  }
  return true;
}

/* â”€â”€ Renderiza toda a tabela â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_render() {
  const tbody = document.getElementById('estoque-arv-body');
  const count = document.getElementById('estoque-arv-count');
  if (!tbody) return;

  if (!EARV.loaded) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-cell" style="padding:3rem;font-size:1rem;">
      â˜ï¸ Clique em <strong>Sync Ãrvore</strong> para importar <code>fabri1_arvore_com_chave_familia.xlsx</code>
    </td></tr>`;
    if (count) count.textContent = 'â€” itens';
    return;
  }

  const search = (document.getElementById('estoque-arv-search')?.value || '').toLowerCase().trim();
  const posF   = document.getElementById('estoque-arv-filter-pos')?.value || 'all';
  const opF    = document.getElementById('estoque-arv-filter-op')?.value || 'all';

  const fams = earv_getFiltered();
  const html = [];
  let totalVisible = 0;

  const hasFilter = (search !== '' || opF !== 'all');

  fams.forEach(fam => {
    // 1. Filtrar componentes e materiais de acordo com os filtros ativos
    const filteredComponents = [];
    
    fam.components.forEach(comp => {
      const matchedMaterials = comp.materials.filter(mat => earv_rowMatches(mat, search, opF));
      const compMatchesSelf  = earv_rowMatches(comp.row, search, opF);
      
      if (!hasFilter || compMatchesSelf || matchedMaterials.length > 0) {
        filteredComponents.push({
          comp,
          compMatchesSelf,
          matchedMaterials
        });
      }
    });

    const famMatchesSelf = earv_rowMatches(fam.row, search, opF);
    
    // Ocultar a família inteira se não houver match nela nem nos descendentes
    if (hasFilter && !famMatchesSelf && filteredComponents.length === 0) {
      return;
    }

    // 2. Determinar estado de expansão
    // Auto-expande famílias se houver filtros ativos ("explode a árvore")
    let isExpanded = false;
    if (hasFilter) {
      isExpanded = filteredComponents.length > 0;
    } else {
      isExpanded = EARV.expandedFamilies.has(fam.familyKey);
    }

    totalVisible++;

    // Linha nível 00 (Item Final)
    if (posF === 'all' || posF === '00' || posF === '01' || posF === '02') {
      const hasChildren = filteredComponents.length > 0;
      html.push(earv_rowLevel00(fam, isExpanded, hasChildren));
    }

    // Renderizar sub-elementos se expandido
    if (isExpanded || posF === '01' || posF === '02') {
      filteredComponents.forEach(({ comp, compMatchesSelf, matchedMaterials }) => {
        let compExpanded = false;
        if (hasFilter) {
          compExpanded = matchedMaterials.length > 0;
        } else {
          compExpanded = EARV.expandedComponents.has(comp.compKey);
        }

        totalVisible++;

        if (posF === 'all' || posF === '01' || posF === '02') {
          const hasMat = matchedMaterials.length > 0;
          html.push(earv_rowLevel01(comp, compExpanded, hasMat));
        }

        if ((isExpanded && compExpanded) || posF === '02') {
          matchedMaterials.forEach(mat => {
            totalVisible++;
            html.push(earv_rowLevel02(mat));
          });
        }
      });
    }
  });

  if (html.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-cell">Nenhum item encontrado com esses filtros.</td></tr>';
  } else {
    tbody.innerHTML = html.join('');
  }

  if (count) {
    count.textContent = `${fams.length} ${fams.length === 1 ? 'família' : 'famílias'} Â· ${totalVisible} linhas`;
  }
  earv_updateKpis();
  earv_updateSortHeaders();
}

/* â”€â”€ Toggle árvore de família â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_toggleFamily(key) {
  if (EARV.expandedFamilies.has(key)) EARV.expandedFamilies.delete(key);
  else EARV.expandedFamilies.add(key);
  earv_render();
}

/* â”€â”€ Toggle componente (nível 01) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_toggleComp(key) {
  if (EARV.expandedComponents.has(key)) EARV.expandedComponents.delete(key);
  else EARV.expandedComponents.add(key);
  earv_render();
}

/* â”€â”€ Expandir / Recolher Tudo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_expandAll() {
  EARV.familyTree.forEach(f => {
    EARV.expandedFamilies.add(f.familyKey);
    f.components.forEach(c => EARV.expandedComponents.add(c.compKey));
  });
  earv_render();
}
function earv_collapseAll() {
  EARV.expandedFamilies.clear();
  EARV.expandedComponents.clear();
  earv_render();
}

/* â”€â”€ Atualiza ícones de ordenação nos headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_updateSortHeaders() {
  document.querySelectorAll('.earv-th.earv-sortable').forEach(th => {
    const col = th.dataset.col;
    const icon = th.querySelector('.earv-sort-icon');
    if (!icon) return;
    if (col === EARV.sortCol) {
      icon.textContent = EARV.sortDir === 'asc' ? 'â†‘' : 'â†“';
      th.classList.add('earv-th--sorted');
    } else {
      icon.textContent = 'â‡…';
      th.classList.remove('earv-th--sorted');
    }
  });
}

/* â”€â”€ Carrega do RemoteStorage se disponível â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_loadFromCache() {
  try {
    const cached = RemoteStorage.getItem('hrn_estoque_arvore');
    if (cached) {
      const rows = JSON.parse(cached);
      if (Array.isArray(rows) && rows.length > 0) {
        EARV.rows = rows;
        EARV.familyTree = earv_buildTree(rows);
        EARV.loaded = true;
      }
    }
    const estMap = RemoteStorage.getItem('hrn_earv_estoque');
    if (estMap) {
      const m = JSON.parse(estMap);
      if (m && typeof m === 'object') { EARV.estoqueMap = m; EARV.estoqueLoaded = true; }
    }
    const perMap = RemoteStorage.getItem('hrn_earv_saidas_periodo');
    if (perMap) {
      const m = JSON.parse(perMap);
      if (m && typeof m === 'object') { EARV.saidasPeriodoMap = m; }
    }
    const prevMap = RemoteStorage.getItem('hrn_earv_saidas_previstas');
    if (prevMap) {
      const m = JSON.parse(prevMap);
      if (m && typeof m === 'object') { EARV.saidasPrevistasMap = m; EARV.saidasPrevistasLoaded = true; }
    }
  } catch(e) {}
}

/* â”€â”€ Tenta carregar via fetch (servidor local) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function earv_tryServerLoad() { return false; }

/* â”€â”€ Lê arquivo genérico (FileReader helper) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_readFile(file, onAb) {
  const reader = new FileReader();
  reader.onload = e => onAb(e.target.result);
  reader.onerror = () => { if (typeof showToast === 'function') showToast('Falha ao ler o arquivo.','error'); };
  reader.readAsArrayBuffer(file);
}

/* â”€â”€ Spinner helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn._origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Carregandoâ€¦`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._origHTML || btn.innerHTML;
  }
}

/* â”€â”€ Inicializa todos os eventos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function earv_initEvents() {

  /* Sync Ãrvore */
  const btnArv  = document.getElementById('btn-estoque-arv-sync');
  const inputArv = document.getElementById('input-estoque-arv-file');
  if (btnArv && inputArv) {
    btnArv.addEventListener('click', () => inputArv.click());
    inputArv.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      earv_setLoading(btnArv, true);
      earv_readFile(f, ab => {
        try {
          const n = earv_processTreeExcel(ab);
          if (typeof showToast === 'function') showToast(`âœ… Ãrvore carregada: ${n} linhas!`, 'success');
          earv_render();
        } catch(err) {
          if (typeof showToast === 'function') showToast('âŒ Erro ao importar a árvore.','error');
        } finally {
          earv_setLoading(btnArv, false);
          e.target.value = '';
        }
      });
    });
  }

  /* Sincronizar Estoque */
  const btnEst   = document.getElementById('btn-estoque-sync-estoque');
  const inputEst = document.getElementById('input-estoque-sync-file');
  if (btnEst && inputEst) {
    btnEst.addEventListener('click', () => {
      inputEst.click();
    });
    inputEst.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      earv_setLoading(btnEst, true);
      earv_readFile(f, ab => {
        try {
          const n = earv_processPCPExcel(ab);
          if (typeof showToast === 'function') showToast(`âœ… Estoque carregado: ${n} SKUs!`, 'success');
          earv_render();
          
          // Propaga a atualização de estoque físico para as abas V.I.N.I e Análise de Produção
          if (typeof reprocessNecessidadeData === 'function') reprocessNecessidadeData();
          if (typeof renderViniTable === 'function') renderViniTable();
          if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
        } catch(err) {
          if (typeof showToast === 'function') showToast('âŒ Erro ao ler o arquivo de estoque.','error');
        } finally {
          earv_setLoading(btnEst, false);
          e.target.value = '';
        }
      });
    });
  }

  /* Sincronizar Saídas Previstas */
  const btnPrev   = document.getElementById('btn-estoque-sync-saidas-previstas');
  const inputPrev = document.getElementById('input-estoque-sync-saidas-previstas-file');
  if (btnPrev && inputPrev) {
    btnPrev.addEventListener('click', () => {
      inputPrev.click();
    });
    inputPrev.addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      earv_setLoading(btnPrev, true);
      earv_readFile(f, ab => {
        try {
          const n = earv_processSaidasPrevistasExcel(ab);
          if (typeof showToast === 'function') showToast(`âœ… Saídas Previstas carregadas: ${n} SKUs!`, 'success');
          
          // Propaga atualização para V.I.N.I e Análise de Produção
          if (typeof reprocessNecessidadeData === 'function') reprocessNecessidadeData();
          if (typeof renderViniTable === 'function') renderViniTable();
          if (typeof renderAnaliseTable === 'function') renderAnaliseTable();
        } catch(err) {
          if (typeof showToast === 'function') showToast('âŒ Erro ao ler planilha de Saídas Previstas.','error');
        } finally {
          earv_setLoading(btnPrev, false);
          e.target.value = '';
        }
      });
    });
  }

  /* Expandir / Recolher Tudo */
  document.getElementById('btn-earv-expand-all')?.addEventListener('click', earv_expandAll);
  document.getElementById('btn-earv-collapse-all')?.addEventListener('click', earv_collapseAll);

  /* Busca com debounce */
  let debTimer;
  document.getElementById('estoque-arv-search')?.addEventListener('input', () => {
    clearTimeout(debTimer);
    debTimer = setTimeout(earv_render, 150);
  });

  /* Filtros */
  document.getElementById('estoque-arv-filter-pos')?.addEventListener('change', earv_render);
  document.getElementById('estoque-arv-filter-op')?.addEventListener('change',  earv_render);

  /* Click nos headers para ordenar */
  document.querySelectorAll('.earv-th.earv-sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (EARV.sortCol === col) {
        EARV.sortDir = EARV.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        EARV.sortCol = col;
        EARV.sortDir = 'asc';
      }
      earv_render();
    });
  });

  /* Click nos KPI chips para filtrar por operação */
  const opMap = {
    'kpi-arv-op01': 'op01', 'kpi-arv-op02': 'op02', 'kpi-arv-op03': 'op03',
    'kpi-arv-op04': 'op04', 'kpi-arv-op05': 'op05', 'kpi-arv-op06': 'op06'
  };
  Object.entries(opMap).forEach(([chipId, opKey]) => {
    const chip = document.getElementById(chipId)?.closest('.earv-kpi-chip');
    if (chip) {
      chip.style.cursor = 'pointer';
      chip.title = `Clique para filtrar por ${OP[opKey].label}`;
      chip.addEventListener('click', () => {
        const sel = document.getElementById('estoque-arv-filter-op');
        if (!sel) return;
        sel.value = (sel.value === opKey) ? 'all' : opKey;
        earv_render();
      });
    }
  });

  /* Click nos chips de nível de estoque para filtrar */
  ['kpi-arv-com-estoque', 'kpi-arv-sem-estoque'].forEach(id => {
    const chip = document.getElementById(id)?.closest('.earv-kpi-chip');
    if (chip) chip.style.cursor = 'pointer';
  });
}

/* â”€â”€ Inicialização principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function earv_init() {
  earv_loadFromCache();
  const fromServer = await earv_tryServerLoad();
  earv_initEvents();
  earv_render();
}

document.addEventListener('DOMContentLoaded', earv_init);
// Expor globalmente para eventos onclick inline e outros módulos
window.earv_toggleFamily = earv_toggleFamily;
window.earv_toggleComp   = earv_toggleComp;
window.EARV              = EARV;
window.OP                = OP;


