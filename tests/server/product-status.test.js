import test from 'node:test';
import assert from 'node:assert/strict';
import {requireActiveProduct,setProductStatus} from '../../server/product-catalog.js';
const id='00000000-0000-4000-8000-000000000001';
test('bloqueia produto inativo e permite ativo na transação',async()=>{let sql;const client={query:async text=>{sql=text;return {rows:[{id,status:'inactive'}]};}};await assert.rejects(requireActiveProduct(client,id),error=>error.code==='PRODUCT_INACTIVE');assert.match(sql,/FOR SHARE/);client.query=async()=>({rows:[{id,status:'active'}]});assert.equal((await requireActiveProduct(client,id)).id,id);});
test('rejeita status e versão inválidos antes de acessar banco',async()=>{await assert.rejects(setProductStatus(id,'invalid',1,'tester'));await assert.rejects(setProductStatus(id,'active',0,'tester'));});
