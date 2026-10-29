export const normalizeMasterSku = value => String(value ?? '').replace(/^ +| +$/g, '').replace(/[a-z]/g, letter => letter.toUpperCase());
export function classifyImport(parsed, products, aliases, bom) {
  const issues=[], classifications=[], resolved=new Map();
  const loose=value=>normalizeMasterSku(value).replace(/\s+/g,' ');
  for(const item of parsed.items){
    const code=normalizeMasterSku(item.sku),primary=products.filter(p=>p.primary_sku_normalized===code);
    const matches=aliases.filter(a=>a.normalized_code===code&&a.status==='active'&&(!item.aliasNamespace||a.namespace===item.aliasNamespace));
    const ids=new Set([...primary.map(p=>p.id),...matches.map(a=>a.item_id)]);
    let classification=primary.length?'existing':matches.length?'alias':'new';
    if(ids.size>1||(!item.aliasNamespace&&new Set(matches.map(a=>a.namespace)).size>1)||matches.some(a=>!products.some(p=>p.id===a.item_id)))classification='conflict';
    const target=products.find(p=>p.id===[...ids][0]);
    if(!parsed.productsOnly&&target&&['description','unit','family','itemType','status'].some(field=>String(target[field==='itemType'?'item_type':field]??'')!==String(item[field]??'')))classification='conflict';
    if(products.some(p=>loose(p.primary_sku)===loose(item.sku)&&p.primary_sku_normalized!==code))classification='conflict';
    if(classification==='conflict')issues.push({code:'IDENTITY_OR_DATA_CONFLICT',sku:item.sku});
    if(target)resolved.set(item.sourceId,target.id);
    classifications.push({sourceId:item.sourceId,sku:item.sku,classification,productId:target?.id??null});
  }
  const seen=new Set();
  for(const line of parsed.bomLines){
    const parent=resolved.get(line.parentSourceId),child=resolved.get(line.childSourceId),pair=`${line.parentSourceId}:${line.childSourceId}`;
    if(seen.has(pair))issues.push({code:'POSSIBLE_DUPLICATE_BOM',sourceLineId:line.sourceLineId});seen.add(pair);
    const existing=bom.find(b=>b.source_line_id===line.sourceLineId);
    if(existing&&(!parent||!child||existing.parent_product_id!==parent||existing.child_product_id!==child||Number(existing.quantity)!==Number(line.quantity)||existing.unit!==line.unit||existing.link_status!==line.linkStatus))issues.push({code:'BOM_SOURCE_CONFLICT',sourceLineId:line.sourceLineId});
    if(!existing&&parent&&child&&bom.some(b=>b.parent_product_id===parent&&b.child_product_id===child))issues.push({code:'POSSIBLE_DUPLICATE_BOM',sourceLineId:line.sourceLineId});
  }
  return {classifications,issues,canImport:issues.length===0,summary:{newItems:classifications.filter(x=>x.classification==='new').length,existingItems:classifications.filter(x=>x.classification==='existing').length,aliasItems:classifications.filter(x=>x.classification==='alias').length,conflicts:issues.length,invalid:0,bomLines:parsed.bomLines.length}};
}
