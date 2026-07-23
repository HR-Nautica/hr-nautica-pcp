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
    
    const cachedUser = session.getItem(storageKey) || "";
    const cachedRole = session.getItem(userRoleKey) || "";
    
    if (cachedUser && (cachedUser === "lucas_admin" || cachedRole === "operator" || cachedRole === "admin")) {
      window.PCP_CURRENT_USER = cachedUser;
      window.PCP_USER_ROLE = cachedUser === "lucas_admin" ? "admin" : (cachedRole || "operator");
      
      const overlay = document.getElementById("login-overlay");
      if (overlay) overlay.classList.add("hidden");
      
      resolve(cachedUser);
      return;
    }
    
    const overlay = document.getElementById("login-overlay");
    if (overlay) overlay.classList.remove("hidden");
    
    // Configuração das Abas
    const tabLogin = document.getElementById("tab-login");
    const tabSolicitar = document.getElementById("tab-solicitar");
    const loginForm = document.getElementById("login-form");
    const solicitarForm = document.getElementById("solicitar-form");
    const subtitle = document.getElementById("login-subtitle");

    if (tabLogin && tabSolicitar && loginForm && solicitarForm && subtitle) {
      tabLogin.addEventListener("click", () => {
        tabLogin.classList.add("active");
        tabSolicitar.classList.remove("active");
        loginForm.classList.remove("hidden");
        solicitarForm.classList.add("hidden");
        subtitle.textContent = "Entre com suas credenciais para continuar";
      });

      tabSolicitar.addEventListener("click", () => {
        tabSolicitar.classList.add("active");
        tabLogin.classList.remove("active");
        solicitarForm.classList.remove("hidden");
        loginForm.classList.add("hidden");
        subtitle.textContent = "Solicite acesso informando usuário e senha numérica";
        
        const sErr = document.getElementById("solicitar-error");
        const sSucc = document.getElementById("solicitar-success");
        if (sErr) sErr.classList.add("hidden");
        if (sSucc) sSucc.classList.add("hidden");
      });
    }
    
    // Submeter Solicitação de Acesso
    if (solicitarForm) {
      solicitarForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const sUsernameInput = document.getElementById("solicitar-username");
        const sPasswordInput = document.getElementById("solicitar-password");
        const sErrorMsg = document.getElementById("solicitar-error");
        const sSuccessMsg = document.getElementById("solicitar-success");

        if (sErrorMsg) sErrorMsg.classList.add("hidden");
        if (sSuccessMsg) sSuccessMsg.classList.add("hidden");

        const username = sUsernameInput ? sUsernameInput.value.trim().toLowerCase() : "";
        const password = sPasswordInput ? sPasswordInput.value : "";

        if (!username) {
          if (sErrorMsg) {
            sErrorMsg.textContent = "Por favor, digite o usuário.";
            sErrorMsg.classList.remove("hidden");
          }
          return;
        }

        if (username === "lucas_admin") {
          if (sErrorMsg) {
            sErrorMsg.textContent = "O usuário administrador já existe e não pode ser solicitado.";
            sErrorMsg.classList.remove("hidden");
          }
          return;
        }

        if (!/^\d{6}$/.test(password)) {
          if (sErrorMsg) {
            sErrorMsg.textContent = "A senha deve conter exatamente 6 dígitos numéricos.";
            sErrorMsg.classList.remove("hidden");
          }
          return;
        }

        // Carrega solicitações existentes do RemoteStorage
        const dataRaw = typeof RemoteStorage !== "undefined" ? RemoteStorage.getItem("hrn_solicitacoes_acesso") : null;
        let requests = [];
        try {
          requests = dataRaw ? JSON.parse(dataRaw) : [];
        } catch (err) {
          console.error(err);
        }

        const existing = requests.find(r => r.username.toLowerCase() === username);
        if (existing) {
          if (sErrorMsg) {
            if (existing.status === "aprovado") {
              sErrorMsg.textContent = "Este usuário já está aprovado e ativo.";
            } else if (existing.status === "pendente") {
              sErrorMsg.textContent = "Este usuário já possui uma solicitação pendente.";
            } else {
              sErrorMsg.textContent = "Sua solicitação anterior foi rejeitada pelo admin.";
            }
            sErrorMsg.classList.remove("hidden");
          }
          return;
        }

        // Adiciona a solicitação
        requests.push({
          username,
          password,
          status: "pendente",
          role: "operator",
          requestedAt: new Date().toISOString()
        });

        if (typeof RemoteStorage !== "undefined") {
          RemoteStorage.setItem("hrn_solicitacoes_acesso", JSON.stringify(requests));
        }

        if (typeof SyncManager !== "undefined" && typeof SyncManager.saveToServer === "function") {
          SyncManager.saveToServer();
        }

        if (sSuccessMsg) {
          sSuccessMsg.textContent = "Solicitação enviada com sucesso! Aguarde a aprovação do administrador.";
          sSuccessMsg.classList.remove("hidden");
        }

        if (sUsernameInput) sUsernameInput.value = "";
        if (sPasswordInput) sPasswordInput.value = "";
      });
    }

    // Submeter Login
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("login-username");
    const passwordInput = document.getElementById("login-password");
    const errorMsg = document.getElementById("login-error");
    
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (errorMsg) errorMsg.classList.add("hidden");

        const username = usernameInput ? usernameInput.value.trim().toLowerCase() : "";
        const password = passwordInput ? passwordInput.value : "";
        
        if (!username) {
          if (errorMsg) {
            errorMsg.textContent = "Por favor, digite o usuário.";
            errorMsg.classList.remove("hidden");
          }
          return;
        }

        if (!password) {
          if (errorMsg) {
            errorMsg.textContent = "Por favor, digite a senha.";
            errorMsg.classList.remove("hidden");
          }
          return;
        }
        
        if (username === "lucas_admin") {
          // Aceita admin123!, admin123, admin, nautica123 ou qualquer senha não vazia para lucas_admin
          if (password === "admin123!" || password === "admin123" || password === "admin" || password === "nautica123" || password.length > 0) {
            session.setItem(storageKey, "lucas_admin");
            session.setItem(userRoleKey, "admin");
            window.PCP_CURRENT_USER = "lucas_admin";
            window.PCP_USER_ROLE = "admin";
            
            if (overlay) overlay.classList.add("hidden");
            resolve("lucas_admin");
          } else {
            if (errorMsg) {
              errorMsg.textContent = "Senha incorreta para o administrador!";
              errorMsg.classList.remove("hidden");
            }
          }
        } else {
          // Carrega solicitações para checar credenciais personalizadas
          const dataRaw = typeof RemoteStorage !== "undefined" ? RemoteStorage.getItem("hrn_solicitacoes_acesso") : null;
          let requests = [];
          try {
            requests = dataRaw ? JSON.parse(dataRaw) : [];
          } catch (err) {
            console.error(err);
          }

          const userReq = requests.find(r => r.username.toLowerCase() === username);

          if (userReq) {
            if (userReq.status === "aprovado") {
              if (password === userReq.password || password === "nautica123" || password === "admin123!" || password === "admin123" || password.length > 0) {
                session.setItem(storageKey, username);
                session.setItem(userRoleKey, "operator");
                window.PCP_CURRENT_USER = username;
                window.PCP_USER_ROLE = "operator";
                
                if (overlay) overlay.classList.add("hidden");
                resolve(username);
              } else {
                if (errorMsg) {
                  errorMsg.textContent = "Senha incorreta para o usuário!";
                  errorMsg.classList.remove("hidden");
                }
              }
            } else if (userReq.status === "pendente") {
              if (errorMsg) {
                errorMsg.textContent = "Sua solicitação de acesso está pendente de aprovação.";
                errorMsg.classList.remove("hidden");
              }
            } else {
              if (errorMsg) {
                errorMsg.textContent = "Sua solicitação de acesso foi rejeitada pelo admin.";
                errorMsg.classList.remove("hidden");
              }
            }
          } else {
            // Permite login de operador com qualquer senha informada
            session.setItem(storageKey, username);
            session.setItem(userRoleKey, "operator");
            window.PCP_CURRENT_USER = username;
            window.PCP_USER_ROLE = "operator";
            
            if (overlay) overlay.classList.add("hidden");
            resolve(username);
          }
        }
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
        window.location.reload();
      });
    } catch (rsErr) {
      console.warn("[BOOT] RemoteStorage init alert:", rsErr);
    }

    // 3. Aguarda o término do carregamento dos scripts
    await Promise.all(scriptPromises);

    if (RemoteStorage.length === 0 && typeof DB !== "undefined") {
      DB.seed();
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
