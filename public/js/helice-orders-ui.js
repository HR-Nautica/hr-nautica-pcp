function navigateErpPage(page){
  const target=document.querySelector(`nav button[data-page="${page}"]`);
  document.querySelectorAll('nav button[data-page]').forEach(button=>button.classList.toggle('active',button===target));
  const group=target.closest('.nav-items').id;
  document.querySelectorAll('.nav-category').forEach(category=>{const open=category.getAttribute('aria-controls')===group;category.setAttribute('aria-expanded',String(open));$(category.getAttribute('aria-controls')).hidden=!open;});
  return render();
}
function heliceOrderStage(order){return order.current_stage?.name|| (order.routing[0]?`A iniciar: ${order.routing[0].name}`:'Sem roteiro cadastrado');}
function heliceOrderSummary(orders=[]){
  if(!orders.length)return '<p class="bom-production-note">Sem OP aberta para este item.</p>';
  return `<div class="helice-order-links">${orders.map(order=>`<div><strong>${escapeHtml(order.number)}</strong><span>${order.remaining_quantity.toLocaleString('pt-BR')} peças</span><span>${escapeHtml(heliceOrderStage(order))}</span></div>`).join('')}</div>`;
}
function openHeliceOrderModal(item){
  const suggested=item.suggested_op;
  openModal('Abrir ordem de produção','HÉLICES',`<div id="helice-op-form"><p><strong>${escapeHtml(item.description)}</strong><br><small>${escapeHtml(item.primary_sku)}</small></p><p class="order-suggestion">Sugestão: <strong>${suggested==null?'não disponível':Number(suggested).toLocaleString('pt-BR')+' peças'}</strong></p><label>Quantidade a produzir<input id="helice-op-quantity" name="quantity" type="number" min="1" max="1000000000" step="1" required value="${suggested>0?suggested:''}"></label><p class="analysis-hint">A confirmação baixa somente os brutos da BOM. Buchas e estoque físico da hélice não serão alterados.</p><button type="button" class="secondary" id="helice-op-check">Conferir bruto</button><div id="helice-op-preview" role="status" aria-live="polite"></div></div>`,async()=>{});
  const dialog=$('modal'),input=$('helice-op-quantity'),preview=$('helice-op-preview'),save=$('modal-save');
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
async function renderHeliceOrders(){
  const data=await request('/api/catalog/orders/helices');
  if(document.querySelector('nav button.active')?.dataset.page!=='orders-helices')return;
  $('page-actions').innerHTML='<button class="secondary" id="orders-to-analysis">Analisar hélices</button>';$('orders-to-analysis').onclick=()=>navigateErpPage('analysis-helice');
  $('content').innerHTML=`<p class="analysis-hint">Ordens abertas pela nova análise. O bruto foi consumido na abertura; a produção prevista não aumenta o estoque físico da hélice.</p><div class="card table-wrap"><table class="helice-orders-table"><thead><tr><th>OP</th><th>Produto</th><th>Quantidade</th><th>Situação / etapa</th><th>Abertura</th><th>Detalhes</th></tr></thead><tbody>${data.items.map(order=>`<tr><td><strong>${escapeHtml(order.number)}</strong></td><td><button class="analysis-product-link" data-order-product="${order.product_id}">${escapeHtml(order.description)}</button><small>${escapeHtml(order.sku)}</small></td><td>${order.quantity.toLocaleString('pt-BR')} ${escapeHtml(order.unit)}</td><td><span class="badge">Aberta</span><small>${escapeHtml(heliceOrderStage(order))}</small></td><td>${escapeHtml(order.created_by)}<small>${escapeHtml(new Date(order.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</small></td><td><details><summary>Roteiro e baixa</summary><p>Roteiro registrado na abertura (etapas ainda não executadas):</p><ol>${order.routing.map(step=>`<li>${escapeHtml(step.code)} — ${escapeHtml(step.name)}</li>`).join('')||'<li>Sem roteiro cadastrado.</li>'}</ol><p>Brutos consumidos:</p><ul>${order.consumption.map(line=>`<li>${escapeHtml(line.sku)}: ${Number(line.quantity).toLocaleString('pt-BR')} ${escapeHtml(line.unit)} · saldo ${Number(line.previous).toLocaleString('pt-BR')} → ${Number(line.current).toLocaleString('pt-BR')}</li>`).join('')}</ul></details></td></tr>`).join('')||'<tr><td colspan="6" class="empty">Nenhuma ordem de hélice registrada.</td></tr>'}</tbody></table></div>`;
  document.querySelectorAll('[data-order-product]').forEach(button=>button.onclick=()=>showProductDetail(button.dataset.orderProduct));
}
