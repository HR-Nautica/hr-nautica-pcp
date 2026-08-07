import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const buchasExcelPath = path.resolve('public/Novas Planilhas/Buchas.xlsx');
const buchasDataJsPath = path.resolve('public/js/buchas_data.js');

const wb = XLSX.read(fs.readFileSync(buchasExcelPath), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

function clean(val) {
  return String(val ?? '').trim();
}

function extractMotor(descricao) {
  const match = descricao.match(/PARA HÉLICE\s+(.+)$/i);
  return match ? match[1].trim() : 'Geral';
}

const buchas = rows.map((r, index) => {
  const descricao = clean(r['Descrição'] || r['Estoque de Bucha']);
  const sku = clean(r['SKU Bucha']);
  const peso = parseFloat(r['Peso']) || 0;
  const comprimento = parseFloat(r['Comp. Bucha']) || 0;
  const dimensoes = clean(r['Diâmetro x Comprimento']);

  return {
    id: `bh_${(index + 1).toString().padStart(3, '0')}`,
    sku,
    descricao,
    dimensoes: dimensoes || (descricao.match(/BUCHA\s*\(([^)]+)\)/i)?.[1] || ''),
    comprimento: comprimento || (parseFloat(descricao.match(/x\s*(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',', '.')) || 0),
    peso: peso || 0,
    aplicacao: extractMotor(descricao),
  };
});

const content = `/* Arquivo gerado por scripts/generate-buchas-data.js. Não editar manualmente. */\n` +
  `const BUCHAS_VERSION = "2026-08-07";\n` +
  `const BUCHAS_DATA = ${JSON.stringify(buchas, null, 2)};\n`;

fs.writeFileSync(buchasDataJsPath, content, 'utf8');
console.log(`[OK] ${buchas.length} buchas gravadas em ${buchasDataJsPath}`);
