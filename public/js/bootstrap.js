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
    
    // Configuração das Abas
    const tabLogin = document.getElementById("tab-login");
    const tabSolicitar = document.getElementById("tab-solicitar");
    const loginForm = document.getElementById("login-form");
    const solicitarForm = document.getElementById("solicitar-form");
    const subtitle = document.getElementById("login-subtitle");

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
      
      // Limpa as mensagens
      document.getElementById("solicitar-error").classList.add("hidden");
      document.getElementById("solicitar-success").classList.add("hidden");
    });
    
    // Submeter Solicitação de Acesso
    solicitarForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const sUsernameInput = document.getElementById("solicitar-username");
      const sPasswordInput = document.getElementById("solicitar-password");
      const sErrorMsg = document.getElementById("solicitar-error");
      const sSuccessMsg = document.getElementById("solicitar-success");

      sErrorMsg.classList.add("hidden");
      sSuccessMsg.classList.add("hidden");

      const username = sUsernameInput.value.trim().toLowerCase();
      const password = sPasswordInput.value;

      if (!username) {
        sErrorMsg.textContent = "Por favor, digite o usuário.";
        sErrorMsg.classList.remove("hidden");
        return;
      }

      if (username === "lucas_admin") {
        sErrorMsg.textContent = "O usuário administrador já existe e não pode ser solicitado.";
        sErrorMsg.classList.remove("hidden");
        return;
      }

      if (!/^\d{6}$/.test(password)) {
        sErrorMsg.textContent = "A senha deve conter exatamente 6 dígitos numéricos.";
        sErrorMsg.classList.remove("hidden");
        return;
      }

      // Carrega solicitações existentes do RemoteStorage
      const dataRaw = RemoteStorage.getItem("hrn_solicitacoes_acesso");
      let requests = [];
      try {
        requests = dataRaw ? JSON.parse(dataRaw) : [];
      } catch (err) {
        console.error(err);
      }

      const existing = requests.find(r => r.username.toLowerCase() === username);
      if (existing) {
        if (existing.status === "aprovado") {
          sErrorMsg.textContent = "Este usuário já está aprovado e ativo.";
        } else if (existing.status === "pendente") {
          sErrorMsg.textContent = "Este usuário já possui uma solicitação pendente.";
        } else {
          sErrorMsg.textContent = "Sua solicitação anterior foi rejeitada pelo admin.";
        }
        sErrorMsg.classList.remove("hidden");
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

      RemoteStorage.setItem("hrn_solicitacoes_acesso", JSON.stringify(requests));

      // Dispara SyncManager para salvar no servidor, se carregado
      if (typeof SyncManager !== "undefined" && typeof SyncManager.saveToServer === "function") {
        SyncManager.saveToServer();
      }

      sSuccessMsg.textContent = "Solicitação enviada com sucesso! Aguarde a aprovação do administrador.";
      sSuccessMsg.classList.remove("hidden");

      sUsernameInput.value = "";
      sPasswordInput.value = "";
    });

    // Submeter Login
    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("login-username");
    const passwordInput = document.getElementById("login-password");
    const errorMsg = document.getElementById("login-error");
    
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const username = usernameInput.value.trim().toLowerCase();
      const password = passwordInput.value;
      
      if (!username) {
        errorMsg.textContent = "Por favor, digite o usuário.";
        errorMsg.classList.remove("hidden");
        return;
      }
      
      if (username === "lucas_admin") {
        if (password === "admin123!") {
          session.setItem(storageKey, "lucas_admin");
          session.setItem(userRoleKey, "admin");
          window.PCP_CURRENT_USER = "lucas_admin";
          window.PCP_USER_ROLE = "admin";
          
          if (overlay) overlay.classList.add("hidden");
          resolve("lucas_admin");
        } else {
          errorMsg.textContent = "Senha incorreta para o administrador!";
          errorMsg.classList.remove("hidden");
        }
      } else {
        // Carrega solicitações para checar credenciais personalizadas
        const dataRaw = RemoteStorage.getItem("hrn_solicitacoes_acesso");
        let requests = [];
        try {
          requests = dataRaw ? JSON.parse(dataRaw) : [];
        } catch (err) {
          console.error(err);
        }

        const userReq = requests.find(r => r.username.toLowerCase() === username);

        if (userReq) {
          if (userReq.status === "aprovado") {
            if (password === userReq.password) {
              session.setItem(storageKey, username);
              session.setItem(userRoleKey, "operator");
              window.PCP_CURRENT_USER = username;
              window.PCP_USER_ROLE = "operator";
              
              if (overlay) overlay.classList.add("hidden");
              resolve(username);
            } else {
              errorMsg.textContent = "Senha incorreta para o usuário!";
              errorMsg.classList.remove("hidden");
            }
          } else if (userReq.status === "pendente") {
            errorMsg.textContent = "Sua solicitação de acesso está pendente de aprovação.";
            errorMsg.classList.remove("hidden");
          } else {
            errorMsg.textContent = "Sua solicitação de acesso foi rejeitada pelo admin.";
            errorMsg.classList.remove("hidden");
          }
        } else {
          // Fallback para a senha padrão de operador
          if (password === "nautica123") {
            session.setItem(storageKey, username);
            session.setItem(userRoleKey, "operator");
            window.PCP_CURRENT_USER = username;
            window.PCP_USER_ROLE = "operator";
            
            if (overlay) overlay.classList.add("hidden");
            resolve(username);
          } else {
            errorMsg.textContent = "Usuário não cadastrado ou senha incorreta.";
            errorMsg.classList.remove("hidden");
          }
        }
      }
    });
  });
}
async function bootstrap() {
  try {
    // 1. Inicializa o RemoteStorage primeiro para leitura/gravação de solicitações
    try {
      await RemoteStorage.init(() => {
        // Se estiver na tela de login, não recarrega para não atrapalhar o fluxo do usuário
        const overlay = document.getElementById("login-overlay");
        if (overlay && !overlay.classList.contains("hidden")) return;

        if (document.querySelector(".modal-overlay:not(.hidden)")) return;
        window.location.reload();
      });
    } catch (rsErr) {
      console.warn("[BOOT] RemoteStorage init alert:", rsErr);
    }

    // 2. Exige o login do usuário
    await requireUserLogin();

    // 3. Atualiza o usuário ativo no RemoteStorage
    RemoteStorage.currentUser = window.PCP_CURRENT_USER;

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
      warning.textContent = "Aviso ao iniciar: " + (error.message || "Verifique o servidor.");
      warning.style.display = "block";
    }
  }
}

bootstrap();
