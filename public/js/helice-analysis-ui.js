/* Usa o contrato central do catálogo; parâmetros só são confirmados no servidor. */
function installAnalysisSync(page) {
  const scopes = { 'analysis-helice': 'helices', 'analysis-brutos': 'brutos', 'analysis-buchas': 'buchas', 'analysis-componentes': 'componentes' };
  $('page-actions').innerHTML = '<button class="secondary" id="analysis-sync">Sincronizar Tiny</button>';
  $('analysis-sync').onclick = () => {
    if(page!=='analysis-helice')return renderStockSync({scope:scopes[page],returnPage:page});
    document.querySelectorAll('nav button[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page==='sync'));
    document.querySelectorAll('.nav-category').forEach(category=>{const open=category.getAttribute('aria-controls')==='nav-suprimentos';category.setAttribute('aria-expanded',String(open));$(category.getAttribute('aria-controls')).hidden=!open;});
    render();
  };
}

function analysisStructureMarkup(payload,quantity) {
  const amount=(value,unit)=>value==null?'<span class="bom-unknown">Não informado</span>':`<span class="${Number(value)<0?'bom-negative':''}">${quantity(value)} <small>${escapeHtml(unit||'')}</small></span>`;
  const routing=item=>`<div class="analysis-bom-actions"><button class="secondary" data-structure-product="${escapeHtml(item.id)}">Abrir ficha</button><details><summary>Roteiro cadastrado <span class="bom-count">${item.routing.length}</span></summary>${item.routing.length?`<ol>${item.routing.map(step=>`<li><span>${escapeHtml(step.code)}</span> ${escapeHtml(step.name)}</li>`).join('')}</ol>`:'<p>Nenhuma etapa cadastrada.</p>'}<small>Roteiro previsto; não indica execução de uma OP.</small></details></div>`;
  const root=payload.product;
  const nodes=items=>items.map(node=>`<details class="analysis-bom-node"><summary><span class="bom-item-name"><span class="bom-node-chevron" aria-hidden="true">›</span><span><strong>${escapeHtml(node.item.description)}</strong><small>${escapeHtml(node.item.primary_sku)}${node.item.status==='inactive'?' · Inativo':''}${node.children.length?` · ${node.children.length} subitens`:''}</small></span></span><span class="bom-qty"><small class="bom-mobile-label">Qtd. / pai</small>${node.quantity==null?'<span class="bom-unknown">Pendente</span>':amount(node.quantity,node.unit)}</span><span class="bom-physical"><small class="bom-mobile-label">Físico</small>${amount(node.item.physical_quantity,node.item.unit)}<small class="bom-source">${node.item.stock_authority==='tiny_import'?'Tiny':'ERP'}</small></span><span class="bom-balance"><small class="bom-mobile-label">Após vendido</small>${amount(node.item.stock_one_quantity,node.item.unit)}</span></summary><div class="bom-node-detail">${routing(node.item)}<p class="bom-production-note">Entradas em produção e etapa atual aguardam as novas OPs.</p>${node.children.length?`<div class="analysis-bom-children">${nodes(node.children)}</div>`:''}</div></details>`).join('');
  return `<div class="analysis-expansion-content"><div class="bom-detail-heading"><div><span class="bom-eyebrow">ESTRUTURA E PRODUÇÃO</span><h3>${escapeHtml(root.primary_sku)}</h3></div><span class="badge">Hélice usinada</span></div><div class="bom-root-summary"><div><small>Estoque físico <span class="bom-source-inline">${root.stock_authority==='tiny_import'?'Tiny':'ERP'}</span></small><strong>${amount(root.physical_quantity,root.unit)}</strong></div><div><small>Saldo após vendido</small><strong>${amount(root.stock_one_quantity,root.unit)}</strong></div><div><small>Entradas em produção</small><strong>${root.incoming_quantity==null?'—':amount(root.incoming_quantity,root.unit)}</strong></div><div><small>OPs abertas · Etapa atual</small><strong class="bom-unknown">Aguardando novas OPs</strong></div></div>${routing(root)}<div class="bom-section-heading"><h3>Lista de materiais <span class="bom-count">${payload.bomTree.length}</span></h3><span>Quantidades por unidade do pai</span></div><p class="bom-detail-note">Saldo após vendido = físico − vendido; não inclui reservas. Dados ausentes permanecem não informados.</p>${payload.bomTree.length?`<div class="bom-comparison-head" aria-hidden="true"><span>Componente</span><span>Qtd. / pai</span><span>Estoque físico</span><span>Após vendido</span></div>${nodes(payload.bomTree)}`:'<p class="analysis-hint">Nenhum componente vinculado à BOM.</p>'}</div>`;
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
  const expanded=new Set(),structures=new Map();
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
      if (key === 'description') return `<td class="analysis-product" data-column-key="description"><div class="analysis-product-title"><button type="button" class="analysis-expand" data-expand-product="${item.id}" aria-expanded="${expanded.has(item.id)}" aria-controls="structure-${item.id}" aria-label="${expanded.has(item.id)?'Recolher':'Expandir'} BOM de ${escapeHtml(item.primary_sku)}">${expanded.has(item.id)?'⌄':'›'}</button><button class="analysis-product-link" data-analysis-product="${item.id}">${escapeHtml(item.description)}</button></div><div class="analysis-product-meta">${!visible.includes('primary_sku')?`<span class="analysis-sku">${escapeHtml(item.primary_sku)}</span>`:''}<span class="analysis-stock-state analysis-stock-state--${statuses.get(item.id).tone}">${statuses.get(item.id).label}</span></div></td>`;
      if (key === 'primary_sku' || key === 'raw_code') return `<td>${escapeHtml(item[key] || 'Não vinculado')}</td>`;
      if (key === 'incoming_quantity' && item[key] == null) return '<td class="stock-number"></td>';
      return `<td data-column-key="${key}" class="stock-number ${['physical_quantity','stock_one_quantity','virtual_quantity'].includes(key)&&item[key]!=null&&Number(item[key])<0?'analysis-negative':''} ${item[key] == null ? 'is-unknown' : ''}">${key === 'general_priority' ? (item[key] ?? '—') : quantity(item[key])}</td>`;
    }).join('')}</tr>${expanded.has(item.id)?`<tr class="analysis-expansion-row"><td colspan="${columns.length}"><div id="structure-${item.id}" data-structure-host="${item.id}" aria-live="polite">${structures.get(item.id)?.error?`<div class="analysis-structure-error" role="alert">${escapeHtml(structures.get(item.id).error)} <button class="secondary" data-retry-structure="${item.id}">Tentar novamente</button></div>`:structures.get(item.id)?.data?analysisStructureMarkup(structures.get(item.id).data,quantity):'<p role="status">Consultando BOM e estoque dos itens…</p>'}</div></td></tr>`:''}`).join('') || `<tr><td colspan="${columns.length}" class="empty">Nenhuma hélice corresponde à busca e à situação selecionadas.</td></tr>`;
    table.querySelectorAll('[data-analysis-sort]').forEach(button => button.onclick = () => {
      const key = button.dataset.analysisSort; descending = sort === key ? !descending : false; sort = key;
      const url = new URL(location.href); url.searchParams.set('helice_sort', sort); url.searchParams.set('helice_desc', descending ? '1' : '0'); history.replaceState(null, '', url);
      refresh(); table.querySelector(`[data-analysis-sort="${key}"]`).focus();
    });
    table.querySelectorAll('[data-analysis-product]').forEach(button => button.onclick = () => showProductDetail(button.dataset.analysisProduct));
    const loadStructure=async id=>{
      structures.set(id,{loading:true});refresh();
      try{const result=await request(`/api/catalog/analysis/helices/${id}/structure`);structures.set(id,{data:result});}
      catch(error){structures.set(id,{error:error.message});}
      if(table.isConnected){const focused=document.activeElement?.dataset.expandProduct;refresh();if(focused)table.querySelector(`[data-expand-product="${focused}"]`)?.focus();}
    };
    table.querySelectorAll('[data-expand-product]').forEach(button=>button.onclick=()=>{
      const id=button.dataset.expandProduct;if(expanded.has(id)){expanded.delete(id);refresh();}else{expanded.add(id);if(!structures.has(id))loadStructure(id);else refresh();}
      table.querySelector(`[data-expand-product="${id}"]`)?.focus();
    });
    table.querySelectorAll('[data-retry-structure]').forEach(button=>button.onclick=()=>loadStructure(button.dataset.retryStructure));
    table.querySelectorAll('[data-structure-product]').forEach(button=>button.onclick=()=>showProductDetail(button.dataset.structureProduct));
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
