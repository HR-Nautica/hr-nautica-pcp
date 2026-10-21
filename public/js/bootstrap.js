"use strict";

window.PCP_CSRF_TOKEN = "";
const nativeFetch = window.fetch.bind(window);
window.fetch = async function authenticatedFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
  const method = String(init.method || (typeof input !== "string" && input.method) || "GET").toUpperCase();
  if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    if (window.PCP_CSRF_TOKEN) headers.set("X-CSRF-Token", window.PCP_CSRF_TOKEN);
    init = { ...init, headers };
  }
  if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    if (window.PCP_RELEASE_SHA) headers.set("X-HRN-Release-Sha", window.PCP_RELEASE_SHA);
    init = { ...init, headers };
  }
  const response = await nativeFetch(input, init);
  if (response.headers.get("X-HRN-Release-Mismatch") === "1") {
    window.location.reload();
    return response;
  }
  if (response.status === 401 && !url.pathname.startsWith("/api/auth/")) {
    window.PCP_CSRF_TOKEN = "";
    window.location.reload();
  }
  return response;
};

const applicationScripts = [
  "/js/db.js", "/js/buchas_data.js", "/js/fundicao_catalog_data.js", "/js/tinyApi.js",
  "/js/estoqueArvore.js", "/js/producaoComponentes.js", "/js/vini.js", "/js/analise.js",
  "/js/rastreio-helices.js", "/js/estoque-buchas.js", "/js/catalogo-fundicao.js",
  "/js/programacao-fundicao.js", "/js/rastreio-fundicao.js", "/js/workspace-ui.js",
  "/js/syncManagerPage.js", "/js/app.js"
];

function loadScript(source) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${source}"]`);
    if (existing) return resolve();
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${source}`));
    document.body.appendChild(script);
  });
}

function applyAuthenticatedUser(payload) {
  window.PCP_CURRENT_USER = payload.user.username;
  window.PCP_USER_ROLE = payload.user.role;
  window.PCP_CSRF_TOKEN = payload.csrfToken || "";
  return payload.user;
}

function showError(element, message) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
}

function showPasswordChange() {
  const loginForm = document.getElementById("login-form");
  const changeForm = document.getElementById("change-password-form");
  const subtitle = document.getElementById("login-subtitle");
  const error = document.getElementById("change-password-error");
  loginForm?.classList.add("hidden");
  changeForm?.classList.remove("hidden");
  if (subtitle) subtitle.textContent = "Altere a senha temporária para continuar";

  return new Promise((resolve) => {
    changeForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      error?.classList.add("hidden");
      const currentPassword = document.getElementById("current-password")?.value || "";
      const newPassword = document.getElementById("new-password")?.value || "";
      const confirmation = document.getElementById("confirm-password")?.value || "";
      if (newPassword !== confirmation) return showError(error, "A confirmação não corresponde à nova senha.");
      try {
        const response = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Não foi possível alterar a senha.");
        resolve(applyAuthenticatedUser(result));
      } catch (requestError) {
        showError(error, requestError.message);
      }
    });
  });
}

async function requireUserLogin() {
  const overlay = document.getElementById("login-overlay");
  const form = document.getElementById("login-form");
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const error = document.getElementById("login-error");

  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (response.ok) {
      const user = applyAuthenticatedUser(await response.json());
      if (user.mustChangePassword) return await showPasswordChange();
      overlay?.classList.add("hidden");
      return user;
    }
  } catch { /* mostra o login */ }

  overlay?.classList.remove("hidden");
  form?.classList.remove("hidden");
  return await new Promise((resolve) => {
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      error?.classList.add("hidden");
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernameInput?.value.trim() || "", password: passwordInput?.value || "" })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Credenciais inválidas.");
        const user = applyAuthenticatedUser(result);
        resolve(user.mustChangePassword ? await showPasswordChange() : user);
      } catch (requestError) {
        showError(error, requestError.message);
      }
    });
  });
}

async function bootstrap() {
  try {
    await requireUserLogin();
    const scriptPromises = applicationScripts.map((source) => loadScript(source));
    try {
      await RemoteStorage.init(() => {
        const overlay = document.getElementById("login-overlay");
        if (overlay && !overlay.classList.contains("hidden")) return;
        if (document.querySelector(".modal-overlay:not(.hidden)")) return;
        if (typeof STATE !== "undefined" && STATE.currentPage && typeof navigate === "function") navigate(STATE.currentPage);
      });
    } catch (error) {
      console.warn("[BOOT] RemoteStorage init alert:", error);
    }
    await Promise.all(scriptPromises);
    if (RemoteStorage.length === 0 && typeof DB !== "undefined") DB.seed();
    if (typeof DB !== "undefined") {
      DB.ensureCatalogoAtualizado();
      DB.ensureBuchasAtualizadas();
      DB.ensureBuchasOpsSeed();
      DB.ensureBuchasEntradasSeed();
    }
    RemoteStorage.currentUser = window.PCP_CURRENT_USER;
    document.getElementById("login-overlay")?.classList.add("hidden");
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (error) {
    console.error("[BOOT]", error);
    const warning = document.getElementById("central-server-warning");
    if (warning) {
      warning.textContent = "Aviso ao iniciar: " + (error.message || "Verifique o servidor.");
      warning.style.display = "block";
    }
  }
}

bootstrap();
