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
    document.addEventListener("click", event => {
      const interactive = event.target.closest("button, a, input, select, textarea, label");
      if (interactive) return;
      const row = event.target.closest(".erp-page table tbody tr");
      if (row) openRowDetails(row);
    });
    document.addEventListener("keydown", event => {
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
