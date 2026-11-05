// Production inputs belong to the ERP, never to a Tiny snapshot.
export function calculateStockPlanning(item,productionQuantity=null){
 const number=value=>value===null||value===undefined||!Number.isFinite(Number(value))?null:Number(value);
 const physical=number(item.physical_quantity),sold=number(item.expected_outgoing_quantity),production=number(productionQuantity);
 item.incoming_quantity=production;
 item.stock_one_quantity=physical===null||sold===null?null:physical-sold;
 item.virtual_quantity=item.stock_one_quantity===null||production===null?null:item.stock_one_quantity+production;
 return item;
}
