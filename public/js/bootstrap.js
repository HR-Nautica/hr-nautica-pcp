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
  const storageKey = "hrn_login_usuario";
  let user = window.localStorage.getItem(storageKey) || "";
  while (!user.trim()) {
    user = window.prompt("Informe seu nome para registrar suas alteracoes:", "") || "";
  }
  user = user.trim().slice(0, 100);
  window.localStorage.setItem(storageKey, user);
  window.PCP_CURRENT_USER = user;
}
async function bootstrap() {
  try {
    requireUserLogin();
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
      warning.textContent = "Nao foi possivel iniciar: Access ou API indisponivel.";
      warning.style.display = "block";
    }
  }
}

bootstrap();




