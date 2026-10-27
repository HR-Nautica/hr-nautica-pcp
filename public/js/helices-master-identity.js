"use strict";

// F2B.1C: identidade mestre é uma projeção da ficha de Hélice. Este módulo
// nunca grava app_state e não deduz vínculo por SKU: toda associação é humana.
(function helicesMasterIdentityModule() {
  const activeIntentKeys = new Map();
  const apiRoot = "/api";
  let current = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
  const shortId = (value) => value ? `${String(value).slice(0, 8)}…` : "—";
  const isAdmin = () => window.PCP_USER_ROLE === "admin";
  const eventKey = (scope) => {
    if (!activeIntentKeys.has(scope)) {
      const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      activeIntentKeys.set(scope, `helices-link-ui:${scope}:${suffix}`);
    }
    return activeIntentKeys.get(scope);
  };
  const clearIntent = (scope) => activeIntentKeys.delete(scope);
  const notice = (message, type = "error") => {
    if (typeof window.showToast === "function") window.showToast(message, type);
  };

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${apiRoot}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch {
      const error = new Error("Não foi possível comunicar com o servidor de identidade.");
      error.status = 503;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Não foi possível concluir a operação.");
      error.status = response.status;
      error.code = payload.code;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function humanError(error) {
    if (error?.status === 403) return "Sua sessão não tem permissão para gerir este vínculo.";
    if (error?.status === 404) return "A origem ou o Item Mestre não está mais disponível. Atualize a ficha.";
    if (error?.status === 409) return "O vínculo foi alterado por outra operação. Atualize a ficha antes de tentar novamente.";
    if (error?.status === 503) return "O serviço de identidade está indisponível no momento.";
    return error?.message || "Não foi possível concluir a operação.";
  }

  function originSummary(modelo) {
    return `${modelo.nome || "Hélice sem descrição"}${modelo.sku ? ` · SKU legado ${modelo.sku}` : ""}`;
  }

  function shell(modelo, content) {
    return `
      <div class="ficha-card-section ficha-master-identity" data-origin-uid="${escapeHtml(modelo.origin_uid || "")}">
        <div class="ficha-master-identity__heading">
          <div><h4>Identidade do produto</h4><p>Vínculo explícito entre esta ficha e o Item Mestre.</p></div>
          <span class="ficha-master-identity__status" data-identity-status>Carregando</span>
        </div>
        <div class="ficha-master-identity__content">${content}</div>
      </div>`;
  }

  function technicalOrigin(modelo) {
    return `<div class="ficha-master-identity__technical">SKU atual: <strong>${escapeHtml(modelo.sku || "—")}</strong> · Origem técnica: <code title="${escapeHtml(modelo.origin_uid)}">${escapeHtml(shortId(modelo.origin_uid))}</code></div>`;
  }

  function renderLegacy(modelo) {
    return shell(modelo, `<p class="ficha-master-identity__message">Este registro legado ainda não possui <code>origin_uid</code>. A associação permanece bloqueada até uma reconciliação controlada.</p>`);
  }

  function renderReadOnly(modelo) {
    return shell(modelo, `<p class="ficha-master-identity__message">A gestão de identidade está disponível apenas para administradores enquanto a decisão D-005 estiver pendente.</p>${technicalOrigin(modelo)}`);
  }

  function renderUnlinked(modelo) {
    return shell(modelo, `
      <p class="ficha-master-identity__message">Nenhum Item Mestre está associado a esta Hélice.</p>
      <div class="ficha-master-identity__actions"><button type="button" class="btn-secondary" data-identity-action="search">Consultar e associar</button></div>
      ${technicalOrigin(modelo)}`);
  }

  function renderLinked(modelo, link, item) {
    const itemLine = item
      ? `<strong>${escapeHtml(item.primary_sku)}</strong><span>${escapeHtml(item.description)} · ${escapeHtml(item.unit)}</span>`
      : `<strong>Item Mestre ${escapeHtml(shortId(link.master_item_id))}</strong><span>Detalhes indisponíveis; atualize a ficha.</span>`;
    return shell(modelo, `
      <div class="ficha-master-identity__item">${itemLine}</div>
      <div class="ficha-master-identity__meta">Associado manualmente · versão ${escapeHtml(link.version)} · ${escapeHtml(link.linked_by || "—")}</div>
      <div class="ficha-master-identity__actions"><button type="button" class="btn-ghost ficha-master-identity__unlink" data-identity-action="unlink">Desvincular…</button></div>
      ${technicalOrigin(modelo)}`);
  }

  function renderError(modelo, error) {
    return shell(modelo, `<p class="ficha-master-identity__message ficha-master-identity__message--error">${escapeHtml(humanError(error))}</p><div class="ficha-master-identity__actions"><button type="button" class="btn-secondary" data-identity-action="reload">Tentar novamente</button></div>${technicalOrigin(modelo)}`);
  }

  function place(modelo, markup, status, kind = "") {
    const body = document.getElementById("ficha-body");
    if (!body || current?.id !== modelo.id) return null;
    body.querySelector(".ficha-master-identity")?.remove();
    body.insertAdjacentHTML("beforeend", markup);
    const section = body.querySelector(".ficha-master-identity");
    const badge = section?.querySelector("[data-identity-status]");
    if (badge) { badge.textContent = status; badge.dataset.kind = kind; }
    wire(section, modelo);
    return section;
  }

  async function load(modelo) {
    if (!modelo?.origin_uid) return place(modelo, renderLegacy(modelo), "Legado", "warning");
    if (!isAdmin()) return place(modelo, renderReadOnly(modelo), "Restrito", "muted");
    place(modelo, shell(modelo, `<p class="ficha-master-identity__message">Consultando vínculo oficial…</p>${technicalOrigin(modelo)}`), "Carregando", "loading");
    try {
      const result = await request(`/catalog-links/helices/${encodeURIComponent(modelo.origin_uid)}`);
      if (!result.link) return place(modelo, renderUnlinked(modelo), "Sem vínculo", "neutral");
      let item = null;
      try { item = (await request(`/master-items/${encodeURIComponent(result.link.master_item_id)}`)).item; } catch (error) {
        if (error.status !== 404) throw error;
      }
      const section = place(modelo, renderLinked(modelo, result.link, item), "Vinculado", "success");
      if (section) {
        section.dataset.linkId = result.link.id;
        section.dataset.linkVersion = String(result.link.version);
      }
      return section;
    } catch (error) {
      return place(modelo, renderError(modelo, error), error.status === 409 ? "Conflito" : "Erro", "error");
    }
  }

  function searchPanel(modelo) {
    const section = document.querySelector(".ficha-master-identity");
    if (!section) return;
    section.querySelector(".ficha-master-identity__content").innerHTML = `
      <div class="ficha-master-identity__confirm"><strong>Associar Item Mestre existente</strong><span>${escapeHtml(originSummary(modelo))}</span></div>
      <label class="ficha-master-identity__label">Buscar por SKU ou descrição<input type="search" class="form-input" data-identity-search autocomplete="off" placeholder="Digite ao menos 2 caracteres"></label>
      <div class="ficha-master-identity__results" data-identity-results aria-live="polite"></div>
      <div class="ficha-master-identity__actions"><button type="button" class="btn-ghost" data-identity-action="cancel">Cancelar</button></div>
      ${technicalOrigin(modelo)}`;
    wire(section, modelo);
    section.querySelector("[data-identity-search]")?.focus();
  }

  async function search(modelo, query) {
    const target = document.querySelector("[data-identity-results]");
    if (!target) return;
    if (query.trim().length < 2) { target.innerHTML = "<p>Informe ao menos 2 caracteres para pesquisar.</p>"; return; }
    target.innerHTML = "<p>Buscando Itens Mestres…</p>";
    try {
      const result = await request(`/master-items?family=helices&status=active&limit=20&query=${encodeURIComponent(query.trim())}`);
      target.innerHTML = result.items?.length ? result.items.map((item) => `<button type="button" class="ficha-master-identity__result" data-master-item="${escapeHtml(item.id)}"><strong>${escapeHtml(item.primary_sku)}</strong><span>${escapeHtml(item.description)} · ${escapeHtml(item.unit)}</span></button>`).join("") : "<p>Nenhum Item Mestre de Hélices encontrado.</p>";
    } catch (error) { target.innerHTML = `<p class="ficha-master-identity__message--error">${escapeHtml(humanError(error))}</p>`; }
  }

  function associationConfirmation(modelo, masterItemId) {
    const section = document.querySelector(".ficha-master-identity");
    const result = Array.from(section?.querySelectorAll("[data-master-item]") || [])
      .find((candidate) => candidate.dataset.masterItem === masterItemId);
    if (!section || !result) return;
    const masterSku = result.querySelector("strong")?.textContent || "Item Mestre";
    const masterDescription = result.querySelector("span")?.textContent || "";
    section.querySelector(".ficha-master-identity__content").innerHTML = `
      <div class="ficha-master-identity__confirm"><strong>Confirmar associação explícita</strong><span>Hélice: ${escapeHtml(originSummary(modelo))}</span><span>Item Mestre: ${escapeHtml(masterSku)} · ${escapeHtml(masterDescription)}</span></div>
      <label class="ficha-master-identity__label">Justificativa<input class="form-input" data-identity-reason maxlength="500" placeholder="Ex.: validação técnica do cadastro" required></label>
      <p class="ficha-master-identity__message">A associação não é automática por SKU e não altera os dados técnicos da Hélice.</p>
      <div class="ficha-master-identity__actions"><button type="button" class="btn-ghost" data-identity-action="search">Voltar</button><button type="button" class="btn-primary" data-identity-action="confirm-link" data-master-item="${escapeHtml(masterItemId)}">Confirmar associação</button></div>
      ${technicalOrigin(modelo)}`;
    wire(section, modelo);
  }

  async function createLink(modelo, masterItemId) {
    const reason = document.querySelector("[data-identity-reason]")?.value.trim();
    if (!reason) { notice("Informe a justificativa da associação.", "warning"); return; }
    const button = document.querySelector('[data-identity-action="confirm-link"]');
    if (button) { button.disabled = true; button.textContent = "Associando…"; }
    const scope = `create:${modelo.origin_uid}:${masterItemId}`;
    try {
      await request("/catalog-links/helices", { method: "POST", body: JSON.stringify({ eventKey: eventKey(scope), data: { originUid: modelo.origin_uid, masterItemId, reconciliationMethod: "manual", reason } }) });
      clearIntent(scope);
      notice("Item Mestre associado à Hélice.", "success");
      await load(modelo);
    } catch (error) { if (button) { button.disabled = false; button.textContent = "Confirmar associação"; } notice(humanError(error), "error"); }
  }

  function unlinkConfirmation(modelo) {
    const section = document.querySelector(".ficha-master-identity");
    const linkId = section?.dataset.linkId;
    const version = section?.dataset.linkVersion;
    if (!section || !linkId || !version) return;
    section.querySelector(".ficha-master-identity__content").innerHTML = `
      <div class="ficha-master-identity__confirm"><strong>Confirmar desvinculação</strong><span>O histórico do vínculo será preservado; os dados técnicos da Hélice não serão alterados.</span></div>
      <label class="ficha-master-identity__label">Justificativa<input class="form-input" data-identity-unlink-reason maxlength="500" placeholder="Motivo da desvinculação" required></label>
      <div class="ficha-master-identity__actions"><button type="button" class="btn-ghost" data-identity-action="reload">Cancelar</button><button type="button" class="btn-danger" data-identity-action="confirm-unlink" data-link-id="${escapeHtml(linkId)}" data-link-version="${escapeHtml(version)}">Confirmar desvinculação</button></div>
      ${technicalOrigin(modelo)}`;
    wire(section, modelo);
  }

  async function unlink(modelo, linkId, version) {
    const reason = document.querySelector("[data-identity-unlink-reason]")?.value.trim();
    if (!reason) { notice("Informe a justificativa da desvinculação.", "warning"); return; }
    const scope = `unlink:${linkId}:${version}`;
    try {
      await request(`/catalog-links/helices/${encodeURIComponent(linkId)}/unlink`, { method: "POST", body: JSON.stringify({ eventKey: eventKey(scope), data: { expectedVersion: Number(version), reason } }) });
      clearIntent(scope);
      notice("Vínculo desfeito; o histórico foi preservado.", "success");
      await load(modelo);
    } catch (error) { notice(humanError(error), "error"); }
  }

  function wire(section, modelo) {
    if (!section) return;
    section.querySelector("[data-identity-action='search']")?.addEventListener("click", () => searchPanel(modelo));
    section.querySelector("[data-identity-action='cancel']")?.addEventListener("click", () => load(modelo));
    section.querySelector("[data-identity-action='reload']")?.addEventListener("click", () => load(modelo));
    section.querySelector("[data-identity-action='unlink']")?.addEventListener("click", () => unlinkConfirmation(modelo));
    section.querySelector("[data-identity-action='confirm-link']")?.addEventListener("click", (event) => createLink(modelo, event.currentTarget.dataset.masterItem));
    section.querySelector("[data-identity-action='confirm-unlink']")?.addEventListener("click", (event) => unlink(modelo, event.currentTarget.dataset.linkId, event.currentTarget.dataset.linkVersion));
    section.querySelector("[data-identity-search]")?.addEventListener("input", (event) => search(modelo, event.currentTarget.value));
    section.querySelectorAll("[data-master-item]").forEach((button) => button.addEventListener("click", () => associationConfirmation(modelo, button.dataset.masterItem)));
  }

  const original = window.openFichaTecnica;
  window.openFichaTecnica = function openFichaTecnicaWithIdentity(id) {
    original(id);
    const modelo = typeof DB !== "undefined" ? DB.getModelos().find((item) => item.id === id) : null;
    if (!modelo) return;
    current = modelo;
    load(modelo);
  };

})();
