import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMasterSku,classifyImport} from '../../server/product-import-preflight.js';
const item={sourceId:'s',sku:'001 a',description:'Material',unit:'KG',family:'componentes',itemType:'Componente',status:'active'};
const product={id:'p',primary_sku:'001 a',primary_sku_normalized:'001 A',description:'Material',unit:'KG',family:'componentes',item_type:'Componente',status:'active'};
test('normalização preserva zeros e espaços internos conforme banco',()=>{assert.equal(normalizeMasterSku(' 001 a '),'001 A');assert.notEqual(normalizeMasterSku('A  B'),normalizeMasterSku('A B'));});
test('classifica novo e existente sem modificar produtos',()=>{assert.equal(classifyImport({items:[item],bomLines:[]},[],[],[]).summary.newItems,1);assert.equal(classifyImport({items:[item],bomLines:[]},[product],[],[]).summary.existingItems,1);});
test('alias inequívoco reaproveita identidade e ambiguidade bloqueia',()=>{const alias={item_id:'p',normalized_code:'001 A',namespace:'tiny',status:'active'},p={...product,primary_sku:'OUTRO',primary_sku_normalized:'OUTRO'};assert.equal(classifyImport({items:[item],bomLines:[]},[p],[alias],[]).summary.aliasItems,1);assert.equal(classifyImport({items:[item],bomLines:[]},[p],[alias,{...alias,namespace:'legacy'}],[]).canImport,false);});
test('divergência de unidade e alias órfão bloqueiam',()=>{assert.equal(classifyImport({items:[item],bomLines:[]},[{...product,unit:'UN'}],[],[]).canImport,false);assert.equal(classifyImport({items:[item],bomLines:[]},[],[{normalized_code:'001 A',item_id:'missing',status:'active',namespace:'tiny'}],[]).canImport,false);});
