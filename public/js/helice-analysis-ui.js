/* Usa o contrato central do catálogo; parâmetros só são confirmados no servidor. */
function installAnalysisSync(page) {
  const scopes = { 'analysis-helice': 'helices', 'analysis-brutos': 'brutos', 'analysis-buchas': 'buchas', 'analysis-componentes': 'componentes' };
  $('page-actions').innerHTML = '<button class="secondary" id="analysis-sync">Sincronizar Tiny</button>';
  $('analysis-sync').onclick = () => renderStockSync({ scope: scopes[page], returnPage: page });
}

async function renderHeliceAnalysis() {
  const data = await request('/api/catalog/analysis/helices');
  if (document.querySelector('nav button.active')?.dataset.page !== 'analysis-helice') return;
  installAnalysisSync('analysis-helice');
  const reload = document.createElement('button'); reload.className = 'secondary'; reload.textContent = 'Atualizar análise'; reload.onclick = () => render(); $('page-actions').prepend(reload);
  const labels = [
    ['Prioridade GERAL', 'general_priority'], ['Produto', 'description'], ['Código (SKU)', 'primary_sku'], ['Código Bruto', 'raw_code'],
    ['Entradas previstas (em Produção)', 'incoming_quantity'], ['Saídas previstas (Vendido)', 'expected_outgoing_quantity'],
    ['Estoque físico', 'physical_quantity'], ['Estoque 1', 'stock_one_quantity'], ['Estoque virtual', 'virtual_quantity'],
    ['Saídas do período (máximo histórico)', 'period_outgoing_quantity'], ['Média mensal', 'monthly_average'], ['Prio2', 'prio2'],
    ['Cobertura Est. Virtual', 'coverage_months'], ['Colocar OP', 'suggested_op'], [`entrar Estoque (${data.parameters.targetMonths} meses)`, 'target_stock_quantity']
  ];
  const params = new URLSearchParams(location.search);
  let visible = HeliceTableView.visibleColumns(labels.map(([,key])=>key),params.get('helice_columns'));
  let statusFilter='all';
  const statuses=new Map(data.items.map(item=>[item.id,HeliceTableView.stockStatus(item,data.parameters.targetMonths)]));
  const persistColumns=()=>{const url=new URL(location.href);url.searchParams.set('helice_columns',visible.join(','));history.replaceState(null,'',url);};
  let sort = params.get('helice_sort') || 'general_priority', descending = params.get('helice_desc') === '1';
  if (!labels.some(([, key]) => key === sort)) sort = 'general_priority';
  const quantity = value => value === null || value === undefined ? 'Não informado' : Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const item of data.items) item.raw_code = [...new Set(item.raw_products.map(raw => raw.sku))].join(' / ');
  $('content').innerHTML = `<section class="card analysis-controls"><form id="coverage-parameters"><label>Entrar estoque (meses)<input name="targetMonths" type="number" min="0.01" max="120" step="any" required value="${data.parameters.targetMonths}"></label><label>Fator correção média<input name="averageFactor" type="number" min="0.01" max="100" step="any" required value="${data.parameters.averageFactor}"></label><label>Produção (meses)<input name="productionMonths" type="number" min="0.01" max="120" step="any" required value="${data.parameters.productionMonths}"></label><button>Salvar parâmetros e recalcular</button></form><div class="analysis-search"><label>Buscar hélices<input id="helice-search" type="search" placeholder="Produto, SKU ou código bruto"></label><span id="helice-count" role="status"></span></div><p class="analysis-hint">Prioridade automática: menor Prio2 primeiro, desempate por SKU. Parâmetros compartilhados por todos os usuários.</p><p id="coverage-save-status" role="status" aria-live="polite"></p></section><details class="analysis-formulas"><summary>Como os cálculos funcionam</summary><p>Estoque 1 = físico − vendido. Virtual = Estoque 1 + produção em aberto. Média = média Tiny × fator. Cobertura = virtual ÷ média (média zero: 6, conforme a planilha). Colocar OP sugere a falta para o horizonte de produção, arredondada para cima em dezenas. Entrar estoque = máximo entre zero e (média × meses de estoque − Estoque 1).</p><p>Prio2: Estoque 1 negativo → −1; senão, média menor que 2 → 5; demais → Estoque 1 ÷ média, truncado em uma casa. A exceção de descrição “max.” da planilha retorna zero. Dados ausentes não são convertidos em saldo zero.</p></details><p class="analysis-hint">${data.ordersAvailable ? 'OPs abertas organizadas da etapa mais avançada para a menos avançada.' : 'Entradas previstas aguardam as novas OPs de hélices. Até lá, a projeção considera produção zero.'} “Colocar OP” é uma sugestão calculada; não abre uma ordem automaticamente.</p><div class="card table-wrap helice-analysis-wrap" tabindex="0" role="region" aria-label="Análise de Hélices; role horizontalmente para ver todas as colunas"><table class="stock-table helice-analysis-table"><thead><tr></tr></thead><tbody></tbody></table></div>`;
  const table = $('content').querySelector('.helice-analysis-table');
  const parameterForm=$('coverage-parameters'),settings=document.createElement('details');settings.className='analysis-settings';settings.innerHTML=`<summary>Parâmetros de cálculo <span>Meta: ${data.parameters.targetMonths} meses · Produção: ${data.parameters.productionMonths} meses</span></summary>`;parameterForm.before(settings);settings.append(parameterForm);
  const tools=document.createElement('section');tools.className='analysis-table-tools';
  tools.setAttribute('aria-label','Visualização da análise');
  tools.innerHTML=`<div class="analysis-status-filters" id="analysis-status-filters"></div><details class="analysis-columns"><summary>Colunas <span id="analysis-column-count"></span></summary><div class="analysis-column-panel"><div class="analysis-view-presets"><button type="button" class="secondary" id="analysis-essential">Essenciais</button><button type="button" class="secondary" id="analysis-all">Todas</button></div><p>Prioridade e Produto permanecem visíveis.</p><div class="analysis-column-options">${labels.map(([label,key])=>`<label><input type="checkbox" data-column="${key}" ${visible.includes(key)?'checked':''} ${['general_priority','description'].includes(key)?'disabled':''}><span>${escapeHtml(label)}</span></label>`).join('')}</div></div></details>`;
  table.closest('.table-wrap').before(tools);
  const caption=document.createElement('p');caption.className='analysis-table-caption';caption.textContent=`Alertas de cobertura usam a meta de ${data.parameters.targetMonths} meses. Role a tabela para ver mais colunas →`;tools.after(caption);
  const widths={general_priority:112,description:310,primary_sku:160,raw_code:155,period_outgoing_quantity:165,target_stock_quantity:160,coverage_months:145};
  const renderFilters=()=>{
    const groups=[['all','Todas'],['empty','Sem estoque'],['committed','Vendido acima do físico'],['low','Abaixo da meta'],['unknown','Sem informação']];
    $('analysis-status-filters').innerHTML=groups.map(([key,label])=>`<button type="button" class="analysis-filter ${key===statusFilter?'is-selected':''}" data-stock-status="${key}" aria-pressed="${key===statusFilter}">${label}<span>${key==='all'?data.items.length:data.items.filter(item=>statuses.get(item.id).key===key).length}</span></button>`).join('');
    $('analysis-status-filters').querySelectorAll('[data-stock-status]').forEach(button=>button.onclick=()=>{statusFilter=button.dataset.stockStatus;renderFilters();refresh();$('analysis-status-filters').querySelector(`[data-stock-status="${statusFilter}"]`).focus();});
  };
  const refresh = () => {
    if(!visible.includes(sort)){sort='general_priority';descending=false;}
    const normalize = CatalogQuery.normalize, query = normalize($('helice-search').value);
    const items = data.items.filter(item => (statusFilter==='all'||statuses.get(item.id).key===statusFilter)&&(!query || [item.description, item.primary_sku, item.raw_code].some(value => normalize(value).includes(query))));
    const textFields = ['description', 'primary_sku', 'raw_code'];
    items.sort((a, b) => {
      const av = a[sort], bv = b[sort], missing = v => v === null || v === undefined || v === '';
      if (missing(av) !== missing(bv)) return missing(av) ? 1 : -1;
      const compared = textFields.includes(sort) ? String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR') : Number(av ?? 0) - Number(bv ?? 0);
      return (descending ? -compared : compared) || a.primary_sku.localeCompare(b.primary_sku, 'pt-BR');
    });
    $('helice-count').textContent = `${items.length} de ${data.items.length} hélices usinadas`;
    const columns=labels.filter(([,key])=>visible.includes(key));
    $('analysis-column-count').textContent=`(${columns.length}/${labels.length})`;
    table.style.width=columns.reduce((sum,[,key])=>sum+(widths[key]||132),0)+'px';table.style.minWidth='100%';
    table.querySelector('thead tr').innerHTML = columns.map(([label, key]) => `<th data-column-key="${key}" style="width:${widths[key]||132}px" aria-sort="${sort === key ? (descending ? 'descending' : 'ascending') : 'none'}"><button class="stock-sort" data-analysis-sort="${key}"><span>${escapeHtml(label)}</span><span aria-hidden="true">${sort === key ? (descending ? '↓' : '↑') : '↕'}</span></button></th>`).join('');
    table.querySelector('tbody').innerHTML = items.map(item => `<tr class="analysis-row analysis-row--${statuses.get(item.id).tone}">${columns.map(([, key]) => {
      if (key === 'description') return `<td class="analysis-product" data-column-key="description"><button class="analysis-product-link" data-analysis-product="${item.id}">${escapeHtml(item.description)}</button><div class="analysis-product-meta">${!visible.includes('primary_sku')?`<span class="analysis-sku">${escapeHtml(item.primary_sku)}</span>`:''}<span class="analysis-stock-state analysis-stock-state--${statuses.get(item.id).tone}">${statuses.get(item.id).label}</span></div></td>`;
      if (key === 'primary_sku' || key === 'raw_code') return `<td>${escapeHtml(item[key] || 'Não vinculado')}</td>`;
      if (key === 'incoming_quantity' && item[key] == null) return '<td class="stock-number"></td>';
      return `<td data-column-key="${key}" class="stock-number ${['physical_quantity','stock_one_quantity','virtual_quantity'].includes(key)&&item[key]!=null&&Number(item[key])<0?'analysis-negative':''} ${item[key] == null ? 'is-unknown' : ''}">${key === 'general_priority' ? (item[key] ?? '—') : quantity(item[key])}</td>`;
    }).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}" class="empty">Nenhuma hélice corresponde à busca e à situação selecionadas.</td></tr>`;
    table.querySelectorAll('[data-analysis-sort]').forEach(button => button.onclick = () => {
      const key = button.dataset.analysisSort; descending = sort === key ? !descending : false; sort = key;
      const url = new URL(location.href); url.searchParams.set('helice_sort', sort); url.searchParams.set('helice_desc', descending ? '1' : '0'); history.replaceState(null, '', url);
      refresh(); table.querySelector(`[data-analysis-sort="${key}"]`).focus();
    });
    table.querySelectorAll('[data-analysis-product]').forEach(button => button.onclick = () => showProductDetail(button.dataset.analysisProduct));
  };
  $('helice-search').oninput = refresh;
  tools.querySelectorAll('[data-column]').forEach(input=>input.onchange=()=>{visible=HeliceTableView.visibleColumns(labels.map(([,key])=>key),[...tools.querySelectorAll('[data-column]:checked')].map(control=>control.dataset.column).join(','));persistColumns();refresh();});
  const setView=keys=>{visible=HeliceTableView.visibleColumns(labels.map(([,key])=>key),keys.join(','));tools.querySelectorAll('[data-column]').forEach(input=>input.checked=visible.includes(input.dataset.column));persistColumns();refresh();};
  $('analysis-essential').onclick=()=>setView(HeliceTableView.essential);$('analysis-all').onclick=()=>setView(labels.map(([,key])=>key));
  $('coverage-parameters').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'), status = $('coverage-save-status');
    button.disabled = true; status.textContent = 'Salvando parâmetros…';
    try {
      const parameters = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
      await request('/api/catalog/analysis/helices/parameters', { method: 'PUT', body: JSON.stringify({ parameters, version: data.version }) });
      if (document.querySelector('nav button.active')?.dataset.page === 'analysis-helice') await render();
      notify('Parâmetros salvos. Análise recalculada.');
    } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  };
  renderFilters();refresh();
}
