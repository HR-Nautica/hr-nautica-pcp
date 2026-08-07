import fs from 'node:fs';
import XLSX from 'xlsx';

const fileBuffer = fs.readFileSync('public/Novas Planilhas/Fundição.xlsx');
const wb = XLSX.read(fileBuffer, { type: 'buffer' });

const sheet1 = XLSX.utils.sheet_to_json(wb.Sheets['Códigos Brutos']);
const sheet2 = XLSX.utils.sheet_to_json(wb.Sheets['Aplicações']);

const coquilhasBrutas = sheet1.map(r => String(r['Código Bruto'] || '').trim()).filter(Boolean);

const aplicacoes = sheet2.map((r, i) => ({
  id: 'fnd_' + String(i + 1).padStart(4, '0'),
  coquilha: String(r['Coluna1'] || '').trim(),
  descricao: String(r['Descrição'] || '').trim(),
  sku: String(r['Código (SKU)'] || '').trim()
})).filter(a => a.coquilha && a.sku);

console.log('Coquilhas count:', coquilhasBrutas.length);
console.log('Aplicações count:', aplicacoes.length);

const output = `/* Auto-generated from public/Novas Planilhas/Fundição.xlsx */
'use strict';

const globalObj = typeof window !== 'undefined' ? window : globalThis;
globalObj.WINDOW_FUNDICAO_CATALOG_DEFAULT = ${JSON.stringify(aplicacoes, null, 2)};
globalObj.WINDOW_COQUILHAS_DEFAULT = ${JSON.stringify(coquilhasBrutas, null, 2)};
`;

fs.writeFileSync('public/js/fundicao_catalog_data.js', output, 'utf8');
console.log('Written public/js/fundicao_catalog_data.js successfully!');
