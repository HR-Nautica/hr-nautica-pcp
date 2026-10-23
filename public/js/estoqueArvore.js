"use strict";

const EARV_STORAGE_KEYS = {
  tree: "hrn_estoque_arvore",
  estoque: "hrn_earv_estoque",
  saidasPeriodo: "hrn_earv_saidas_periodo",
  saidasPrevistas: "hrn_earv_saidas_previstas",
  meta: "hrn_earv_meta",
  quantidadesUsuario: "hrn_earv_quantidades_usuario"
};

const EARV = {
  rows: [],
  familyTree: [],
  expandedFamilies: new Set(),
  expandedComponents: new Set(),
  estoqueMap: {},
  saidasPeriodoMap: {},
  saidasPrevistasMap: {},
  quantidadesUsuario: {},
  estoqueLoaded: false,
  saidasPrevistasLoaded: false,
  loaded: false,
  sortCol: null,
  sortDir: "asc"
};

const OP = {
  op01: { col: "OP 01 (Compras)", label: "Compras", cls: "op01" },
  op02: { col: "OP 02 (Usinagem)", label: "Usinagem", cls: "op02" },
  op03: { col: "OP 03 (Cromo)", label: "Cromo", cls: "op03" },
  op04: { col: "OP 04 (Pintura)", label: "Pintura", cls: "op04" },
  op05: { col: "OP 05 (Montagem)", label: "Montagem", cls: "op05" },
  op06: { col: "OP 06 (Embalagem)", label: "Embalagem", cls: "op06" }
};

const DASH = "&mdash;";
const ARROW_CLOSED = "&#9654;";
const ARROW_OPEN = "&#9660;";
const ARROW_CHILD = "&#8627;";
const SORT_IDLE = "&#8645;";
const SORT_ASC = "&#8593;";
const SORT_DESC = "&#8595;";
const EXCEL_COL_M_INDEX = 12;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\uFFFD]/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function normalizeSku(value) {
  return normalizeText(value).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function escapeJsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, " ");
}

function parseRobustFloat(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (value === null || value === undefined) return NaN;

  let str = normalizeText(value);
  if (!str) return NaN;
  str = str.replace(/[^0-9,.-]/g, "");
  if (!str || str === "-" || str === "," || str === ".") return NaN;

  const hasComma = str.includes(",");
  const hasDot = str.includes(".");
  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");
    str = lastComma > lastDot
      ? str.replace(/\./g, "").replace(",", ".")
      : str.replace(/,/g, "");
  } else if (hasComma) {
    str = str.replace(",", ".");
  }

  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DASH;
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/\.00$/, "").replace(".", ",");
}

function getValue(row, aliases, fallback = "") {
  if (!row || typeof row !== "object") return fallback;
  const wanted = aliases.map(normalizeHeader);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(normalizeHeader(key))) return value;
  }
  return fallback;
}

function normalizeTreeRow(rawRow) {
  const rawQty = getValue(rawRow, ["Quantidade", "Qtd", "Qtde", "Qtd/Un", "QTD UN"], "");
  const row = {
    Posicao: normalizeText(getValue(rawRow, ["Posicao", "Posição", "Pos", "Nivel", "Nível"])),
    SKU: normalizeSku(getValue(rawRow, ["SKU", "Codigo", "Código", "Codigo SKU", "Código SKU", "Código (SKU)"])),
    Descricao: normalizeText(getValue(rawRow, ["Descricao", "Descrição", "Produto", "Componente", "Item"])),
    Quantidade: rawQty,
    QuantidadeOriginal: rawQty,
    Chave_Familia: normalizeText(getValue(rawRow, ["Chave_Familia", "Chave Familia", "Familia", "Família"], ""))
  };

  Object.entries(OP).forEach(([, op]) => {
    row[op.col] = normalizeText(getValue(rawRow, [op.col, op.label, op.col.replace(/[()]/g, "")], ""));
  });

  if (!row.Posicao) {
    const numericPos = normalizeText(getValue(rawRow, ["Posição", "Posicao", "Nivel", "Nível"], ""));
    row.Posicao = numericPos.padStart(2, "0").slice(-2);
  }
  if (row.Posicao === "0") row.Posicao = "00";
  if (row.Posicao === "1") row.Posicao = "01";
  if (row.Posicao === "2") row.Posicao = "02";
  if (!row.Chave_Familia) row.Chave_Familia = row.SKU;

  // Apply user override if present
  const sku = row.SKU;
  if (sku && EARV.quantidadesUsuario && EARV.quantidadesUsuario[sku] !== undefined) {
    row.Quantidade = EARV.quantidadesUsuario[sku];
  }

  return row;
}

async function persistSnapshot(entries) {
  const writes = Object.entries(entries).map(([key, value]) =>
    RemoteStorage.setItem(key, JSON.stringify(value))
  );
  writes.push(RemoteStorage.setItem(EARV_STORAGE_KEYS.meta, JSON.stringify({ updatedAt: new Date().toISOString() })));
  const results = await Promise.all(writes);
  if (results.some(result => result !== true)) {
    throw new Error("O servidor nao confirmou todos os dados importados.");
  }
}

function findSheetName(workbook, preferredNames) {
  const preferred = preferredNames.map(normalizeHeader);
  return workbook.SheetNames.find(name => preferred.includes(normalizeHeader(name))) || workbook.SheetNames[0];
}

function detectColumns(rowsRaw, rules, fallback, required) {
  const requiredKeys = required || Object.keys(rules);
  const scanLimit = Math.min(rowsRaw.length, 25);
  for (let r = 0; r < scanLimit; r++) {
    const row = rowsRaw[r] || [];
    const found = {};
    for (let c = 0; c < row.length; c++) {
      const header = normalizeHeader(row[c]);
      if (!header) continue;
      Object.entries(rules).forEach(([name, matcher]) => {
        if (found[name] === undefined && matcher(header)) found[name] = c;
      });
    }
    if (requiredKeys.every(name => found[name] !== undefined)) {
      return { headerIdx: r, ...fallback, ...found };
    }
  }
  return { headerIdx: 0, ...fallback };
}

async function earv_processTreeExcel(arrayBuffer, options = {}) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = findSheetName(wb, ["arvore", "árvore", "estrutura"]);
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  if (!rawRows.length) throw new Error("Planilha vazia.");

  const rows = rawRows
    .map(normalizeTreeRow)
    .filter(row => row.SKU || row.Descricao);

  if (!rows.length) throw new Error("A planilha de estrutura nao contem itens validos.");
  const commit = async () => {
    await persistSnapshot({ [EARV_STORAGE_KEYS.tree]: rows });
    EARV.rows = rows;
    EARV.familyTree = earv_buildTree(rows);
    EARV.loaded = true;
    EARV.expandedFamilies.clear();
    EARV.expandedComponents.clear();
    return rows.length;
  };
  if (options.prepareOnly) return { count: rows.length, sheet: sheetName, commit };
  return await commit();
}

async function earv_processPCPExcel(arrayBuffer, options = {}) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  let rowsRaw = null;
  let cols = null;
  for (const sheetName of wb.SheetNames) {
    const candidateRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const candidateCols = detectColumns(candidateRows, {
      sku: h => h === "SKU" || h.includes("CODIGO SKU") || h === "CODIGO" || h.startsWith("COD "),
      estoque: h => h.includes("ESTOQUE FISICO") || h === "ESTOQUE" || h.includes("SALDO ATUAL")
    }, {}, ["sku", "estoque"]);
    if (candidateCols.sku !== undefined && candidateCols.estoque !== undefined) {
      rowsRaw = candidateRows;
      cols = candidateCols;
      break;
    }
  }
  if (!rowsRaw || !cols) throw new Error("Aba de estoque com colunas SKU e Estoque Fisico nao localizada.");
  const estoqueMap = {};
  const saidasPeriodoMap = {};

  for (let r = cols.headerIdx + 1; r < rowsRaw.length; r++) {
    const row = rowsRaw[r] || [];
    const sku = normalizeSku(row[cols.sku]);
    if (!sku || sku === "UNDEFINED") continue;

    const estoque = parseRobustFloat(row[cols.estoque]);
    if (!Number.isNaN(estoque)) estoqueMap[sku] = estoque;

    const saidasPeriodo = parseRobustFloat(row[EXCEL_COL_M_INDEX]);
    if (!Number.isNaN(saidasPeriodo)) saidasPeriodoMap[sku] = saidasPeriodo;
  }

  if (!Object.keys(estoqueMap).length) throw new Error("A planilha de estoque nao contem SKUs validos.");
  const result = {
    estoque: Object.keys(estoqueMap).length,
    saidasPeriodo: Object.keys(saidasPeriodoMap).length
  };
  const commit = async () => {
    await persistSnapshot({
      [EARV_STORAGE_KEYS.estoque]: estoqueMap,
      [EARV_STORAGE_KEYS.saidasPeriodo]: saidasPeriodoMap
    });
    EARV.estoqueMap = estoqueMap;
    EARV.saidasPeriodoMap = saidasPeriodoMap;
    EARV.estoqueLoaded = true;
    return result;
  };
  if (options.prepareOnly) return { ...result, commit };
  return await commit();
}

async function earv_processSaidasPrevistasExcel(arrayBuffer, options = {}) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  let rowsRaw = null;
  let cols = null;
  for (const sheetName of wb.SheetNames) {
    const normalizedName = normalizeHeader(sheetName);
    if (!normalizedName.includes("NECESSIDADE") && !normalizedName.includes("SAIDAS") && !normalizedName.includes("VENDAS")) continue;
    const candidateRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const candidateCols = detectColumns(candidateRows, {
      sku: h => h === "SKU" || h.includes("CODIGO SKU") || h === "CODIGO" || h.startsWith("COD "),
      saidas: h => h.includes("SAIDAS PREVISTAS") || h === "SAIDAS" || h.includes("VENDIDO") || h.includes("QUANTIDADE") || h.includes("QTD")
    }, {}, ["sku", "saidas"]);
    if (candidateCols.sku !== undefined && candidateCols.saidas !== undefined) {
      rowsRaw = candidateRows;
      cols = candidateCols;
      break;
    }
  }
  if (!rowsRaw || !cols) throw new Error("Aba de saidas com colunas SKU e Saidas Previstas nao localizada.");
  const map = {};

  for (let r = cols.headerIdx + 1; r < rowsRaw.length; r++) {
    const row = rowsRaw[r] || [];
    const sku = normalizeSku(row[cols.sku]);
    if (!sku || sku === "UNDEFINED") continue;
    const saidas = parseRobustFloat(row[cols.saidas]);
    if (!Number.isNaN(saidas)) map[sku] = saidas;
  }

  if (!Object.keys(map).length) throw new Error("A planilha de saidas nao contem SKUs validos.");
  const count = Object.keys(map).length;
  const commit = async () => {
    await persistSnapshot({ [EARV_STORAGE_KEYS.saidasPrevistas]: map });
    EARV.saidasPrevistasMap = map;
    EARV.saidasPrevistasLoaded = true;
    return count;
  };
  if (options.prepareOnly) return { count, commit };
  return await commit();
}

function earv_buildTree(rows) {
  const families = [];
  let curFam = null;
  let curComp = null;

  rows.forEach(row => {
    const pos = String(row.Posicao || "").trim();
    if (pos === "00") {
      curFam = { row, familyKey: row.Chave_Familia || row.SKU, components: [] };
      curComp = null;
      families.push(curFam);
    } else if (pos === "01") {
      curComp = { row, compKey: `${curFam?.familyKey || ""}|${row.SKU}`, materials: [] };
      if (curFam) curFam.components.push(curComp);
    } else if (pos === "02" && curComp) {
      curComp.materials.push(row);
    }
  });
  return families;
}

function rowText(row) {
  return `${row.SKU || ""} ${row.Descricao || ""}`.toLowerCase();
}

function earv_rowMatches(row, search, opF) {
  if (search && !rowText(row).includes(search)) return false;
  if (opF !== "all" && OP[opF]) {
    const value = normalizeText(row[OP[opF].col]);
    if (!value || value === "-") return false;
  }
  return true;
}

function earv_getFiltered() {
  const search = normalizeText(document.getElementById("estoque-arv-search")?.value || "").toLowerCase();
  const posF = document.getElementById("estoque-arv-filter-pos")?.value || "all";
  const opF = document.getElementById("estoque-arv-filter-op")?.value || "all";

  let fams = EARV.familyTree;
  if (search) {
    fams = fams.filter(fam => [fam.row, ...fam.components.flatMap(c => [c.row, ...c.materials])].some(row => rowText(row).includes(search)));
  }
  if (opF !== "all" && OP[opF]) {
    fams = fams.filter(fam => [fam.row, ...fam.components.flatMap(c => [c.row, ...c.materials])].some(row => {
      const value = normalizeText(row[OP[opF].col]);
      return value && value !== "-";
    }));
  }
  if (posF === "01") fams = fams.filter(f => f.components.length > 0);
  if (posF === "02") fams = fams.filter(f => f.components.some(c => c.materials.length > 0));

  if (EARV.sortCol) {
    const dir = EARV.sortDir === "asc" ? 1 : -1;
    fams = [...fams].sort((a, b) => {
      if (EARV.sortCol === "estoque") {
        const av = EARV.estoqueMap[normalizeSku(a.row.SKU)] ?? -1;
        const bv = EARV.estoqueMap[normalizeSku(b.row.SKU)] ?? -1;
        return (av - bv) * dir;
      }
      if (EARV.sortCol === "qty") {
        return (parseRobustFloat(a.row.Quantidade) - parseRobustFloat(b.row.Quantidade)) * dir;
      }
      const av = EARV.sortCol === "sku" ? a.row.SKU : a.row.Descricao;
      const bv = EARV.sortCol === "sku" ? b.row.SKU : b.row.Descricao;
      return String(av || "").localeCompare(String(bv || ""), "pt-BR") * dir;
    });
  }
  return fams;
}

function earv_opBadge(value, opKey) {
  const clean = normalizeText(value);
  if (!clean || clean === "-") return `<span class="earv-dash">${DASH}</span>`;
  return `<span class="earv-op-badge earv-op-badge--${OP[opKey].cls}">${escapeHtml(clean)}</span>`;
}

function earv_stockCell(sku) {
  if (!EARV.estoqueLoaded) return `<span class="earv-dash" title="Clique em Sincronizar Estoque">${DASH}</span>`;
  const value = EARV.estoqueMap[normalizeSku(sku)];
  if (value === undefined) return '<span class="earv-dash">?</span>';
  if (value <= 0) return '<span class="earv-stock earv-stock--zero">0</span>';
  return `<span class="earv-stock earv-stock--ok">${formatNumber(value)}</span>`;
}

function earv_updateKpis() {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const level00 = EARV.familyTree.map(f => normalizeSku(f.row.SKU));
  let comEstoque = 0;
  let semEstoque = 0;
  if (EARV.estoqueLoaded) {
    level00.forEach(sku => {
      if (EARV.estoqueMap[sku] === undefined) return;
      if (EARV.estoqueMap[sku] > 0) comEstoque++;
      else semEstoque++;
    });
  }
  const countOp = col => EARV.rows.filter(row => {
    const value = normalizeText(row[col]);
    return value && value !== "-";
  }).length;

  set("kpi-arv-total", EARV.rows.length);
  set("kpi-arv-familias", EARV.familyTree.length);
  set("kpi-arv-com-estoque", comEstoque);
  set("kpi-arv-sem-estoque", semEstoque);
  Object.entries(OP).forEach(([key, op]) => set(`kpi-arv-${key}`, countOp(op.col)));
}

function earv_rowLevel00(fam, isExpanded, hasChildrenOverride) {
  const row = fam.row;
  const hasChildren = hasChildrenOverride !== undefined ? hasChildrenOverride : fam.components.length > 0;
  const icon = hasChildren ? (isExpanded ? ARROW_OPEN : ARROW_CLOSED) : "";
  const key = escapeAttr(fam.familyKey);
  const jsKey = escapeJsString(fam.familyKey);
  return `
    <tr class="earv-row-00 ${isExpanded ? "earv-expanded" : ""}" data-family="${key}" style="cursor:${hasChildren ? "pointer" : "default"};" onclick="earv_toggleFamily('${jsKey}')">
      <td class="earv-td earv-td--desc"><div class="earv-desc-wrap"><span class="earv-toggle-btn ${hasChildren ? "" : "earv-toggle-invisible"}">${icon}</span><span class="earv-desc-text earv-desc--00">${escapeHtml(row.Descricao)}</span></div></td>
      <td class="earv-td earv-td--sku earv-sku--00">${escapeHtml(row.SKU)}</td>
      <td class="earv-td"><span class="earv-nivel-badge earv-nivel--00">Item Final</span></td>
      <td class="earv-td earv-td--num" onclick="event.stopPropagation()">${earv_renderQtyCell(row)}</td>
      <td class="earv-td earv-td--estoque" onclick="event.stopPropagation()">${earv_stockCell(row.SKU)}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op01.col], "op01")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op02.col], "op02")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op03.col], "op03")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op04.col], "op04")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op05.col], "op05")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op06.col], "op06")}</td>
    </tr>`;
}

function earv_rowLevel01(comp, isExpanded, hasMatOverride) {
  const row = comp.row;
  const hasMat = hasMatOverride !== undefined ? hasMatOverride : comp.materials.length > 0;
  const icon = hasMat ? (isExpanded ? ARROW_OPEN : ARROW_CLOSED) : "";
  const key = escapeAttr(comp.compKey);
  const jsKey = escapeJsString(comp.compKey);
  return `
    <tr class="earv-row-01" data-comp="${key}" style="cursor:${hasMat ? "pointer" : "default"};" onclick="${hasMat ? `earv_toggleComp('${jsKey}')` : ""}">
      <td class="earv-td earv-td--desc"><div class="earv-desc-wrap earv-indent-01"><span class="earv-toggle-btn earv-toggle-sm ${hasMat ? "" : "earv-toggle-invisible"}">${icon}</span><span class="earv-arrow">${ARROW_CHILD}</span><span class="earv-desc-text earv-desc--01">${escapeHtml(row.Descricao)}</span></div></td>
      <td class="earv-td earv-td--sku earv-sku--01">${escapeHtml(row.SKU)}</td>
      <td class="earv-td"><span class="earv-nivel-badge earv-nivel--01">Componente</span></td>
      <td class="earv-td earv-td--num" onclick="event.stopPropagation()">${earv_renderQtyCell(row)}</td>
      <td class="earv-td earv-td--estoque" onclick="event.stopPropagation()">${earv_stockCell(row.SKU)}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op01.col], "op01")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op02.col], "op02")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op03.col], "op03")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op04.col], "op04")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op05.col], "op05")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op06.col], "op06")}</td>
    </tr>`;
}

function earv_rowLevel02(row) {
  return `
    <tr class="earv-row-02">
      <td class="earv-td earv-td--desc"><div class="earv-desc-wrap earv-indent-02"><span class="earv-arrow earv-arrow--muted">${ARROW_CHILD}</span><span class="earv-desc-text earv-desc--02">${escapeHtml(row.Descricao)}</span></div></td>
      <td class="earv-td earv-td--sku earv-sku--02">${escapeHtml(row.SKU)}</td>
      <td class="earv-td"><span class="earv-nivel-badge earv-nivel--02">Material</span></td>
      <td class="earv-td earv-td--num" onclick="event.stopPropagation()">${earv_renderQtyCell(row)}</td>
      <td class="earv-td earv-td--estoque">${earv_stockCell(row.SKU)}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op01.col], "op01")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op02.col], "op02")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op03.col], "op03")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op04.col], "op04")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op05.col], "op05")}</td>
      <td class="earv-td">${earv_opBadge(row[OP.op06.col], "op06")}</td>
    </tr>`;
}

function earv_render() {
  const tbody = document.getElementById("estoque-arv-body");
  const count = document.getElementById("estoque-arv-count");
  if (!tbody) return;

  if (!EARV.loaded) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-cell" style="padding:3rem;font-size:1rem;">Clique em <strong>Sync Arvore</strong> para importar <code>fabri1_arvore_com_chave_familia.xlsx</code>.</td></tr>`;
    if (count) count.textContent = "0 itens";
    earv_updateKpis();
    return;
  }

  const search = normalizeText(document.getElementById("estoque-arv-search")?.value || "").toLowerCase();
  const posF = document.getElementById("estoque-arv-filter-pos")?.value || "all";
  const opF = document.getElementById("estoque-arv-filter-op")?.value || "all";
  const hasFilter = search !== "" || opF !== "all";
  const fams = earv_getFiltered();
  const html = [];
  let totalVisible = 0;

  fams.forEach(fam => {
    const famMatchesSelf = earv_rowMatches(fam.row, search, opF);
    const filteredComponents = [];
    fam.components.forEach(comp => {
      const compMatchesSelf = earv_rowMatches(comp.row, search, opF);
      const matchedMaterials = comp.materials.filter(mat => earv_rowMatches(mat, search, opF));
      if (!hasFilter || famMatchesSelf || compMatchesSelf || matchedMaterials.length > 0) {
        const matsToShow = (famMatchesSelf || compMatchesSelf) ? comp.materials : matchedMaterials;
        filteredComponents.push({ comp, matchedMaterials: matsToShow });
      }
    });

    if (hasFilter && !famMatchesSelf && filteredComponents.length === 0) return;

    const hasActualChildren = fam.components.length > 0;
    const isExpanded = hasFilter ? filteredComponents.length > 0 : EARV.expandedFamilies.has(fam.familyKey);
    totalVisible++;
    if (["all", "00", "01", "02"].includes(posF)) html.push(earv_rowLevel00(fam, isExpanded, hasActualChildren));

    if (isExpanded || posF === "01" || posF === "02") {
      filteredComponents.forEach(({ comp, matchedMaterials }) => {
        const compHasActualMaterials = comp.materials.length > 0;
        const compExpanded = hasFilter ? matchedMaterials.length > 0 : EARV.expandedComponents.has(comp.compKey);
        totalVisible++;
        if (["all", "01", "02"].includes(posF)) html.push(earv_rowLevel01(comp, compExpanded, compHasActualMaterials));
        if ((isExpanded && compExpanded) || posF === "02") {
          matchedMaterials.forEach(mat => { totalVisible++; html.push(earv_rowLevel02(mat)); });
        }
      });
    }
  });

  tbody.innerHTML = html.length ? html.join("") : '<tr><td colspan="11" class="empty-cell">Nenhum item encontrado com esses filtros.</td></tr>';
  if (count) count.textContent = `${fams.length} ${fams.length === 1 ? "familia" : "familias"} - ${totalVisible} linhas`;
  earv_updateKpis();
  earv_updateSortHeaders();
}

function earv_toggleFamily(key) {
  if (EARV.expandedFamilies.has(key)) EARV.expandedFamilies.delete(key);
  else EARV.expandedFamilies.add(key);
  earv_render();
}

function earv_toggleComp(key) {
  if (EARV.expandedComponents.has(key)) EARV.expandedComponents.delete(key);
  else EARV.expandedComponents.add(key);
  earv_render();
}

function earv_expandAll() {
  EARV.familyTree.forEach(f => {
    EARV.expandedFamilies.add(f.familyKey);
    f.components.forEach(c => EARV.expandedComponents.add(c.compKey));
  });
  earv_render();
}

function earv_collapseAll() {
  EARV.expandedFamilies.clear();
  EARV.expandedComponents.clear();
  earv_render();
}

function earv_updateSortHeaders() {
  document.querySelectorAll(".earv-th.earv-sortable").forEach(th => {
    const icon = th.querySelector(".earv-sort-icon");
    if (!icon) return;
    if (th.dataset.col === EARV.sortCol) {
      icon.innerHTML = EARV.sortDir === "asc" ? SORT_ASC : SORT_DESC;
      th.classList.add("earv-th--sorted");
    } else {
      icon.innerHTML = SORT_IDLE;
      th.classList.remove("earv-th--sorted");
    }
  });
}

function parseCachedJson(key, fallback) {
  try {
    const value = RemoteStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function earv_loadFromCache() {
  const quantidadesUsuario = parseCachedJson(EARV_STORAGE_KEYS.quantidadesUsuario, {});
  EARV.quantidadesUsuario = quantidadesUsuario && typeof quantidadesUsuario === "object" ? quantidadesUsuario : {};

  const rows = parseCachedJson(EARV_STORAGE_KEYS.tree, []);
  if (Array.isArray(rows)) {
    EARV.rows = rows.map(normalizeTreeRow);
    EARV.familyTree = earv_buildTree(EARV.rows);
    EARV.loaded = RemoteStorage.getItem(EARV_STORAGE_KEYS.tree) !== null;
  }

  const estoqueMap = parseCachedJson(EARV_STORAGE_KEYS.estoque, {});
  if (RemoteStorage.getItem(EARV_STORAGE_KEYS.estoque) !== null && estoqueMap && typeof estoqueMap === "object") {
    EARV.estoqueMap = estoqueMap;
    EARV.estoqueLoaded = true;
  }

  const saidasPeriodoMap = parseCachedJson(EARV_STORAGE_KEYS.saidasPeriodo, {});
  if (saidasPeriodoMap && typeof saidasPeriodoMap === "object") EARV.saidasPeriodoMap = saidasPeriodoMap;

  const saidasPrevistasMap = parseCachedJson(EARV_STORAGE_KEYS.saidasPrevistas, {});
  if (RemoteStorage.getItem(EARV_STORAGE_KEYS.saidasPrevistas) !== null && saidasPrevistasMap && typeof saidasPrevistasMap === "object") {
    EARV.saidasPrevistasMap = saidasPrevistasMap;
    EARV.saidasPrevistasLoaded = true;
  }
}

async function earv_tryServerLoad() { return false; }

function earv_readFile(file, onArrayBuffer) {
  const reader = new FileReader();
  reader.onload = event => onArrayBuffer(event.target.result);
  reader.onerror = () => { if (typeof showToast === "function") showToast("Falha ao ler o arquivo.", "error"); };
  reader.readAsArrayBuffer(file);
}

function earv_setLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button._origHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Carregando...';
  } else {
    button.disabled = false;
    button.innerHTML = button._origHTML || button.innerHTML;
  }
}

function earv_afterStockUpdate() {
  earv_render();
  if (typeof reprocessNecessidadeData === "function") reprocessNecessidadeData({ persist: false });
  if (typeof renderViniTable === "function") renderViniTable();
  if (typeof renderAnaliseTable === "function") renderAnaliseTable();
  window.dispatchEvent(new CustomEvent("hrn:estoque-componentes-sync", {
    detail: {
      estoque: EARV.estoqueMap,
      saidasPeriodo: EARV.saidasPeriodoMap,
      saidasPrevistas: EARV.saidasPrevistasMap
    }
  }));
}

function earv_initEvents() {
  const btnArv = document.getElementById("btn-estoque-arv-sync");
  const inputArv = document.getElementById("input-estoque-arv-file");
  if (btnArv && inputArv) {
    btnArv.addEventListener("click", () => inputArv.click());
    inputArv.addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      earv_setLoading(btnArv, true);
      earv_readFile(file, async arrayBuffer => {
        try {
          const total = await earv_processTreeExcel(arrayBuffer);
          if (typeof showToast === "function") showToast(`Arvore sincronizada: ${total} linhas substituidas.`, "success");
          earv_afterStockUpdate();
        } catch (error) {
          console.error("[EARV] Erro ao importar arvore", error);
          if (typeof showToast === "function") showToast("Erro ao importar a arvore.", "error");
        } finally {
          earv_setLoading(btnArv, false);
          event.target.value = "";
        }
      });
    });
  }

  const btnEst = document.getElementById("btn-estoque-sync-estoque");
  const inputEst = document.getElementById("input-estoque-sync-file");
  if (btnEst && inputEst) {
    btnEst.addEventListener("click", () => inputEst.click());
    inputEst.addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      earv_setLoading(btnEst, true);
      earv_readFile(file, async arrayBuffer => {
        try {
          const total = await earv_processPCPExcel(arrayBuffer);
          if (typeof showToast === "function") {
            showToast(`Estoque sincronizado: ${total.estoque} SKUs e ${total.saidasPeriodo} saidas no periodo pela coluna M.`, "success");
          }
          earv_afterStockUpdate();
        } catch (error) {
          console.error("[EARV] Erro ao importar estoque", error);
          if (typeof showToast === "function") showToast("Erro ao ler o arquivo de estoque.", "error");
        } finally {
          earv_setLoading(btnEst, false);
          event.target.value = "";
        }
      });
    });
  }

  const btnPrev = document.getElementById("btn-estoque-sync-saidas-previstas");
  const inputPrev = document.getElementById("input-estoque-sync-saidas-previstas-file");
  if (btnPrev && inputPrev) {
    btnPrev.addEventListener("click", () => inputPrev.click());
    inputPrev.addEventListener("change", event => {
      const file = event.target.files[0];
      if (!file) return;
      earv_setLoading(btnPrev, true);
      earv_readFile(file, async arrayBuffer => {
        try {
          const total = await earv_processSaidasPrevistasExcel(arrayBuffer);
          if (typeof showToast === "function") showToast(`Saidas previstas sincronizadas: ${total} SKUs substituidos.`, "success");
          earv_afterStockUpdate();
        } catch (error) {
          console.error("[EARV] Erro ao importar saidas previstas", error);
          if (typeof showToast === "function") showToast("Erro ao ler planilha de saidas previstas.", "error");
        } finally {
          earv_setLoading(btnPrev, false);
          event.target.value = "";
        }
      });
    });
  }

  document.getElementById("btn-earv-expand-all")?.addEventListener("click", earv_expandAll);
  document.getElementById("btn-earv-collapse-all")?.addEventListener("click", earv_collapseAll);

  const btnAdjustTree = document.getElementById("btn-earv-adjust-tree");
  const inputTreeFile = document.getElementById("input-estoque-arv-file");
  if (btnAdjustTree && inputTreeFile) {
    btnAdjustTree.addEventListener("click", (e) => {
      e.preventDefault();
      inputTreeFile.click();
    });

    inputTreeFile.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        if (typeof showToast === "function") showToast(`Lendo planilha de árvore: ${file.name}...`, "info");
        const arrayBuffer = await file.arrayBuffer();
        const count = await earv_processTreeExcel(arrayBuffer);
        if (typeof showToast === "function") showToast(`Árvore de componentes ajustada com sucesso! (${count} itens)`, "success");
        earv_render();
      } catch (err) {
        console.error("[EARV] Erro ao ajustar árvore:", err);
        if (typeof showToast === "function") showToast(`Erro ao ajustar árvore: ${err.message}`, "error");
      } finally {
        inputTreeFile.value = "";
      }
    });
  }

  let debounceTimer;
  document.getElementById("estoque-arv-search")?.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(earv_render, 150);
  });
  document.getElementById("estoque-arv-filter-pos")?.addEventListener("change", earv_render);
  document.getElementById("estoque-arv-filter-op")?.addEventListener("change", earv_render);

  document.querySelectorAll(".earv-th.earv-sortable").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (EARV.sortCol === col) EARV.sortDir = EARV.sortDir === "asc" ? "desc" : "asc";
      else { EARV.sortCol = col; EARV.sortDir = "asc"; }
      earv_render();
    });
  });

  Object.entries({
    "kpi-arv-op01": "op01",
    "kpi-arv-op02": "op02",
    "kpi-arv-op03": "op03",
    "kpi-arv-op04": "op04",
    "kpi-arv-op05": "op05",
    "kpi-arv-op06": "op06"
  }).forEach(([chipId, opKey]) => {
    const chip = document.getElementById(chipId)?.closest(".earv-kpi-chip");
    if (!chip) return;
    chip.style.cursor = "pointer";
    chip.title = `Filtrar por ${OP[opKey].label}`;
    chip.addEventListener("click", () => {
      const select = document.getElementById("estoque-arv-filter-op");
      if (!select) return;
      select.value = select.value === opKey ? "all" : opKey;
      earv_render();
    });
  });
}

async function earv_init() {
  earv_loadFromCache();
  await earv_tryServerLoad();
  earv_initEvents();
  earv_render();
}

document.addEventListener("DOMContentLoaded", earv_init);
window.earv_toggleFamily = earv_toggleFamily;
window.earv_toggleComp = earv_toggleComp;
window.EARV = EARV;
window.OP = OP;
window.earv_toggleDropdown = earv_toggleDropdown;
window.earv_editQty = earv_editQty;
window.earv_refreshFromStorage = earv_loadFromCache;
window.earv_processPCPExcel = earv_processPCPExcel;
window.earv_processSaidasPrevistasExcel = earv_processSaidasPrevistasExcel;
window.earv_processTreeExcel = earv_processTreeExcel;

function earv_renderQtyCell(row) {
  const sku = normalizeSku(row.SKU);
  const origQty = String(row.QuantidadeOriginal || row.Quantidade || "").trim();
  const hasOverride = EARV.quantidadesUsuario && EARV.quantidadesUsuario[sku] !== undefined;
  const isUserInserted = origQty.toLowerCase().includes("inserida") || origQty.toLowerCase().includes("usuario") || origQty.toLowerCase().includes("usuário");

  if (isUserInserted || hasOverride) {
    const displayVal = row.Quantidade;
    return `
      <div class="earv-qty-editable-cell">
        <span class="earv-qty-val">${escapeHtml(displayVal)}</span>
        <button class="earv-btn-edit-qty" onclick="event.stopPropagation(); earv_editQty('${escapeJsString(row.SKU)}')" title="Editar quantidade"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg></button>
      </div>`;
  }
  return escapeHtml(row.Quantidade);
}

function earv_editQty(sku) {
  const cleanSku = normalizeSku(sku);
  const matchedRows = EARV.rows.filter(r => normalizeSku(r.SKU) === cleanSku);
  if (!matchedRows.length) {
    alert("SKU não encontrado na árvore.");
    return;
  }

  const firstRow = matchedRows[0];
  const origQty = firstRow.QuantidadeOriginal || firstRow.Quantidade;
  const currentVal = EARV.quantidadesUsuario[cleanSku] !== undefined
    ? EARV.quantidadesUsuario[cleanSku]
    : origQty;

  const newVal = prompt(`Editar quantidade para o SKU ${cleanSku}:\n(Valor original: ${origQty})`, currentVal);
  if (newVal === null) return;

  const trimmed = newVal.trim();
  if (trimmed === "") {
    delete EARV.quantidadesUsuario[cleanSku];
    matchedRows.forEach(r => {
      r.Quantidade = r.QuantidadeOriginal;
    });
  } else {
    EARV.quantidadesUsuario[cleanSku] = trimmed;
    matchedRows.forEach(r => {
      r.Quantidade = trimmed;
    });
  }

  RemoteStorage.setItem(EARV_STORAGE_KEYS.quantidadesUsuario, JSON.stringify(EARV.quantidadesUsuario));
  persistSnapshot({ [EARV_STORAGE_KEYS.tree]: EARV.rows });
  earv_afterStockUpdate();
}

function earv_toggleDropdown() {
  const menu = document.getElementById("earv-actions-menu");
  if (menu) {
    menu.classList.toggle("hidden");
  }
}

window.addEventListener("click", () => {
  const menu = document.getElementById("earv-actions-menu");
  if (menu && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
  }
});


