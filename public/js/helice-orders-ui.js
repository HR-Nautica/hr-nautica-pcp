function navigateErpPage(page, orderId){
  const target=document.querySelector(`nav button[data-page="${page}"]`);
  document.querySelectorAll('nav button[data-page]').forEach(button=>button.classList.toggle('active',button===target));
  const group=target.closest('.nav-items').id;
  document.querySelectorAll('.nav-category').forEach(category=>{const open=category.getAttribute('aria-controls')===group;category.setAttribute('aria-expanded',String(open));$(category.getAttribute('aria-controls')).hidden=!open;});
  return render(orderId);
}
function heliceOrderStage(order){
  const stage = order.current_stage?.name || (order.routing[0] ? `A iniciar: ${order.routing[0].name}` : 'Sem roteiro cadastrado');
  return order.status === 'waiting' ? `Em espera · ${stage}` : stage;
}
function heliceOrderSummary(orders=[]){
  if(!orders.length)return '<p class="bom-production-note">Sem OP aberta para este item.</p>';
  return `<div class="helice-order-links">${orders.map(order=>`<div><button class="secondary" data-structure-order="${order.id}">${escapeHtml(order.number)}</button><span>${order.remaining_quantity.toLocaleString('pt-BR')} peças</span><span>${escapeHtml(heliceOrderStage(order))}</span></div>`).join('')}</div>`;
}
function openHeliceOrderModal(item){
  const suggested=item.suggested_op;
  openModal('Abrir ordem de produção','HÉLICES',`<div id="helice-op-form"><p><strong>${escapeHtml(item.description)}</strong><br><small>${escapeHtml(item.primary_sku)}</small></p><p class="order-suggestion">Sugestão: <strong>${suggested==null?'não disponível':Number(suggested).toLocaleString('pt-BR')+' peças'}</strong></p><label>Quantidade a produzir<input id="helice-op-quantity" name="quantity" type="number" min="1" max="1000000000" step="1" required value="${suggested>0?suggested:''}"></label><p class="analysis-hint">A confirmação baixa somente os brutos da BOM. Buchas e estoque físico da hélice não serão alterados.</p><details id="helice-op-materials"><summary>Consultar BOM e estoque atual</summary><div id="helice-op-bom"></div></details><button type="button" class="secondary" id="helice-op-check">Conferir bruto</button><div id="helice-op-preview" role="status" aria-live="polite"></div></div>`,async()=>{});
  const dialog=$('modal'),input=$('helice-op-quantity'),preview=$('helice-op-preview'),save=$('modal-save');
  const materials = $('helice-op-materials'), bom = $('helice-op-bom');
  materials.ontoggle = () => {
    if (materials.open) loadHeliceOrderMaterials(bom, item.id);
  };
  let plan=null,timer,generation=0,posting=false,frozen=false,requestId=null;
  const newId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  save.textContent='Abrir OP';save.disabled=true;
  const check=async()=>{
    clearTimeout(timer);
    const current=++generation,quantity=Number(input.value);plan=null;save.disabled=true;
    if(!Number.isInteger(quantity)||quantity<=0){preview.textContent='Informe uma quantidade inteira maior que zero.';return;}
    preview.textContent='Conferindo estoque do bruto…';
    try{
      const result=await request(`/api/catalog/orders/helices/${item.id}/preview`,{method:'POST',body:JSON.stringify({quantity})});
      if(current!==generation||!dialog.open||!preview.isConnected)return;
      plan={...result,quantity};requestId=newId();
      const amount=value=>value==null?'Não informado':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:8});
      preview.innerHTML=`<div class="table-wrap"><table class="order-raw-preview"><thead><tr><th>Bruto</th><th>Necessário</th><th>Em estoque</th></tr></thead><tbody>${result.raws.map(raw=>`<tr><td>${escapeHtml(raw.primary_sku)}</td><td>${amount(raw.required)} ${escapeHtml(raw.unit)}</td><td>${amount(raw.available)} ${raw.available==null?'':escapeHtml(raw.unit)}</td></tr>`).join('')}</tbody></table></div>${result.canOpen?'<p class="order-ready">Bruto disponível para abrir esta OP.</p>':`<ul class="order-blocked">${result.issues.map(issue=>`<li>${escapeHtml(issue)}</li>`).join('')}</ul>`}`;
      save.disabled=!result.canOpen;
    }catch(error){if(current===generation&&preview.isConnected)preview.textContent=error.message;}
  };
  $('helice-op-check').onclick=()=>check();
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();if(!save.disabled)save.click();}};
  input.oninput=()=>{if(frozen)return;generation++;plan=null;save.disabled=true;clearTimeout(timer);timer=setTimeout(check,300);};
  dialog.oncancel=event=>{if(posting||frozen)event.preventDefault();};
  save.onclick=async event=>{
    event.preventDefault();if(posting||!plan?.canOpen||Number(input.value)!==plan.quantity)return;
    posting=true;input.disabled=true;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);save.textContent='Registrando…';
    try{
      const result=await request(`/api/catalog/orders/helices/${item.id}`,{method:'POST',body:JSON.stringify({quantity:plan.quantity,requestId,expectedPlan:plan.planToken})});
      frozen=false;dialog.close();await navigateErpPage('orders-helices');notify(`${result.order.number} registrada: ${result.order.quantity.toLocaleString('pt-BR')} peças.`);
    }catch(error){
      if(!error.status||error.status>=500){frozen=true;preview.textContent='Não foi possível confirmar a resposta. Use “Tentar novamente” para consultar a mesma abertura sem duplicar a OP.';}
      else{frozen=false;plan=null;preview.textContent=error.message+' Altere ou confira a quantidade novamente.';}
    }finally{
      posting=false;input.disabled=frozen;dialog.querySelectorAll('button').forEach(button=>button.disabled=frozen);save.textContent=frozen?'Tentar novamente':'Abrir OP';save.disabled=!plan?.canOpen;
      if(!frozen)dialog.oncancel=null;
      if(!dialog.open){save.textContent='Salvar';save.disabled=false;}
    }
  };
  // O modal compartilhado volta ao padrão ao fechar para não afetar outros cadastros.
  dialog.addEventListener('close',()=>{clearTimeout(timer);generation++;save.textContent='Salvar';save.disabled=false;dialog.oncancel=null;},{once:true});
  if(suggested>0)check();else preview.textContent='Informe a quantidade para conferir o bruto.';
}
const heliceOrderStatuses = { open: 'Em aberto', waiting: 'Em espera', completed: 'Encerrada' };
const helicePieces = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
const heliceOrderDate = value => new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const heliceOrderBadge = order => `<span class="badge ${order.status === 'waiting' ? 'warn' : order.status === 'completed' ? 'ok' : ''}">${heliceOrderStatuses[order.status]}</span>`;

function groupHeliceOrders(items) {
  const children = new Map();
  const ids = new Set(items.map(item => item.id));
  for (const item of items) {
    if (!children.has(item.parent_id)) children.set(item.parent_id, []);
    children.get(item.parent_id).push(item);
  }
  return items.filter(item => !ids.has(item.parent_id)).map(root => {
    const lots = [root];
    for (const lot of lots) lots.push(...(children.get(lot.id) ?? []));
    const totals = { open: 0, waiting: 0, completed: 0, scrap: 0 };
    for (const lot of lots) {
      totals[lot.status] += lot.status === 'completed' ? (lot.finished_quantity ?? 0) : lot.remaining_quantity;
      for (const event of lot.events ?? []) {
        if (event.action === 'report') totals.scrap += event.scrap;
      }
    }
    return { root, lots, totals };
  });
}

function heliceOrderTotals({ root, totals }) {
  const metrics = [
    ['Quantidade inicial da OP', root.quantity, ''],
    ['Em produção', totals.open, ''],
    ['Em espera', totals.waiting, 'op-waiting'],
    ['Concluídas', totals.completed, 'op-approved'],
    ['Refugo', totals.scrap, 'op-scrap']
  ];
  return `<dl class="op-family-totals">${metrics.map(([label, quantity, color]) =>
    `<div><dt>${label}</dt><dd class="${color}">${helicePieces(quantity)}</dd></div>`).join('')}</dl>`;
}

async function renderHeliceOrders(selectedId) {
  const { items } = await request('/api/catalog/orders/helices');
  if (document.querySelector('nav button.active')?.dataset.page !== 'orders-helices') return;
  const host = $('content');
  const groups = groupHeliceOrders(items);
  $('page-actions').innerHTML = '<button class="secondary" id="orders-to-analysis">Analisar hélices</button>';
  $('orders-to-analysis').onclick = () => navigateErpPage('analysis-helice');
  let search = '', status = '';
  const showList = () => {
    host.innerHTML = `<section class="query-toolbar op-filters"><div class="query-top">
      <label>Buscar ordem<input id="op-search" type="search" placeholder="Número, produto ou SKU"></label>
      <label>Situação do lote<select id="op-status"><option value="">Todas</option>${Object.entries(heliceOrderStatuses).map(([key, label]) =>
        `<option value="${key}">${label}</option>`).join('')}</select></label><span id="op-count" role="status"></span></div></section>
      <div id="op-rows" class="op-detail"></div>`;
    $('op-search').value = search;
    $('op-status').value = status;
    const paint = () => {
      search = $('op-search').value;
      status = $('op-status').value;
      const term = search.trim().toLocaleLowerCase('pt-BR');
      const filtered = groups.filter(({ lots }) => lots.some(lot =>
        (!status || lot.status === status) &&
        [lot.number, lot.sku, lot.description].some(value => value.toLocaleLowerCase('pt-BR').includes(term))));
      $('op-count').textContent = `${filtered.length} de ${groups.length} ordens`;
      $('op-rows').innerHTML = filtered.map(group => {
        const { root, lots } = group;
        return `<section class="card op-panel op-family">
          <div class="op-family-heading"><div><small>${escapeHtml(root.number)} · ${escapeHtml(root.sku)}</small>
          <h2>${escapeHtml(root.description)}</h2></div></div>
          ${heliceOrderTotals(group)}
          <details class="op-lots" open><summary>Lotes desta OP (${lots.length})</summary>
          <ul>${lots.map(lot => `<li>
            <div><strong>${escapeHtml(lot.number)}</strong><small>${lot.parent_number ? 'Separado de ' + escapeHtml(lot.parent_number) : 'Lote principal'}</small></div>
            <div><strong>${helicePieces(lot.status === 'completed' ? lot.finished_quantity ?? 0 : lot.remaining_quantity)} peças</strong><small>${heliceOrderStatuses[lot.status]}</small></div>
            <div><small>${lot.status === 'completed' ? 'Situação' : 'Etapa atual'}</small><strong>${escapeHtml(lot.status === 'completed' ? 'Lote encerrado' : heliceOrderStage(lot))}</strong></div>
            <button class="secondary" data-op-view="${lot.id}" aria-label="Acompanhar ${escapeHtml(lot.number)}">Acompanhar</button>
          </li>`).join('')}</ul></details>
        </section>`;
      }).join('') || '<p class="card op-panel">Nenhuma ordem encontrada.</p>';
      host.querySelectorAll('[data-op-view]').forEach(button => {
        button.onclick = () => openOrder(button.dataset.opView);
      });
    };
    $('op-search').oninput = paint;
    $('op-status').onchange = paint;
    paint();
  };
  const openOrder = id => {
    const group = groups.find(entry => entry.lots.some(lot => lot.id === id));
    if (group) showHeliceOrder(group.lots.find(lot => lot.id === id), group, showList, openOrder);
    else showList();
  };
  if (selectedId) openOrder(selectedId);
  else showList();
}
function showHeliceOrder(order, group, showList, openOrder) {
  const events = order.events ?? [];
  const reports = new Map(events.filter(event => event.action === 'report').map(event => [event.stage_index, event]));
  const related = group.lots.filter(item => item.id !== order.id);
  const stage = order.routing[order.completed_stage_count];
  const canReport = order.status === 'open' && stage;
  const waiting = order.status === 'waiting';
  const host = $('content');
  host.innerHTML = `<article class="op-detail">
    <div class="op-detail-bar"><button class="secondary" id="op-back">Voltar às ordens</button>${heliceOrderBadge(order)}</div>
    <section class="card op-panel"><small class="bom-eyebrow">${escapeHtml(order.number)} · ${escapeHtml(order.sku)}</small>
      <h2>${escapeHtml(order.description)}</h2>
      <p class="analysis-hint">Abertura por ${escapeHtml(order.created_by)} · ${escapeHtml(heliceOrderDate(order.created_at))}</p>
      <h3>Resumo da OP ${escapeHtml(group.root.number)}</h3>
      ${heliceOrderTotals(group)}
    </section>
    ${stage && order.status !== 'completed' ? `<section class="card op-panel op-current">
      <div><small>Etapa ${order.completed_stage_count + 1} de ${order.routing.length} · ${waiting ? 'Lote em espera' : 'Etapa atual'}</small>
        <h3>${escapeHtml(stage.name)}</h3><strong>${helicePieces(order.remaining_quantity)} peças neste lote</strong></div>
      <div><small>Depois desta etapa</small><strong>${escapeHtml(order.routing[order.completed_stage_count + 1]?.name ?? 'Conclusão do lote')}</strong></div>
      <a href="#op-route" class="op-route-link">Ver todas as etapas</a>
    </section>` : ''}
    ${canReport || waiting ? heliceExecutionForm(order) : order.status === 'open' ?
      '<p class="card op-panel">Esta OP foi aberta sem roteiro cadastrado. A execução requer uma ordem com roteiro.</p>' : ''}
    <section class="card op-panel" id="op-route" tabindex="-1"><h3>Etapas deste lote</h3>
      ${order.routing.length ? `<ol class="op-stages">${order.routing.map((step, index) => {
        const event = reports.get(index);
        const done = index < order.completed_stage_count;
        const label = done ? (event ? 'Apontada' : 'Cumprida no lote de origem') :
          order.status === 'completed' ? 'Não executada' : index === order.completed_stage_count ? (waiting ? 'Em espera' : 'Etapa atual') : 'Pendente';
        const current = index === order.completed_stage_count && order.status !== 'completed';
        return `<li class="${current ? 'op-stage-current' : ''}" ${current ? 'aria-current="step"' : ''}><div class="op-stage-name"><span class="op-stage-number">${index + 1}</span>
          <div><strong>${escapeHtml(step.name)}</strong><small>${escapeHtml(step.code)}</small></div></div>
          <span class="badge ${done ? 'ok' : ''}">${label}</span>
          ${event ? `<p class="op-stage-counts">
            <span class="op-approved">${helicePieces(event.approved)} aprovadas</span>
            <span class="op-scrap">${helicePieces(event.scrap)} em refugo</span>
            <span class="op-waiting">${helicePieces(event.waiting)} em espera</span>
          </p><p class="op-stage-audit">${event.approved ? 'Aprovado por' : 'Apontado por'} <strong>${escapeHtml(event.actor)}</strong>
            · <time datetime="${escapeHtml(event.at)}">${escapeHtml(heliceOrderDate(event.at))}</time></p>` : ''}
          ${!done && step.instructions ? `<p>${escapeHtml(step.instructions)}</p>` : ''}</li>`;
      }).join('')}</ol>` : '<p>Nenhuma etapa no roteiro.</p>'}
    </section>
    ${related.length ? `<section class="card op-panel"><h3>Lotes vinculados</h3>
      <ul class="op-history">${related.map(item => `<li><button class="secondary" data-op-related="${item.id}">${escapeHtml(item.number)}</button>
        ${item.id === order.parent_id ? 'Lote de origem · ' : ''}${helicePieces(item.status === 'completed' ? item.finished_quantity ?? 0 : item.remaining_quantity)} peças · ${heliceOrderBadge(item)}
        ${item.waiting_location ? ` · ${escapeHtml(item.waiting_location)}` : ''}</li>`).join('')}</ul></section>` : ''}
    <section class="card op-panel"><h3>Materiais e histórico</h3>
      <details id="op-materials"><summary>Consultar BOM e estoque atual</summary><div id="op-bom" role="status"></div></details>
      <details><summary>Baixa de bruto na abertura</summary>${order.consumption.length ?
        `<ul>${order.consumption.map(line => `<li>${escapeHtml(line.sku)} · ${helicePieces(line.quantity)} ${escapeHtml(line.unit)}
          · saldo ${helicePieces(line.previous)} → ${helicePieces(line.current)}</li>`).join('')}</ul>` :
        '<p>Sem baixa registrada neste lote. Consulte a ordem de origem, se houver.</p>'}</details>
      ${events.length ? `<ul class="op-history">${[...events].reverse().map(event => `<li>
        <strong>${event.action === 'release' ? 'Lote liberado' : escapeHtml(event.step.name)}</strong>
        <small>${escapeHtml(event.actor)} · ${escapeHtml(heliceOrderDate(event.at))}</small>
        ${event.location ? `<p>Estoque temporário · ${escapeHtml(event.location)}${event.child_number ? ` · ${escapeHtml(event.child_number)}` : ''}</p>` : ''}
        ${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ''}</li>`).join('')}</ul>` : ''}
    </section>
  </article>`;
  $('op-back').onclick = showList;
  const routeLink = host.querySelector('.op-route-link');
  if (routeLink) routeLink.onclick = event => {
    event.preventDefault();
    $('op-route').focus();
    $('op-route').scrollIntoView({ block: 'start' });
  };
  host.querySelectorAll('[data-op-related]').forEach(button => {
    button.onclick = () => openOrder(button.dataset.opRelated);
  });
  const materials = $('op-materials'), bom = $('op-bom');
  materials.ontoggle = () => {
    if (materials.open) loadHeliceOrderMaterials(bom, order.product_id);
  };
  if (canReport || waiting) bindHeliceExecution(order);
}

async function loadHeliceOrderMaterials(bom, productId) {
  if (bom.dataset.loaded) return;
  bom.dataset.loaded = 'true';
  bom.textContent = 'Consultando materiais…';
  try {
    const detail = await request(`/api/catalog/analysis/helices/${productId}/structure`);
    if (!bom.isConnected) return;
    bom.innerHTML = analysisStructureMarkup(detail, helicePieces);
    const inDialog = bom.closest('dialog');
    bom.querySelectorAll('[data-structure-product], [data-structure-order]').forEach(button => {
      button.type = 'button';
      if (inDialog) button.hidden = true;
      else button.onclick = () => {
        const action = button.dataset.structureOrder ?
          renderHeliceOrders(button.dataset.structureOrder) : showProductDetail(button.dataset.structureProduct);
        action.catch(error => notify(error.message, true));
      };
    });
  } catch (error) {
    bom.textContent = error.message;
    delete bom.dataset.loaded;
  }
}

function heliceExecutionForm(order) {
  const waiting = order.status === 'waiting';
  return `<form id="op-execution" class="card op-panel">
    <h3>${waiting ? 'Liberar lote em espera' : 'Registrar resultado da etapa'}</h3>
    <p>${waiting ? `Local de espera: ${escapeHtml(order.waiting_location)}` :
      'Informe quantas peças tiveram refugo ou ficaram em espera. As aprovadas são calculadas na hora.'}</p>
    ${waiting ? '<p class="analysis-hint">O lote volta para esta mesma etapa ao ser liberado.</p>' : `<div class="op-fields">
      <label class="op-approved">Aprovadas · cálculo automático<input type="number" name="approved" value="${order.remaining_quantity}" readonly></label>
      <label class="op-scrap">Refugo<input type="number" name="scrap" min="0" max="${order.remaining_quantity}" step="1" value="0" required></label>
      <label class="op-waiting">Em espera<input type="number" name="waiting" min="0" max="${order.remaining_quantity}" step="1" value="0" required></label>
    </div><label id="op-location" hidden>Local do estoque temporário<input name="location" maxlength="100"></label>
    <p class="analysis-hint" id="op-allocation" role="status"></p>`}
    <label>Observação (opcional)<input name="notes" maxlength="500"></label>
    <div class="op-detail-bar"><span id="op-execution-status" role="status"></span><button type="submit">${waiting ? 'Liberar para produção' : 'Registrar etapa'}</button></div>
  </form>`;
}

function bindHeliceExecution(order) {
  const form = $('op-execution'), status = $('op-execution-status'), button = form.querySelector('button');
  const waiting = order.status === 'waiting', label = button.textContent;
  const fields = [...form.querySelectorAll('input')];
  let draft, busy = false;
  const counts = () => ['approved', 'scrap', 'waiting'].map(key => form.elements.namedItem(key).valueAsNumber);
  const update = () => {
    if (waiting) return;
    const [, scrap, pending] = counts();
    const remainder = order.remaining_quantity - scrap - pending;
    const valid = [scrap, pending].every(value => Number.isSafeInteger(value) && value >= 0) && remainder >= 0;
    form.elements.namedItem('approved').value = valid ? remainder : '';
    const location = form.elements.namedItem('location');
    $('op-location').hidden = !(pending > 0);
    location.required = pending > 0;
    button.disabled = !valid;
    const allocation = $('op-allocation');
    allocation.classList.toggle('op-scrap', !valid);
    allocation.textContent = valid
      ? `${helicePieces(order.remaining_quantity)} peças distribuídas.`
      : `Informe quantidades inteiras. Refugo e espera, somados, não podem exceder ${helicePieces(order.remaining_quantity)} peças.`;
  };
  form.oninput = update;
  update();
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || button.disabled) return;
    if (!draft) {
      const values = new FormData(form);
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      draft = { action: waiting ? 'release' : 'report', requestId, version: order.version, notes: values.get('notes') };
      if (!waiting) {
        const [approved, scrap, pending] = counts();
        Object.assign(draft, { approved, scrap, waiting: pending, location: values.get('location') });
      }
    }
    busy = button.disabled = true;
    fields.forEach(field => { field.disabled = true; });
    status.textContent = 'Registrando…';
    try {
      await request(`/api/catalog/orders/helices/${order.id}/execution`, { method: 'POST', body: JSON.stringify(draft) });
      if (!form.isConnected) return;
      await renderHeliceOrders(order.id);
      notify(waiting ? 'Lote liberado para produção.' : 'Etapa registrada.');
    } catch (error) {
      status.textContent = error.message;
      if (!error.status || error.status >= 500) {
        button.textContent = 'Tentar novamente';
        button.disabled = false;
      } else if (error.status === 409) {
        button.textContent = 'Recarregar ordem';
        button.type = 'button';
        button.onclick = () => renderHeliceOrders(order.id).catch(error => { status.textContent = error.message; });
        button.disabled = false;
      } else {
        draft = null;
        button.textContent = label;
        fields.forEach(field => { field.disabled = false; });
        button.disabled = false;
        update();
      }
    } finally {
      busy = false;
    }
  };
}
