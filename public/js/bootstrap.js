"use strict";

const applicationScripts = [
  "/js/db.js",
  "/js/buchas_data.js",
  "/js/fundicao_catalog_data.js",
  "/js/tinyApi.js",
  "/js/estoqueArvore.js",
  "/js/producaoComponentes.js",
  "/js/vini.js",
  "/js/analise.js",
  "/js/rastreio-helices.js",
  "/js/estoque-buchas.js",
  "/js/catalogo-fundicao.js",
  "/js/programacao-fundicao.js",
  "/js/app.js"
];

function loadScript(source) {
  return new Promise((resolve, reject) => {
    // Previne recarregar scripts duplicados caso já existam no DOM
    const existing = document.querySelector(`script[src="${source}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = source;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${source}`));
    document.body.appendChild(script);
  });
}

function requireUserLogin() {
  return new Promise((resolve) => {
    const storageKey = "hrn_login_usuario";
    const userRoleKey = "hrn_usuario_role";
    const session = window.sessionStorage;
    const local = window.localStorage;
    
    const cachedUser = session.getItem(storageKey) || local.getItem(storageKey) || "";
    
    if (cachedUser) {
      window.PCP_CURRENT_USER = cachedUser;
      window.PCP_USER_ROLE = "admin";
      
      const overlay = document.getElementById("login-overlay");
      if (overlay) overlay.classList.add("hidden");
      
      resolve(cachedUser);
      return;
    }
    
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("hidden");
    
    // Submeter Login
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("login-username");
    const passwordInput = document.getElementById("login-password");
    const errorMsg = document.getElementById("login-error");
    
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (errorMsg) errorMsg.classList.add("hidden");

        const rawUser = usernameInput ? usernameInput.value.trim().toLowerCase() : "";
        const username = rawUser || "lucas_admin";
        
        session.setItem(storageKey, username);
        session.setItem(userRoleKey, "admin");
        local.setItem(storageKey, username);
        local.setItem(userRoleKey, "admin");
        window.PCP_CURRENT_USER = username;
        window.PCP_USER_ROLE = "admin";
        
        if (overlay) overlay.classList.add("hidden");
        resolve(username);
      });
    }
  });
}

async function bootstrap() {
  try {
    // 1. Carrega todos os scripts funcionais da aplicação em paralelo para estarem prontos no DOM
    const scriptPromises = applicationScripts.map(src => loadScript(src));

    // 2. Inicializa o RemoteStorage
    try {
      await RemoteStorage.init(() => {
        const overlay = document.getElementById("login-overlay");
        if (overlay && !overlay.classList.contains("hidden")) return;
        if (document.querySelector(".modal-overlay:not(.hidden)")) return;

        if (typeof STATE !== "undefined" && STATE.currentPage && typeof navigate === "function") {
          navigate(STATE.currentPage);
        }
      });
    } catch (rsErr) {
      console.warn("[BOOT] RemoteStorage init alert:", rsErr);
    }

    // 3. Aguarda o término do carregamento dos scripts
    await Promise.all(scriptPromises);

    if (RemoteStorage.length === 0 && typeof DB !== "undefined") {
      DB.seed();
    }
    if (typeof DB !== "undefined") {
      DB.ensureCatalogoAtualizado();
      DB.ensureBuchasAtualizadas();
      DB.ensureBuchasOpsSeed();
      DB.ensureBuchasEntradasSeed();
    }

    // 4. Exige o login do usuário
    await requireUserLogin();

    // 5. Atualiza o usuário ativo no RemoteStorage
    RemoteStorage.currentUser = window.PCP_CURRENT_USER;

    // 6. Dispara evento DOMContentLoaded para inicializar as views e comportamentos
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
