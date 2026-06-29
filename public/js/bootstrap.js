"use strict";

const applicationScripts = [
  "/js/db.js",
  "/js/tinyApi.js",
  "/js/estoqueArvore.js",
  "/js/producaoComponentes.js",
  "/js/vini.js",
  "/js/analise.js",
  "/js/app.js"
];

function loadScript(source) {
  return new Promise((resolve, reject) => {
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
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(userRoleKey);
    
    const cachedUser = session.getItem(storageKey) || "";
    const cachedRole = session.getItem(userRoleKey) || "";
    
    if (cachedUser && (cachedUser === "lucas_admin" || cachedRole === "operator")) {
      window.PCP_CURRENT_USER = cachedUser;
      window.PCP_USER_ROLE = cachedUser === "lucas_admin" ? "admin" : "operator";
      
      const overlay = document.getElementById("login-overlay");
      if (overlay) overlay.classList.add("hidden");
      
      resolve(cachedUser);
      return;
    }
    
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("hidden");
    
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("login-username");
    const passwordInput = document.getElementById("login-password");
    const errorMsg = document.getElementById("login-error");
    
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      
      if (!username) {
        errorMsg.textContent = "Por favor, digite o usuário.";
        errorMsg.classList.remove("hidden");
        return;
      }
      
      if (username === "lucas_admin") {
        if (password === "admin123!") {
          session.setItem(storageKey, username);
          session.setItem(userRoleKey, "admin");
          window.PCP_CURRENT_USER = username;
          window.PCP_USER_ROLE = "admin";
          
          if (overlay) overlay.classList.add("hidden");
          resolve(username);
        } else {
          errorMsg.textContent = "Senha incorreta para o administrador!";
          errorMsg.classList.remove("hidden");
        }
      } else {
        if (password === "nautica123") {
          session.setItem(storageKey, username);
          session.setItem(userRoleKey, "operator");
          window.PCP_CURRENT_USER = username;
          window.PCP_USER_ROLE = "operator";
          
          if (overlay) overlay.classList.add("hidden");
          resolve(username);
        } else {
          errorMsg.textContent = "Senha incorreta para operador! Use a senha padrão.";
          errorMsg.classList.remove("hidden");
        }
      }
    });
  });
}
async function bootstrap() {
  try {
    await requireUserLogin();
    await RemoteStorage.init(() => {
      if (document.querySelector(".modal-overlay:not(.hidden)")) return;
      window.location.reload();
    });
    for (const source of applicationScripts) await loadScript(source);
    if (RemoteStorage.length === 0 && typeof DB !== "undefined") {
      DB.seed();
    }
    if (document.readyState !== "loading") {
      document.dispatchEvent(new Event("DOMContentLoaded"));
    }
  } catch (error) {
    console.error("[BOOT]", error);
    const warning = document.getElementById("central-server-warning");
    if (warning) {
      warning.textContent = "Nao foi possivel iniciar: Banco ou API indisponivel.";
      warning.style.display = "block";
    }
  }
}

bootstrap();





