import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const sourcePath = path.resolve('public/Novas Planilhas/Catalogo_Atualizado.xlsx');
const outputPath = path.resolve('public/js/catalogo_data.js');
const sheetName = 'Matriz';
const sourceRange = 'B1:S87';
const catalogVersion = '2026-08-07';

const expectedHeaders = [
  'Descrição',
  'Código (SKU)',
  'Código Bruto',
  'Diâmetro Tubo Anel',
  'Descrição Tiny Tubo Al.',
  'Código (SKU) Tiny Tubo Al.',
  'Comp. Anel',
  'Anel',
  'Diâmetro Latão Bucha',
  'Descrição Tiny Latão',
  'Código (SKU) Tiny Latão',
  'Comp. Bucha',
  'Bucha',
  'Cor',
  'Altura Buchas',
  'Modelo Bucha',
  'Descrição Caixa',
  'Código SKU Caixa',
];

function clean(value) {
  return String(value ?? '').trim();
}

function dimensions(description) {
  const match = description.match(/(\d+(?:[.,]\d+|\s+\d+\/\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+|\s+\d+\/\d+)?)/);
  return match ? { diametro: match[1], passo: match[2] } : { diametro: '', passo: '' };
}

const workbook = XLSX.read(fs.readFileSync(sourcePath), { type: 'buffer', cellDates: true });
if (!workbook.SheetNames.includes(sheetName)) {
  throw new Error(`A aba obrigatória "${sheetName}" não foi encontrada.`);
}

const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
  header: 1,
  defval: '',
  raw: false,
  range: sourceRange,
});

const headers = rows.shift().map(clean);
if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
  throw new Error(`Cabeçalhos inesperados em ${sourceRange}: ${JSON.stringify(headers)}`);
}

const records = rows
  .filter((row) => row.some((value) => clean(value)))
  .map((row, index) => {
    const values = row.map(clean);
    const [
      nome,
      sku,
      codigoBruto,
      diametroTuboAnel,
      descricaoTinyTuboAl,
      skuTinyTuboAl,
      comprimentoAnel,
      anel,
      diametroLataoBucha,
      descricaoTinyLatao,
      skuTinyLatao,
      comprimentoBucha,
      bucha,
      cor,
      alturaBuchas,
      modeloBucha,
      descricaoCaixa,
      skuCaixa,
    ] = values;

    if (!nome || !sku) {
      throw new Error(`Descrição ou SKU ausente na linha ${index + 2} do intervalo ${sourceRange}.`);
    }

    return {
      nome,
      sku,
      codigoBruto,
      diametroTuboAnel,
      descricaoTinyTuboAl,
      skuTinyTuboAl,
      comprimentoAnel,
      anel,
      diametroLataoBucha,
      descricaoTinyLatao,
      skuTinyLatao,
      comprimentoBucha,
      bucha,
      cor,
      alturaBuchas,
      modeloBucha,
      descricaoCaixa,
      skuCaixa,
      pas: '3',
      material: 'Alumínio',
      ...dimensions(nome),
    };
  });

const duplicateSkus = records
  .map((record) => record.sku.toLocaleUpperCase('pt-BR'))
  .filter((sku, index, all) => all.indexOf(sku) !== index);
if (duplicateSkus.length) {
  throw new Error(`SKUs duplicados: ${[...new Set(duplicateSkus)].join(', ')}`);
}

const output = `/* Arquivo gerado por scripts/generate-catalog-data.js. Não editar manualmente. */\n` +
  `const CATALOGO_VERSION = ${JSON.stringify(catalogVersion)};\n` +
  `const CATALOGO_DATA = ${JSON.stringify(records, null, 2)};\n`;

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Catálogo ${catalogVersion}: ${records.length} hélices gravadas em ${outputPath}`);
