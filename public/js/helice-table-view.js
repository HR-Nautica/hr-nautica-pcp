(function(root){
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  function stockStatus(item, targetMonths) {
    const physical = number(item.physical_quantity), balance = number(item.stock_one_quantity), average = number(item.monthly_average), coverage = number(item.coverage_months);
    if (physical === null) return {key:'unknown',tone:'neutral',label:'Saldo não informado'};
    if (physical <= 0) return {key:'empty',tone:'danger',label:physical < 0 ? 'Estoque negativo' : 'Sem estoque'};
    if (balance !== null && balance < 0) return {key:'committed',tone:'danger',label:'Vendido acima do físico'};
    if (average === null || coverage === null || balance === null) return {key:'unknown',tone:'neutral',label:'Cobertura não informada'};
    if (average === 0) return {key:'no-demand',tone:'neutral',label:'Sem consumo médio'};
    if (average > 0 && coverage < targetMonths) return {key:'low',tone:'warning',label:'Cobertura abaixo da meta'};
    return {key:'covered',tone:'success',label:'Cobertura na meta'};
  }
  const essential = ['general_priority','description','physical_quantity','stock_one_quantity','virtual_quantity','monthly_average','coverage_months','suggested_op','target_stock_quantity'];
  function visibleColumns(allowed, value) {
    const selected = value === null ? essential : String(value).split(',');
    return allowed.filter(key => ['general_priority','description'].includes(key) || selected.includes(key));
  }
  root.HeliceTableView = {stockStatus,visibleColumns,essential};
})(typeof window==='undefined'?globalThis:window);
