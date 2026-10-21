"use strict";

function debounce(func, wait = 150) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
window.debounce = window.debounce || debounce;

function safeGetJSON(key, defaultVal) {
  try {
    const raw = typeof RemoteStorage !== "undefined" ? RemoteStorage.getItem(key) : localStorage.getItem(key);
    if (!raw) return defaultVal;
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : defaultVal;
  } catch (err) {
    return defaultVal;
  }
}
window.safeGetJSON = window.safeGetJSON || safeGetJSON;

const PENDING_WRITES_KEY_PREFIX = "pcp_remote_pending_writes_v2";

const RemoteStorage = {
  data: new Map(),
  versions: new Map(),
  revision: 0,
  writeQueues: new Map(),
  lastQueuedWriteIds: new Map(),
  confirmedWriteVersions: new Map(),
  pendingWrites: new Map(),
  conflicts: new Map(),
  nextWriteId: 1,
  pollingId: null,
  onUpdate: null,
  online: false,
  currentUser: "",
  serverStateLoaded: false,
  restoredPendingKeys: new Set(),

  get length() { return this.data.size; },
  key(index) { return Array.from(this.data.keys())[index] ?? null; },
  getItem(key) {
    if (!this.data.has(key)) return null;
    const value = this.data.get(key);
    return typeof value === "string" ? value : JSON.stringify(value);
  },
  setItem(key, serializedValue) {
    const value = this.parse(serializedValue);
    const previous = this.data.get(key);
    const unchanged = this.data.has(key) && JSON.stringify(previous) === JSON.stringify(value);
    this.data.set(key, value);
    try {
      localStorage.setItem(key, typeof serializedValue === "string" ? serializedValue : JSON.stringify(serializedValue));
    } catch (err) {
      console.warn("[BANCO] Nao foi possivel salvar no localStorage local:", err);
    }
    if (unchanged) {
      return this.writeQueues.get(key) || Promise.resolve(!this.pendingWrites.has(key));
    }
    if (key.startsWith("hrn_") && key !== "hrn_sync_timestamp") {
      const pending = this.rememberPending(key, "PUT", value);
      return this.enqueue(key, () => this.persist(
        key,
        value,
        pending.writeId,
        this.expectedVersionForPending(pending)
      ));
    }
    return Promise.resolve(true);
  },
  removeItem(key) {
    this.data.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn("[BANCO] Nao foi possivel remover do localStorage local:", err);
    }
    if (key.startsWith("hrn_")) {
      const pending = this.rememberPending(key, "DELETE");
      return this.enqueue(key, () => this.persistDelete(
        key,
        pending.writeId,
        this.expectedVersionForPending(pending)
      ));
    }
    return Promise.resolve(true);
  },
  clear() {
    throw new Error("Limpeza total bloqueada para proteger o banco central.");
  },
  parse(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  },
  applyServerState(key, value, version, revision) {
    this.data.set(key, value);
    this.versions.set(key, Number(version) || 0);
    this.revision = Math.max(this.revision, Number(revision) || 0);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {
      console.warn("[BANCO] Nao foi possivel atualizar o cache local:", err);
    }
  },
  rememberPending(key, method, value) {
    const ownerUser = this.normalizedCurrentUser();
    const predecessorWriteId = this.lastQueuedWriteIds.get(key) ?? null;
    const pending = {
      key,
      method,
      value,
      baseVersion: this.serverStateLoaded ? Number(this.versions.get(key) || 0) : null,
      ownerUser,
      writeId: this.nextWriteId++,
      predecessorWriteId,
      createdAt: new Date().toISOString(),
      error: ""
    };
    this.lastQueuedWriteIds.set(key, pending.writeId);
    this.pendingWrites.set(key, pending);
    this.savePendingWrites();
    this.showPendingWarning(key);
    return pending;
  },
  expectedVersionForPending(pending) {
    if (pending.predecessorWriteId !== null
      && this.confirmedWriteVersions.has(pending.predecessorWriteId)) {
      const confirmedVersion = this.confirmedWriteVersions.get(pending.predecessorWriteId);
      this.confirmedWriteVersions.delete(pending.predecessorWriteId);
      return confirmedVersion;
    }
    return pending.baseVersion;
  },
  normalizedCurrentUser() {
    return String(this.currentUser || "").trim().toLocaleLowerCase("pt-BR");
  },
  pendingStorageKey() {
    const owner = this.normalizedCurrentUser() || "usuario-nao-identificado";
    return `${PENDING_WRITES_KEY_PREFIX}:${encodeURIComponent(owner)}`;
  },
  savePendingWrites() {
    try {
      const entries = [...this.pendingWrites.values()].filter(pending => pending.ownerUser === this.normalizedCurrentUser());
      if (entries.length) localStorage.setItem(this.pendingStorageKey(), JSON.stringify(entries));
      else localStorage.removeItem(this.pendingStorageKey());
    } catch (error) {
      console.warn("[BANCO] Nao foi possivel preservar alteracoes pendentes:", error);
    }
  },
  loadPendingWrites() {
    try {
      const ownerUser = this.normalizedCurrentUser();
      const stored = JSON.parse(localStorage.getItem(this.pendingStorageKey()) || "[]");
      if (!Array.isArray(stored)) return;
      stored.forEach((pending) => {
        if (pending?.key && pending.ownerUser === ownerUser && ["PUT", "DELETE"].includes(pending.method)) {
          pending.baseVersion = Number.isInteger(pending.baseVersion) && pending.baseVersion >= 0
            ? pending.baseVersion
            : null;
          this.pendingWrites.set(pending.key, pending);
          this.restoredPendingKeys.add(pending.key);
          this.nextWriteId = Math.max(this.nextWriteId, Number(pending.writeId || 0) + 1);
        }
      });
    } catch (error) {
      console.warn("[BANCO] Alteracoes pendentes locais invalidas foram ignoradas:", error);
    }
  },
  clearPending(key, writeId) {
    const current = this.pendingWrites.get(key);
    if (current && (writeId === undefined || current.writeId === writeId)) {
      this.pendingWrites.delete(key);
      this.restoredPendingKeys.delete(key);
      this.savePendingWrites();
    }
  },
  serverVersion(key) {
    return Number(this.versions.get(key) || 0);
  },
  pendingBelongsToCurrentUser(pending) {
    return Boolean(pending?.ownerUser)
      && pending.ownerUser === this.normalizedCurrentUser();
  },
  evaluateRestoredPendings() {
    for (const key of this.restoredPendingKeys) {
      const pending = this.pendingWrites.get(key);
      if (!this.pendingBelongsToCurrentUser(pending)) continue;
      const currentVersion = this.serverVersion(key);
      if (pending.baseVersion === null || pending.baseVersion !== currentVersion) {
        this.conflicts.set(key, {
          ...pending,
          detectedAt: new Date().toISOString(),
          reason: pending.baseVersion === null ? "BASE_VERSION_UNKNOWN" : "SERVER_VERSION_CHANGED",
          serverVersion: currentVersion
        });
        this.showConflictWarning(key);
      } else {
        this.showRestoredPendingWarning(key);
      }
    }
  },
  loadFromLocalStorage() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("hrn_")) {
          const val = localStorage.getItem(k);
          this.data.set(k, this.parse(val));
          this.versions.set(k, 1);
        }
      }
    } catch (err) {
      console.error("[BANCO] Erro ao carregar dados do localStorage:", err);
    }
  },
  async init(onUpdate) {
    this.currentUser = window.PCP_CURRENT_USER || "";
    this.onUpdate = onUpdate || null;
    this.loadPendingWrites();
    await this.load(true);
    this.evaluateRestoredPendings();
  },
  async load(initial, serverWinsForKeys = new Set()) {
    try {
      const suffix = initial ? "" : `?since=${this.revision}`;
      const response = await fetch(`/api/state${suffix}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      this.setConnectionState(true);
      this.serverStateLoaded = true;
      if (!result.modified) return;
      this.revision = Number(result.revision || 0);

      const newData = new Map(Object.entries(result.data || {}));
      for (const pendingKey of this.writeQueues.keys()) {
        if (serverWinsForKeys.has(pendingKey)) continue;
        if (this.data.has(pendingKey)) newData.set(pendingKey, this.data.get(pendingKey));
        else newData.delete(pendingKey);
      }
      this.data = newData;
      this.versions = new Map(
        Object.entries(result.versions || {}).map(([key, value]) => [key, Number(value)])
      );
      if (!initial && typeof this.onUpdate === "function") this.onUpdate();
    } catch (error) {
      this.setConnectionState(false);
      if (initial && !this.data.size) {
        console.warn("[BANCO] Servidor offline no carregamento inicial. Carregando dados locais do navegador...");
        this.loadFromLocalStorage();
        return;
      } else {
        console.error("[BANCO] Falha ao atualizar:", error);
      }
      throw error;
    }
  },
  enqueue(key, operation) {
    const previous = this.writeQueues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation)
      .catch((error) => {
        const pending = this.pendingWrites.get(key);
        if (pending) {
          pending.error = error?.message || "Falha de conexao";
          this.savePendingWrites();
        }
        if (!["WRITE_CONFLICT", "GENERIC_STATE_WRITE_FORBIDDEN"].includes(error?.code)) this.setConnectionState(false);
        console.error(`[BANCO] Falha ao gravar ${key}:`, error);
        return false;
      })
      .finally(() => {
        if (this.writeQueues.get(key) === next) this.writeQueues.delete(key);
      });
    this.writeQueues.set(key, next);
    return next;
  },
  async persist(key, value, writeId, expectedVersion) {
    if (this.conflicts.has(key)) throw this.conflictBlockedError();
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      this.markVersionConflict(key, "BASE_VERSION_UNKNOWN");
      throw this.conflictBlockedError();
    }
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-PCP-User": this.currentUser },
      body: JSON.stringify({ value, expectedVersion })
    });
    const result = await response.json();
    if (response.status === 409) {
      await this.handleConflict(key);
      throw this.conflictBlockedError();
    }
    if (response.status === 403 && result.code === "GENERIC_STATE_WRITE_FORBIDDEN") {
      await this.handlePolicyRejection(key, writeId, result);
      throw this.policyRejectedError(result);
    }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const confirmedVersion = Number(result.version);
    this.versions.set(key, confirmedVersion);
    this.confirmedWriteVersions.set(writeId, confirmedVersion);
    this.revision = Number(result.revision);
    this.clearPending(key, writeId);
    this.showConfirmedState();
    return true;
  },
  async persistDelete(key, writeId, expectedVersion) {
    if (this.conflicts.has(key)) throw this.conflictBlockedError();
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      this.markVersionConflict(key, "BASE_VERSION_UNKNOWN");
      throw this.conflictBlockedError();
    }
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-PCP-User": this.currentUser },
      body: JSON.stringify({ expectedVersion })
    });
    const result = await response.json();
    if (response.status === 409) {
      await this.handleConflict(key);
      throw this.conflictBlockedError();
    }
    if (response.status === 403 && result.code === "GENERIC_STATE_WRITE_FORBIDDEN") {
      await this.handlePolicyRejection(key, writeId, result);
      throw this.policyRejectedError(result);
    }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    this.versions.delete(key);
    this.confirmedWriteVersions.set(writeId, 0);
    this.revision = Number(result.revision);
    this.clearPending(key, writeId);
    this.showConfirmedState();
    return true;
  },
  policyRejectedError(result) {
    const error = new Error(result?.error || "Escrita generica proibida.");
    error.code = "GENERIC_STATE_WRITE_FORBIDDEN";
    error.status = 403;
    return error;
  },
  async handlePolicyRejection(key, writeId, result) {
    this.clearPending(key, writeId);
    await this.load(true, new Set([key]));
    try {
      if (this.data.has(key)) localStorage.setItem(key, JSON.stringify(this.data.get(key)));
      else localStorage.removeItem(key);
    } catch (error) {
      console.warn("[BANCO] Nao foi possivel restaurar o cache confirmado:", error);
    }
    const warning = document.getElementById("central-server-warning");
    if (warning) {
      warning.textContent = result?.specificApi
        ? `Alteracao rejeitada: ${key} exige ${result.specificApi}.`
        : `Alteracao rejeitada pela politica de integridade: ${key}.`;
      warning.style.display = "block";
    }
    if (typeof this.onUpdate === "function") this.onUpdate();
  },
  conflictBlockedError() {
    const error = new Error("Gravacao bloqueada por conflito pendente.");
    error.code = "WRITE_CONFLICT";
    return error;
  },
  markVersionConflict(key, reason = "SERVER_VERSION_CHANGED") {
    const pending = this.pendingWrites.get(key);
    this.conflicts.set(key, {
      ...pending,
      detectedAt: new Date().toISOString(),
      reason,
      serverVersion: this.serverVersion(key)
    });
    this.showConflictWarning(key);
  },
  async handleConflict(key) {
    const pending = this.pendingWrites.get(key);
    await this.load(true, new Set([key]));
    this.conflicts.set(key, {
      ...pending,
      detectedAt: new Date().toISOString(),
      reason: "SERVER_VERSION_CHANGED",
      serverVersion: this.serverVersion(key)
    });
    try {
      if (this.data.has(key)) localStorage.setItem(key, JSON.stringify(this.data.get(key)));
      else localStorage.removeItem(key);
    } catch (error) {
      console.warn("[BANCO] Nao foi possivel atualizar o cache confirmado:", error);
    }
    this.showConflictWarning(key);
    if (typeof this.onUpdate === "function") this.onUpdate();
  },
  getConflict(key) {
    return this.conflicts.get(key) || null;
  },
  async retryConflict(key, { confirmed = false } = {}) {
    const conflict = this.conflicts.get(key);
    const pending = this.pendingWrites.get(key) || conflict;
    if (!pending || !this.pendingBelongsToCurrentUser(pending)) return false;
    if (!confirmed) {
      this.showConflictWarning(key);
      return false;
    }
    try {
      // A confirmacao autoriza uma nova tentativa, nao o uso de uma versao
      // possivelmente obsoleta mantida em memoria. Rele o servidor primeiro.
      await this.load(true, new Set([key]));
      const explicitExpectedVersion = this.serverVersion(key);
      this.conflicts.delete(key);
      if (pending.method === "DELETE") await this.persistDelete(key, pending.writeId, explicitExpectedVersion);
      else await this.persist(key, pending.value, pending.writeId, explicitExpectedVersion);
      if (pending.method === "DELETE") {
        this.data.delete(key);
        try { localStorage.removeItem(key); } catch (error) {}
      } else {
        this.data.set(key, pending.value);
        try { localStorage.setItem(key, JSON.stringify(pending.value)); } catch (error) {}
      }
      if (typeof this.onUpdate === "function") this.onUpdate();
      return true;
    } catch (error) {
      if (!this.conflicts.has(key)) this.conflicts.set(key, conflict || pending);
      this.showConflictWarning(key);
      throw error;
    }
  },
  async discardConflict(key) {
    const pending = this.pendingWrites.get(key);
    try {
      await this.load(true, new Set([key]));
      if (this.data.has(key)) localStorage.setItem(key, JSON.stringify(this.data.get(key)));
      else localStorage.removeItem(key);
      this.conflicts.delete(key);
      this.clearPending(key);
      if (pending) {
        this.confirmedWriteVersions.delete(pending.predecessorWriteId);
        this.confirmedWriteVersions.delete(pending.writeId);
        if (this.lastQueuedWriteIds.get(key) === pending.writeId) this.lastQueuedWriteIds.delete(key);
      }
      this.showConfirmedState();
      if (typeof this.onUpdate === "function") this.onUpdate();
      return true;
    } catch (error) {
      if (this.conflicts.has(key)) this.showConflictWarning(key);
      else this.showRestoredPendingWarning(key);
      throw error;
    }
  },
  async retryPending(key, { confirmed = false } = {}) {
    const pending = this.pendingWrites.get(key);
    if (!pending || !this.pendingBelongsToCurrentUser(pending)) return false;
    if (this.conflicts.has(key)) return this.retryConflict(key, { confirmed });
    if (pending.baseVersion === null || pending.baseVersion !== this.serverVersion(key)) {
      this.markVersionConflict(key, pending.baseVersion === null ? "BASE_VERSION_UNKNOWN" : "SERVER_VERSION_CHANGED");
      return false;
    }
    if (!confirmed) {
      this.showRestoredPendingWarning(key);
      return false;
    }
    if (pending.method === "DELETE") await this.persistDelete(key, pending.writeId, pending.baseVersion);
    else await this.persist(key, pending.value, pending.writeId, pending.baseVersion);
    if (pending.method === "DELETE") {
      this.data.delete(key);
      try { localStorage.removeItem(key); } catch (error) {}
    } else {
      this.data.set(key, pending.value);
      try { localStorage.setItem(key, JSON.stringify(pending.value)); } catch (error) {}
    }
    if (typeof this.onUpdate === "function") this.onUpdate();
    return true;
  },
  showPendingWarning(key) {
    const warning = document.getElementById("central-server-warning");
    if (!warning || this.conflicts.has(key)) return;
    warning.textContent = `Salvando alteracoes de ${key} no servidor...`;
    warning.style.display = "block";
  },
  confirmSnapshotReplacement(key) {
    const message = `Reaplicar a alteracao pendente de ${key}?\n\n` +
      "Esta acao envia um snapshot completo e pode substituir alteracoes feitas por outros funcionarios. " +
      "Confirme somente depois de revisar os dados atuais do servidor.";
    return typeof window.confirm === "function" && window.confirm(message);
  },
  showRestoredPendingWarning(key) {
    const warning = document.getElementById("central-server-warning");
    if (!warning) return;
    warning.textContent = `Alteracao pendente de ${key} recuperada para este usuario. Nada esta sendo salvo agora; revise antes de tentar novamente.`;
    if (typeof document.createElement === "function") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Revisar e tentar salvar";
      retry.addEventListener("click", () => {
        if (!this.confirmSnapshotReplacement(key)) return;
        retry.disabled = true;
        this.retryPending(key, { confirmed: true }).catch((error) => {
          console.error(`[BANCO] Nova tentativa falhou para ${key}:`, error);
          retry.disabled = false;
        });
      });
      const discard = document.createElement("button");
      discard.type = "button";
      discard.textContent = "Descartar alteracao local";
      discard.addEventListener("click", () => {
        discard.disabled = true;
        this.discardConflict(key).catch((error) => {
          console.error(`[BANCO] Falha ao restaurar a versao do servidor para ${key}:`, error);
          discard.disabled = false;
        });
      });
      warning.append(" ", retry, " ", discard);
    }
    warning.style.display = "block";
  },
  showConflictWarning(key) {
    const warning = document.getElementById("central-server-warning");
    if (!warning) return;
    warning.textContent = `Conflito em ${key}: a versao do servidor foi preservada. A alteracao local deste usuario continua pendente. Reaplicar o snapshot completo pode substituir alteracoes de outros funcionarios.`;
    if (typeof document.createElement === "function") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Reaplicar minha alteracao";
      retry.addEventListener("click", () => {
        if (!this.confirmSnapshotReplacement(key)) return;
        retry.disabled = true;
        this.retryConflict(key, { confirmed: true }).catch((error) => {
          console.error(`[BANCO] Nova tentativa consciente falhou para ${key}:`, error);
          retry.disabled = false;
        });
      });
      const discard = document.createElement("button");
      discard.type = "button";
      discard.textContent = "Manter versao do servidor";
      discard.addEventListener("click", () => {
        discard.disabled = true;
        this.discardConflict(key).catch((error) => {
          console.error(`[BANCO] Falha ao restaurar a versao do servidor para ${key}:`, error);
          discard.disabled = false;
        });
      });
      warning.append(" ", retry, " ", discard);
    }
    warning.style.display = "block";
  },
  showConfirmedState() {
    const warning = document.getElementById("central-server-warning");
    if (warning && this.online && !this.pendingWrites.size && !this.conflicts.size) warning.style.display = "none";
  },
  setConnectionState(online) {
    this.online = online;
    const warning = document.getElementById("central-server-warning");
    const container = document.getElementById("net-sync-status");
    const text = document.getElementById("net-sync-text");
    if (container) container.className = `sync-status-container ${online ? "online" : "offline"}`;
    if (text) text.textContent = online ? "Servidor conectado" : "Modo Local / Offline";
    if (warning && online && !this.pendingWrites.size && !this.conflicts.size) warning.style.display = "none";
    if (warning && !online) {
      warning.textContent = "Servidor desconectado. As alteracoes nao confirmadas permanecem salvas neste navegador.";
      if (this.pendingWrites.size && typeof document.createElement === "function") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Tentar salvar novamente";
        retry.addEventListener("click", async () => {
          retry.disabled = true;
          for (const key of [...this.pendingWrites.keys()]) {
            if (!this.confirmSnapshotReplacement(key)) continue;
            try { await this.retryPending(key, { confirmed: true }); } catch (error) {
              console.error(`[BANCO] Nova tentativa falhou para ${key}:`, error);
            }
          }
          retry.disabled = false;
        });
        warning.append(" ", retry);
      }
      warning.style.display = "block";
    }
  }
};

window.RemoteStorage = RemoteStorage;
