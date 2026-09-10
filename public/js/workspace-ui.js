"use strict";

(() => {
  const pageTitles = {
    "page-modelos": "Detalhes da hélice",
    "page-ordens": "Decisão de produção",
    "page-fluxo": "Detalhes da ordem",
    "page-catalogo-fundicao": "Detalhes do bruto",
    "page-fundicao": "Detalhes da programação",
    "page-rastreio-fundicao": "Detalhes da OP de fundição",
    "page-buchas": "Detalhes da bucha",
    "page-estoque-buchas": "Detalhes do estoque"
  };

  const tableSchemas = {
    "analise-table": {
      minWidth: "1680px",
      columns: [
        ["72px", "sticky-index"], ["340px", "sticky-primary"], ["110px", "code"], ["130px", "code"],
        ["92px", "number"], ["92px", "number"], ["92px", "number"], ["92px", "number"],
        ["112px", "number"], ["104px", "number"], ["104px", "status"], ["124px", "number"],
        ["100px", "status"], ["140px", "text"], ["112px", "actions"]
      ]
    },
    "modelos-table": {
      minWidth: "1450px",
      columns: [["132px", "code"], ["360px", "text"], ["150px", "code"], ["132px", "code"], ["320px", "text"], ["112px", "text"], ["132px", "code"], ["132px", "actions"]]
    },
    "buchas-table": {
      minWidth: "1260px",
      columns: [["140px", "code"], ["360px", "text"], ["156px", "text"], ["112px", "number"], ["124px", "number"], ["260px", "text"], ["112px", "actions"]]
    },
    "catalogo-fundicao-table": {
      minWidth: "1340px",
      columns: [["170px", "code"], ["320px", "text"], ["160px", "text"], ["120px", "number"], ["326px", "text"], ["112px", "status"], ["132px", "actions"]]
    },
    "fundicao-programacao-table": {
      minWidth: "1510px",
      columns: [["58px", "status"], ["202px", "code"], ["150px", "number"], ["124px", "number"], ["112px", "number"], ["112px", "status"], ["132px", "number"], ["100px", "number"], ["120px", "number"], ["112px", "date"], ["112px", "date"], ["72px", "number"], ["112px", "actions"]]
    },
    "rastreio-fundicao-table": {
      minWidth: "1490px",
      columns: [["140px", "code"], ["180px", "text"], ["300px", "text"], ["120px", "number"], ["120px", "number"], ["120px", "date"], ["120px", "date"], ["160px", "text"], ["110px", "status"], ["120px", "actions"]]
    },
    "fluxo-table": {
      minWidth: "1540px",
      columns: [["140px", "code"], ["120px", "code"], ["320px", "text"], ["90px", "number"], ["108px", "status"], ["180px", "text"], ["220px", "text"], ["120px", "date"], ["110px", "status"], ["132px", "actions"]]
    },
    "bucha-saldos-table": {
      minWidth: "1330px",
      columns: [["140px", "code"], ["320px", "text"], ["240px", "text"], ["100px", "number"], ["100px", "number"], ["110px", "number"], ["112px", "number"], ["100px", "number"], ["108px", "actions"]]
    },
    "bucha-lotes-table": {
      minWidth: "1280px",
      columns: [["150px", "code"], ["140px", "code"], ["320px", "text"], ["100px", "number"], ["150px", "status"], ["260px", "text"], ["160px", "actions"]]
    },
    "bucha-movimentos-table": {
      minWidth: "1050px",
      columns: [["160px", "code"], ["100px", "status"], ["140px", "code"], ["110px", "number"], ["360px", "text"], ["180px", "date"]]
    }
  };

  let selectedRow = null;
  let sourceActions = [];

  const escapeHtml = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function ensureDrawer() {
    if (document.getElementById("erp-detail-drawer")) return;
    const overlay = document.createElement("div");
    overlay.className = "erp-detail-overlay hidden";
    overlay.id = "erp-detail-overlay";
    overlay.innerHTML = `
      <aside class="erp-detail-drawer" id="erp-detail-drawer" aria-modal="true" role="dialog" aria-labelledby="erp-detail-title">
        <header class="erp-detail-header">
          <div>
            <span class="erp-detail-eyebrow" id="erp-detail-eyebrow">Registro selecionado</span>
            <h2 id="erp-detail-title">Detalhes</h2>
          </div>
          <button type="button" class="erp-detail-close" id="erp-detail-close" aria-label="Fechar detalhes">×</button>
        </header>
        <div class="erp-detail-body" id="erp-detail-body"></div>
        <footer class="erp-detail-footer hidden" id="erp-detail-footer"></footer>
      </aside>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeDrawer();
    });
    document.getElementById("erp-detail-close")?.addEventListener("click", closeDrawer);
    document.getElementById("erp-detail-footer")?.addEventListener("click", event => {
      const action = event.target.closest("[data-drawer-action]");
      if (!action) return;
      const source = sourceActions[Number(action.dataset.drawerAction)];
      if (source) source.click();
    });
  }

  function ensureMobileNavigation() {
    if (document.getElementById("erp-mobile-menu")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "erp-mobile-menu";
    button.className = "erp-mobile-menu";
    button.setAttribute("aria-label", "Abrir navegação");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = "erp-sidebar-backdrop";
    backdrop.className = "erp-sidebar-backdrop hidden";
    backdrop.setAttribute("aria-label", "Fechar navegação");

    const close = () => {
      document.getElementById("sidebar")?.classList.remove("mobile-open");
      backdrop.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", () => {
      const sidebar = document.getElementById("sidebar");
      const willOpen = !sidebar?.classList.contains("mobile-open");
      sidebar?.classList.toggle("mobile-open", willOpen);
      backdrop.classList.toggle("hidden", !willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
    });
    backdrop.addEventListener("click", close);
    document.querySelector(".sidebar-nav")?.addEventListener("click", event => {
      if (event.target.closest(".nav-item")) close();
    });
    document.body.append(backdrop, button);
  }

  function applyTableColumnTypes(table, schema) {
    const headerCells = table.querySelectorAll("thead tr:first-child > th");
    headerCells.forEach((cell, index) => {
      const type = schema.columns[index]?.[1] || "text";
      cell.classList.add(`hr-cell--${type}`);
    });
    table.querySelectorAll("tbody tr").forEach(row => {
      const cells = row.querySelectorAll(":scope > td");
      if (cells.length === 1 && cells[0].hasAttribute("colspan")) {
        cells[0].classList.add(cells[0].classList.contains("empty-cell") ? "hr-cell--empty" : "hr-cell--detail");
        return;
      }
      cells.forEach((cell, index) => {
        const type = schema.columns[index]?.[1] || "text";
        cell.classList.add(`hr-cell--${type}`);
      });
    });
  }

  function normalizeDataTables() {
    Object.entries(tableSchemas).forEach(([id, schema]) => {
      const table = document.getElementById(id);
      if (!table) return;
      table.classList.add("hr-data-table");
      table.style.setProperty("--hr-table-min-width", schema.minWidth);

      table.querySelectorAll(":scope > colgroup").forEach(group => group.remove());
      const colgroup = document.createElement("colgroup");
      colgroup.dataset.hrSchema = id;
      schema.columns.forEach(([width, type]) => {
        const col = document.createElement("col");
        col.style.width = width;
        col.dataset.columnType = type;
        colgroup.appendChild(col);
      });
      table.prepend(colgroup);
      applyTableColumnTypes(table, schema);

      const tbody = table.tBodies[0];
      if (tbody && !table.__hrTableObserver) {
        table.__hrTableObserver = new MutationObserver(() => applyTableColumnTypes(table, schema));
        table.__hrTableObserver.observe(tbody, { childList: true, subtree: true });
      }
    });
  }

  function createPageToolbar(pageId, controlIds, anchorSelector) {
    const page = document.getElementById(pageId);
    if (!page || page.querySelector(":scope > .erp-page-toolbar")) return;
    const controls = controlIds.map(id => document.getElementById(id)).filter(Boolean);
    if (!controls.length) return;
    const toolbar = document.createElement("div");
    toolbar.className = "erp-page-toolbar";
    controls.forEach(control => toolbar.appendChild(control));
    const anchor = page.querySelector(anchorSelector);
    if (anchor) anchor.insertAdjacentElement("afterend", toolbar);
    else page.querySelector(".page-header")?.insertAdjacentElement("afterend", toolbar);
  }

  function createQuickFilters(pageId, selectId, items) {
    const page = document.getElementById(pageId);
    const select = document.getElementById(selectId);
    const toolbar = page?.querySelector(":scope > .erp-page-toolbar");
    if (!page || !select || !toolbar || page.querySelector(":scope > .erp-quick-filters")) return;
    const filters = document.createElement("div");
    filters.className = "erp-quick-filters";
    filters.setAttribute("aria-label", "Filtros rápidos");

    const sync = () => {
      filters.querySelectorAll("button").forEach(button => {
        const active = button.dataset.value === select.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    };
    items.forEach(item => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.value = item.value;
      button.textContent = item.label;
      button.addEventListener("click", () => {
        select.value = item.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
      });
      filters.appendChild(button);
    });
    select.addEventListener("change", sync);
    toolbar.insertAdjacentElement("beforebegin", filters);
    sync();
  }

  function normalizeOperationalPages() {
    createPageToolbar("page-fundicao", ["fundicao-search", "fundicao-filter-status"], ".kpi-grid");
    createPageToolbar("page-rastreio-fundicao", ["rf-search", "rf-filter-status", "rf-btn-refresh"], ".kpi-grid");
    createPageToolbar("page-fluxo", ["fluxo-search", "fluxo-filter-op", "fluxo-filter-status", "btn-refresh-helice-ops"], ".flow-kpi-bar");

    createQuickFilters("page-rastreio-fundicao", "rf-filter-status", [
      { value: "", label: "Todas" },
      { value: "Em aberto", label: "Abertas" },
      { value: "Fundido", label: "Finalizadas" }
    ]);
    createQuickFilters("page-fluxo", "fluxo-filter-status", [
      { value: "", label: "Todas" },
      { value: "em_producao", label: "Em produção" },
      { value: "finalizada", label: "Finalizadas" },
      { value: "refugada", label: "Refugadas" }
    ]);
  }

  function closeDrawer() {
    document.getElementById("erp-detail-overlay")?.classList.add("hidden");
    selectedRow?.classList.remove("erp-row-selected");
    selectedRow = null;
    sourceActions = [];
  }

  function cleanText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function openRowDetails(row) {
    const page = row.closest(".erp-page");
    const table = row.closest("table");
    if (!page || !table || row.querySelector("td[colspan]") || row.classList.contains("pf-details-row")) return;

    const headings = [...table.querySelectorAll("thead th")].map(cleanText);
    const cells = [...row.children].filter(cell => cell.tagName === "TD");
    const fields = cells.map((cell, index) => ({
      label: headings[index] || `Campo ${index + 1}`,
      value: cleanText(cell)
    })).filter(field => field.value && !/^ações$/i.test(field.label));

    if (!fields.length) return;

    ensureDrawer();
    selectedRow?.classList.remove("erp-row-selected");
    selectedRow = row;
    row.classList.add("erp-row-selected");

    const title = pageTitles[page.id] || "Detalhes do registro";
    const identity = fields[0]?.value || "Registro selecionado";
    document.getElementById("erp-detail-title").textContent = title;
    document.getElementById("erp-detail-eyebrow").textContent = identity;

    const body = document.getElementById("erp-detail-body");
    body.innerHTML = `
      <section class="erp-detail-summary">
        <span class="erp-detail-summary-label">Visão geral</span>
        <strong>${escapeHtml(identity)}</strong>
        <p>Informações consolidadas do registro sem sair da página atual.</p>
      </section>
      <section class="erp-detail-section">
        <h3>Informações</h3>
        <dl class="erp-detail-grid">
          ${fields.slice(0, 14).map(field => `
            <div>
              <dt>${escapeHtml(field.label)}</dt>
              <dd>${escapeHtml(field.value)}</dd>
            </div>`).join("")}
        </dl>
      </section>`;

    sourceActions = [...row.querySelectorAll("button, a")].filter(action =>
      !action.disabled && !action.classList.contains("pf-toggle-btn")
    ).slice(0, 4);
    const footer = document.getElementById("erp-detail-footer");
    if (sourceActions.length) {
      footer.innerHTML = sourceActions.map((action, index) => {
        const label = action.getAttribute("title") || cleanText(action) || `Ação ${index + 1}`;
        return `<button type="button" class="${index === 0 ? "btn-primary" : "btn-secondary"}" data-drawer-action="${index}">${escapeHtml(label)}</button>`;
      }).join("");
      footer.classList.remove("hidden");
    } else {
      footer.innerHTML = "";
      footer.classList.add("hidden");
    }

    document.getElementById("erp-detail-overlay").classList.remove("hidden");
  }

  function bindWorkspaceInteractions() {
    ensureDrawer();
    ensureMobileNavigation();
    normalizeOperationalPages();
    normalizeDataTables();
    document.addEventListener("click", event => {
      const activeMenu = event.target.closest(".hr-action-menu");
      document.querySelectorAll(".hr-action-menu[open]").forEach(menu => {
        if (menu !== activeMenu) menu.removeAttribute("open");
      });
      const interactive = event.target.closest("button, a, input, select, textarea, label, summary, details");
      if (interactive) return;
      const row = event.target.closest(".erp-page table tbody tr");
      if (row) openRowDetails(row);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        document.querySelectorAll(".hr-action-menu[open]").forEach(menu => menu.removeAttribute("open"));
      }
      if (event.key === "Escape" && !document.getElementById("erp-detail-overlay")?.classList.contains("hidden")) {
        closeDrawer();
      }
    });
  }

  window.closeErpDetailDrawer = closeDrawer;
  window.openErpRowDetails = openRowDetails;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindWorkspaceInteractions, { once: true });
  } else {
    bindWorkspaceInteractions();
  }
})();
