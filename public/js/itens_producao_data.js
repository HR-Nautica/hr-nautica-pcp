// Seed data importado de itens_em_produção.xlsx
// Gerado automaticamente em 2026-06-08
// Colunas originais: Descrição | Código (SKU) | Bruto | Localização | Acompanhamento de Peças (qty)

// Mapa de localização da planilha â†’ código de operação do sistema
const LOC_MAP = {
  '1 - produzindo fundido': '01',
  '2 - polimento':          '03',
  '3 -estoque bruto (codan)': '03',
  '4 - codan \nusinagem':   '04',
  '4 - codan usinagem':     '04',
  '5 - estoque usinado':    '04',
  '6 - pintura':            '05',
  '7 - embuchamento':       '06',
  '8 - gravação':           '07',
  '9 - entrada em estoque': '07',
};

function mapLocToOp(loc) {
  if (!loc) return '01';
  const key = loc.toLowerCase().trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const [k, v] of Object.entries(LOC_MAP)) {
    if (key.includes(k.replace(/\n/g, '').trim()) || k.replace(/\n/g, '').trim().includes(key.replace(/\n/g, '').trim())) {
      return v;
    }
  }
  // fallback por palavra-chave
  if (key.includes('fundid') || key.includes('fundind') || key.includes('fundindo')) return '01';
  if (key.includes('vulcaniz')) return '02';
  if (key.includes('polimento')) return '03';
  if (key.includes('estoque bruto') || key.includes('codan)')) return '03';
  if (key.includes('usinagem')) return '04';
  if (key.includes('estoque usinado')) return '04';
  if (key.includes('pintura')) return '05';
  if (key.includes('embuchamento')) return '06';
  if (key.includes('grava')) return '07';
  if (key.includes('entrada')) return '07';
  return '01';
}

const ITENS_PRODUCAO = [
  // Coquilhas (matéria-prima / processo de fundição)
  { nome: 'COQUILHA 02', sku: 'COQUILHA 02', bruto: 'COQUILHA 02', localizacao: '1 - Produzindo Fundido', qty: 0 },
  { nome: 'COQUILHA 03', sku: 'COQUILHA 03', bruto: 'COQUILHA 03', localizacao: '1 - Produzindo Fundido', qty: 400 },
  { nome: 'COQUILHA 04', sku: 'COQUILHA 04', bruto: 'COQUILHA 04', localizacao: '1 - Produzindo Fundido', qty: 500 },
  { nome: 'COQUILHA 05', sku: 'COQUILHA 05', bruto: 'COQUILHA 05', localizacao: '1 - Produzindo Fundido', qty: 0 },
  { nome: 'COQUILHA 06', sku: 'COQUILHA 06', bruto: 'COQUILHA 06', localizacao: '2 - Polimento', qty: 600 },
  { nome: 'COQUILHA 06', sku: 'COQUILHA 06', bruto: 'COQUILHA 06', localizacao: '1 - Produzindo Fundido', qty: 2244 },
  { nome: 'COQUILHA 07', sku: 'COQUILHA 07', bruto: 'COQUILHA 07', localizacao: '1 - Produzindo Fundido', qty: 0 },
  { nome: 'COQUILHA 10', sku: 'COQUILHA 10', bruto: 'COQUILHA 10', localizacao: '1 - Produzindo Fundido', qty: 300 },
  { nome: 'COQUILHA 12', sku: 'COQUILHA 12', bruto: 'COQUILHA 12', localizacao: '1 - Produzindo Fundido', qty: 0 },
  { nome: 'COQUILHA 14', sku: 'COQUILHA 14', bruto: 'COQUILHA 14', localizacao: '1 - Produzindo Fundido', qty: 0 },
  { nome: 'COQUILHA 16', sku: 'COQUILHA 16', bruto: 'COQUILHA 16', localizacao: '1 - Produzindo Fundido', qty: 300 },
  { nome: 'COQUILHA 21', sku: 'COQUILHA 21', bruto: 'COQUILHA 21', localizacao: '1 - Produzindo Fundido', qty: 171 },
  // Hélices em produção
  { nome: 'HÃ‰LICE MERCURY 40 SUPER 10 3/8 X 13', sku: 'HR HM 010', bruto: 'COQUILHA 14', localizacao: '4 - CODAN  Usinagem', qty: 301 },
  { nome: 'HÃ‰LICE MERCURY 40/50 HP SUPER 10 1/2 X 13', sku: 'HR HM 037', bruto: 'COQUILHA 12', localizacao: '4 - CODAN  Usinagem', qty: 115 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 11', sku: 'HR HY 012', bruto: 'COQUILHA 02', localizacao: '2 - Polimento', qty: 294 },
  { nome: 'HÃ‰LICE SUZUKI 40/55/60/65 HP 11 1/2 X 13', sku: 'HR HS 005', bruto: 'COQUILHA 13', localizacao: '5 - Estoque Usinado', qty: 130 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 1/4 X 14', sku: 'HR HY 036', bruto: 'COQUILHA 07', localizacao: '3 -Estoque Bruto (CODAN)', qty: 140 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 1/4 X 14', sku: 'HR HY 036', bruto: 'COQUILHA 07', localizacao: '2 - Polimento', qty: 149 },
  { nome: 'HÃ‰LICE MERCURY 25/30 HP SEA-PRO 9.6  X 13', sku: 'HR HM 021', bruto: 'COQUILHA 21', localizacao: '6 - Pintura', qty: 97 },
  { nome: 'HÃ‰LICE MERCURY 25/30 HP SEA-PRO 9.9  X 13 MT1763', sku: 'HR HM 023', bruto: 'COQUILHA 21', localizacao: '6 - Pintura', qty: 266 },
  { nome: 'HÃ‰LICE HIDEA 15 HP 9 1/4 X 11', sku: 'HR HHI 001', bruto: 'COQUILHA 02', localizacao: '3 -Estoque Bruto (CODAN)', qty: 90 },
  { nome: 'HÃ‰LICE MERCURY 15 SUPER 9 1/4 X 10', sku: 'HR HM 005', bruto: 'COQUILHA 06', localizacao: '6 - Pintura', qty: 141 },
  { nome: 'HÃ‰LICE HIDEA 15 HP 9 1/4 X 11', sku: 'HR HHI 001', bruto: 'COQUILHA 02', localizacao: '3 -Estoque Bruto (CODAN)', qty: 167 },
  { nome: 'HÃ‰LICE YAMAHA 60 / 140 HP 13 3/4 X 15', sku: 'HR HY 029', bruto: 'nr 32', localizacao: '7 - Embuchamento', qty: 43 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '8 - Gravação', qty: 581 },
  { nome: 'HÃ‰LICE J/E 25/35 HP 10 X 13 STD', sku: 'HR HJ 006', bruto: 'nr 03', localizacao: '5 - Estoque Usinado', qty: 73 },
  { nome: 'HÃ‰LICE J/E 25/35 HP 10 X 15', sku: 'HR HJ 014', bruto: 'nr 04', localizacao: '5 - Estoque Usinado', qty: 196 },
  { nome: 'HÃ‰LICE MERCURY 15 SUPER 9 1/4 X 9', sku: 'HR HM 004', bruto: 'COQUILHA 11', localizacao: '7 - Embuchamento', qty: 249 },
  { nome: 'HÃ‰LICE MERCURY 150/250 HP 14 X 19', sku: 'HR HR 024', bruto: 'nr 55', localizacao: '4 - CODAN  Usinagem', qty: 25 },
  { nome: 'HÃ‰LICE MERCURY 150/250 HP V6 14 1/2 X 19', sku: 'HR HM 036', bruto: 'COQUILHA 08', localizacao: '8 - Gravação', qty: 4 },
  { nome: 'HÃ‰LICE MERCURY 150/250 HP V6 14 1/2 X 19', sku: 'HR HM 036', bruto: 'COQUILHA 08', localizacao: '4 - CODAN  Usinagem', qty: 126 },
  { nome: 'HÃ‰LICE MERCURY 25/30 HP SEA-PRO 9.6  X 13', sku: 'HR HM 021', bruto: 'COQUILHA 21', localizacao: '7 - Embuchamento', qty: 189 },
  { nome: 'HÃ‰LICE MERCURY 25/30 SEA-PRO 9 7/8 X 13', sku: 'HR HM 008', bruto: 'COQUILHA 05', localizacao: '6 - Pintura', qty: 28 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 9', sku: 'HR HY 009', bruto: 'COQUILHA 19', localizacao: '8 - Gravação', qty: 10 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '7 - Embuchamento', qty: 423 },
  { nome: 'HÃ‰LICE SUZUKI 15 HP 9 1/4 X 10', sku: 'HR HS 002', bruto: 'COQUILHA 09', localizacao: '7 - Embuchamento', qty: 282 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 1/8 X 12', sku: 'HR HY 023', bruto: 'COQUILHA 04', localizacao: '8 - Gravação', qty: 40 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 1/8 X 12', sku: 'HR HY 023', bruto: 'COQUILHA 04', localizacao: '7 - Embuchamento', qty: 87 },
  { nome: 'HÃ‰LICE MERCURY 75/125 HP 13 X 19', sku: 'HR HM 013', bruto: 'nr 44', localizacao: '8 - Gravação', qty: 22 },
  { nome: 'HÃ‰LICE MERCURY 75/125 HP 13 X 19', sku: 'HR HM 013', bruto: 'nr 44', localizacao: '6 - Pintura', qty: 50 },
  { nome: 'HÃ‰LICE YAMAHA 40 / 55 HP 11 1/8 X 13', sku: 'HR HY 022', bruto: 'COQUILHA 04', localizacao: '8 - Gravação', qty: 260 },
  { nome: 'HÃ‰LICE YAMAHA 40 / 55 HP 11 1/8 X 13', sku: 'HR HY 022', bruto: 'COQUILHA 04', localizacao: '7 - Embuchamento', qty: 24 },
  { nome: 'HÃ‰LICE SUZUKI 25/30 HP 10 1/4 X 12', sku: 'HR HS 012', bruto: 'nr 22', localizacao: '8 - Gravação', qty: 6 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '7 - Embuchamento', qty: 41 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '7 - Embuchamento', qty: 24 },
  { nome: 'HÃ‰LICE MERCURY 75/125 HP 13 1/4 X 17', sku: 'HR HM 012', bruto: 'nr 43', localizacao: '7 - Embuchamento', qty: 29 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 11', sku: 'HR HY 012', bruto: 'COQUILHA 02', localizacao: '7 - Embuchamento', qty: 208 },
  { nome: 'HÃ‰LICE YAMAHA 8 HP 8 1/2 X 8 1/2', sku: 'HR HY 037', bruto: 'nr 06', localizacao: '7 - Embuchamento', qty: 7 },
  { nome: 'HÃ‰LICE YAMAHA 8 HP 8 1/2 X 8 1/2', sku: 'HR HY 037', bruto: 'nr 06', localizacao: '7 - Embuchamento', qty: 41 },
  { nome: 'HÃ‰LICE MERCURY 40 SUPER 10 3/8 X 13', sku: 'HR HM 010', bruto: 'COQUILHA 14', localizacao: '7 - Embuchamento', qty: 80 },
  { nome: 'HÃ‰LICE SUZUKI DF 75/140 HP 14 X 19', sku: 'HR HS 014', bruto: 'nr 33', localizacao: '8 - Gravação', qty: 6 },
  { nome: 'HÃ‰LICE MERCURY 40 SUPER 10 3/8 X 13', sku: 'HR HM 010', bruto: 'COQUILHA 14', localizacao: '7 - Embuchamento', qty: 82 },
  { nome: 'HÃ‰LICE MERCURY 30/60 HP 10 3/8 X 13', sku: 'HR HM 015', bruto: 'nr 45', localizacao: '7 - Embuchamento', qty: 76 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 1/2 X 13', sku: 'HR HY 025', bruto: 'COQUILHA 04', localizacao: '7 - Embuchamento', qty: 41 },
  { nome: 'HÃ‰LICE J/E 15 HP 9 1/2 X 10', sku: 'HR HJ 003', bruto: 'COQUILHA 16', localizacao: '7 - Embuchamento', qty: 159 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '7 - Embuchamento', qty: 513 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '7 - Embuchamento', qty: 252 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '7 - Embuchamento', qty: 267 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '2 - Polimento', qty: 1000 },
  { nome: 'HÃ‰LICE YAMAHA 15 HP 9 1/4 X 10 1/2', sku: 'HR HY 008', bruto: 'INJETADA', localizacao: '7 - Embuchamento', qty: 367 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 X 19', sku: 'HR HY 031', bruto: 'COQUILHA 22', localizacao: '7 - Embuchamento', qty: 41 },
  { nome: 'HELICE YAMAHA 15 HP 9 1/4 X 12', sku: 'HR HY 011', bruto: 'COQUILHA 17', localizacao: '6 - Pintura', qty: 234 },
  { nome: 'HÃ‰LICE SUZUKI 40/55/60/65 HP 11 1/2 X 13', sku: 'HR HS 005', bruto: 'COQUILHA 13', localizacao: '7 - Embuchamento', qty: 30 },
  { nome: 'HÃ‰LICE J/E 25/35 HP 10 X 13 STD', sku: 'HR HJ 006', bruto: 'nr 03', localizacao: '7 - Embuchamento', qty: 23 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 10 1/2 X 13', sku: 'HR HY 044', bruto: 'COQUILHA 12', localizacao: '7 - Embuchamento', qty: 190 },
  { nome: 'HÃ‰LICE SUZUKI DF 75/140 HP 14 X 19', sku: 'HR HS 014', bruto: 'nr 33', localizacao: '7 - Embuchamento', qty: 15 },
  { nome: 'HÃ‰LICE SUZUKI 75/85/115/140 HP 13 1/4 X 17', sku: 'HR HS 007', bruto: 'nr 41', localizacao: '7 - Embuchamento', qty: 12 },
  { nome: 'HÃ‰LICE SUZUKI 15 HP 9 1/4 X 11', sku: 'HR HS 001', bruto: 'COQUILHA 09', localizacao: '7 - Embuchamento', qty: 125 },
  { nome: 'HÃ‰LICE YAMAHA 25/30 HP 9 7/8 X 12', sku: 'HR HY 033', bruto: 'COQUILHA 18', localizacao: '7 - Embuchamento', qty: 68 },
  { nome: 'HÃ‰LICE YAMAHA 40/55 HP 11 X 15', sku: 'HR HY 024', bruto: 'COQUILHA 15', localizacao: '7 - Embuchamento', qty: 178 },
  { nome: 'HÃ‰LICE YAMAHA 25/30 HP 9 7/8 X 12', sku: 'HR HY 033', bruto: 'COQUILHA 18', localizacao: '7 - Embuchamento', qty: 290 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 12 5/8 X 21', sku: 'HR HY 032', bruto: 'COQUILHA 22', localizacao: '6 - Pintura', qty: 51 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '4 - CODAN  Usinagem', qty: 63 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '8 - Gravação', qty: 12 },
  { nome: 'HÃ‰LICE YAMAHA 25/30 HP 9 7/8 X 12', sku: 'HR HY 033', bruto: 'COQUILHA 18', localizacao: '7 - Embuchamento', qty: 188 },
  { nome: 'HÃ‰LICE SUZUKI 25/30 HP 10 1/4 X 13 STD', sku: 'HR HS 003', bruto: 'COQUILHA 20', localizacao: '7 - Embuchamento', qty: 126 },
  { nome: 'HÃ‰LICE SUZUKI 25/30 HP 10 1/4 X 13 STD', sku: 'HR HS 003', bruto: 'COQUILHA 20', localizacao: '7 - Embuchamento', qty: 199 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '4 - CODAN  Usinagem', qty: 71 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 1/4 X 17', sku: 'HR HY 030', bruto: 'COQUILHA 22', localizacao: '2 - Polimento', qty: 52 },
  { nome: 'HÃ‰LICE YAMAHA 60/140 HP 13 X 19', sku: 'HR HY 031', bruto: 'COQUILHA 22', localizacao: '7 - Embuchamento', qty: 41 },
  { nome: 'HÃ‰LICE SUZUKI 25/30 HP 10 1/4 X 12', sku: 'HR HS 012', bruto: 'nr 22', localizacao: '7 - Embuchamento', qty: 328 },
  { nome: 'HÃ‰LICE SUZUKI 75/85/115/140 HP 13 X 19', sku: 'HR HS 008', bruto: 'nr 18', localizacao: '7 - Embuchamento', qty: 8 },
  { nome: 'HÃ‰LICE SUZUKI 75/85/115/140 HP 13 X 19', sku: 'HR HS 008', bruto: 'nr 18', localizacao: '7 - Embuchamento', qty: 9 },
];

