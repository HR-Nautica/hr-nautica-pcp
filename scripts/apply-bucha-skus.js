import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import XLSX from 'xlsx';

const buchasPath = path.resolve('public/Novas Planilhas/Buchas.xlsx');
const catalogDataPath = path.resolve('public/js/catalogo_data.js');
const generateCatalogScriptPath = path.resolve('scripts/generate-catalog-data.js');
const newVersion = '2026-08-07';

// 1. Ler a planilha Buchas.xlsx
const wbBuchas = XLSX.read(fs.readFileSync(buchasPath), { type: 'buffer' });
const buchasRows = XLSX.utils.sheet_to_json(wbBuchas.Sheets['Planilha1'] || wbBuchas.Sheets[wbBuchas.SheetNames[0]]);

const buchasMap = new Map();
buchasRows.forEach((row) => {
  const desc = String(row['Estoque de Bucha'] || '').trim().toLowerCase();
  const sku = String(row['SKU Bucha'] || '').trim();
  if (desc && sku) {
    buchasMap.set(desc, sku);
  }
});

console.log(`[Buchas.xlsx] ${buchasMap.size} buchas mapeadas.`);

// 2. Carregar o catálogo atual
const catalogCode = fs.readFileSync(catalogDataPath, 'utf8');
const context = vm.createContext({});
vm.runInContext(`${catalogCode}\nglobalThis.data = CATALOGO_DATA;`, context);
const catalogData = context.data;

let matchedCount = 0;
let emptyCount = 0;

const updatedCatalogData = catalogData.map((item) => {
  const buchaDesc = String(item.modeloBucha || item.bucha || '').trim().toLowerCase();
  const matchedSku = buchasMap.get(buchaDesc) || item.skuBucha || '';
  if (matchedSku) matchedCount++;
  else emptyCount++;

  return {
    ...item,
    skuBucha: matchedSku,
  };
});

console.log(`[VLOOKUP] Resultado: ${matchedCount} hélices com SKU Bucha preenchido, ${emptyCount} sem correspondência (N/A ou pequenas).`);

// 3. Atualizar public/js/catalogo_data.js
const newCatalogContent = `/* Arquivo gerado por scripts/generate-catalog-data.js. Não editar manualmente. */\n` +
  `const CATALOGO_VERSION = ${JSON.stringify(newVersion)};\n` +
  `const CATALOGO_DATA = ${JSON.stringify(updatedCatalogData, null, 2)};\n`;

fs.writeFileSync(catalogDataPath, newCatalogContent, 'utf8');
console.log(`[OK] ${catalogDataPath} atualizado com a versão ${newVersion}.`);

// 4. Atualizar a constante de versão em generate-catalog-data.js
let genContent = fs.readFileSync(generateCatalogScriptPath, 'utf8');
genContent = genContent.replace(/const catalogVersion = '[^']+';/, `const catalogVersion = '${newVersion}';`);

// E garantir que skuBucha seja incluído na geração
if (!genContent.includes('skuBucha')) {
  genContent = genContent.replace(
    /modeloBucha,\s*descricaoCaixa,/,
    'modeloBucha,\n      skuBucha: \'\',\n      descricaoCaixa,'
  );
}
fs.writeFileSync(generateCatalogScriptPath, genContent, 'utf8');
console.log(`[OK] ${generateCatalogScriptPath} atualizado.`);
