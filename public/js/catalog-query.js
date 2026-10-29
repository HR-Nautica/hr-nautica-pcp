(function(root){
  const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
  const balance=value=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?'unknown':Number(value)>0?'positive':Number(value)<0?'negative':'zero';
  const dimensions={item_type:'Tipo',family:'Família',status:'Status',stock_authority:'Origem do saldo',has_bom:'BOM',has_routing:'Roteiro',balance:'Situação do saldo'};
  const labels={active:'Ativo',inactive:'Inativo',erp:'ERP',tiny_import:'Planilha Tiny',true:'Com estrutura',false:'Sem estrutura',positive:'Positivo',negative:'Negativo',zero:'Zerado',unknown:'Desconhecido'};
  const sorts={sku:'SKU crescente',sku_desc:'SKU decrescente',description:'Descrição A–Z',description_desc:'Descrição Z–A',item_type:'Tipo',family:'Família',balance:'Saldo crescente',balance_desc:'Saldo decrescente'};
  function select(items,state={}){
    const q=normalize(state.q), filtered=items.filter(item=>(!q||normalize(item.primary_sku).includes(q)||normalize(item.description).includes(q))&&Object.keys(dimensions).every(key=>!state[key]||String(key==='balance'?balance(item.physical_quantity):item[key])===state[key]));
    const sort=sorts[state.sort]?state.sort:'sku',desc=sort.endsWith('_desc'),field=sort.replace('_desc','');
    const compare=(a,b)=>String(a??'').localeCompare(String(b??''),'pt-BR');
    return filtered.sort((a,b)=>{let value;if(field==='balance'){const au=balance(a.physical_quantity)==='unknown',bu=balance(b.physical_quantity)==='unknown';if(au!==bu)return au?1:-1;value=au?0:Number(a.physical_quantity)-Number(b.physical_quantity);}else value=compare(a[field==='sku'?'primary_sku':field],b[field==='sku'?'primary_sku':field]);return (desc?-value:value)||compare(a.primary_sku,b.primary_sku)||compare(a.id,b.id);});
  }
  function read(page){const params=new URLSearchParams(location.search),state={};for(const key of ['q','sort',...Object.keys(dimensions)]){const value=params.get(`${page}_${key}`);if(value&&value.length<=500)state[key]=value;}return state;}
  function write(page,state){const url=new URL(location.href);for(const key of ['q','sort',...Object.keys(dimensions)]){url.searchParams.delete(`${page}_${key}`);if(state[key])url.searchParams.set(`${page}_${key}`,state[key]);}history.replaceState(null,'',url);}
  function createLoader(fetchPage){let generation=0,cached=null,pending=null;return {invalidate(){generation++;cached=null;pending=null;},async load(){if(cached)return cached;if(pending)return pending;const current=generation;const task=(async()=>{const first=await fetchPage(1),items=[...first.items];for(let page=2;items.length<first.total;page++){const next=await fetchPage(page);if(!next.items.length)throw new Error('Catálogo incompleto. Tente novamente.');items.push(...next.items);}if(new Set(items.map(item=>item.id)).size!==items.length||items.length!==first.total)throw new Error('Catálogo alterado durante a consulta. Tente novamente.');if(current!==generation)return this.load();cached=items;return items;})();pending=task;try{return await task;}finally{if(pending===task)pending=null;}}};}
  root.CatalogQuery={select,balance,normalize,dimensions,labels,sorts,read,write,createLoader};
})(typeof window==='undefined'?globalThis:window);
