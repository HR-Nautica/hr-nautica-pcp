import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import XLSX from 'xlsx';
import {importNormalizedProductWorkbook,preflightNormalizedProductWorkbook} from '../../server/product-foundation-import.js';
function workbook(sku='001',unit='KG',status='ATIVO',description='Material'){
 const wb=XLSX.utils.book_new();
 for(const [name,rows] of Object.entries({'Cadastro Unificado':[['ID_Item_Sistema','SKU','Descrição','Tipo_Item','Unidade','Status_Cadastro'],['source',sku,description,'Componente',unit,status]],'BOM Unificada':[['ID_Linha_BOM','ID_Pai','ID_Filho','Quantidade','Status_Vínculo']],'Auditoria':[['Nº','Classificação','Detalhe']]}))XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
 return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
test('importação real PostgreSQL preserva identidade e bloqueia conflitos',async()=>{
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
 try{
 for(const file of ['V003__master_items_and_aliases.sql','V006__product_foundation.sql'])await client.query(await readFile(new URL('../../database/migrations/'+file,import.meta.url),'utf8'));
 const options={sourceName:'synthetic.xlsx',actor:'integration'};
 assert.equal((await preflightNormalizedProductWorkbook(workbook())).canImport,true);
 assert.equal(Number((await client.query('SELECT count(*) n FROM master_items')).rows[0].n),0);
 await importNormalizedProductWorkbook(workbook(),options);
 const original=(await client.query('SELECT * FROM master_items')).rows[0];assert.equal(original.unit,'KG');
 assert.equal((await importNormalizedProductWorkbook(workbook(),options)).idempotent,true);
 await importNormalizedProductWorkbook(workbook(' 001 '),options);
 assert.equal((await client.query('SELECT * FROM master_items')).rows[0].id,original.id);
 await client.query("INSERT INTO item_aliases(item_id,namespace,original_code,created_by) VALUES($1,'tiny','ALT','integration')",[original.id]);
 assert.equal((await preflightNormalizedProductWorkbook(workbook('ALT'))).summary.aliasItems,1);
 await importNormalizedProductWorkbook(workbook('ALT'),options);
 assert.equal(Number((await client.query('SELECT count(*) n FROM master_items')).rows[0].n),1);
 await assert.rejects(importNormalizedProductWorkbook(workbook('001','UN'),options));
 await assert.rejects(preflightNormalizedProductWorkbook(workbook('002','','ATIVO')));
 await assert.rejects(preflightNormalizedProductWorkbook(workbook('002','M','INVALID')));
 assert.equal(Number((await client.query('SELECT count(*) n FROM master_items')).rows[0].n),1);
 }finally{await client.end();}
});
