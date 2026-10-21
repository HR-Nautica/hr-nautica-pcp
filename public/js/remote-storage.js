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

const PENDING_WRITES_KEY = "pcp_remote_pending_writes_v1";

const RemoteStorage = {
  data: new Map(),
  versions: new Map(),
  revision: 0,
  writeQueues: new Map(),
  pendingWrites: new Map(),
  conflicts: new Map(),
  nextWriteId: 1,
  pollingId: null,
  onUpdate: null,
  online: false,
  currentUser: "",

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
    if (unchanged) return;
    if (key.startsWith("hrn_") && key !== "hrn_sync_timestamp") {
      const pending = this.rememberPending(key, "PUT", value);
      this.enqueue(key, () => this.persist(key, value, pending.writeId));
    }
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
      this.enqueue(key, () => this.persistDelete(key, pending.writeId));
    }
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
    const pending = {
      key,
      method,
      value,
      writeId: this.nextWriteId++,
      createdAt: new Date().toISOString(),
      error: ""
    };
    this.pendingWrites.set(key, pending);
    this.savePendingWrites();
    this.showPendingWarning(key);
    return pending;
  },
  savePendingWrites() {
    try {
      localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify([...this.pendingWrites.values()]));
    } catch (error) {
      console.warn("[BANCO] Nao foi possivel preservar alteracoes pendentes:", error);
    }
  },
  loadPendingWrites() {
    try {
      const stored = JSON.parse(localStorage.getItem(PENDING_WRITES_KEY) || "[]");
      if (!Array.isArray(stored)) return;
      stored.forEach((pending) => {
        if (pending?.key && ["PUT", "DELETE"].includes(pending.method)) {
          this.pendingWrites.set(pending.key, pending);
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
      this.savePendingWrites();
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
    if (this.pendingWrites.size) this.showPendingWarning([...this.pendingWrites.keys()][0]);
  },
  async load(initial, serverWinsForKeys = new Set()) {
    try {
      const suffix = initial ? "" : `?since=${this.revision}`;
      const response = await fetch(`/api/state${suffix}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      this.setConnectionState(true);
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
        if (error?.code !== "WRITE_CONFLICT") this.setConnectionState(false);
        console.error(`[BANCO] Falha ao gravar ${key}:`, error);
      })
      .finally(() => {
        if (this.writeQueues.get(key) === next) this.writeQueues.delete(key);
      });
    this.writeQueues.set(key, next);
    return next;
  },
  async persist(key, value, writeId) {
    if (this.conflicts.has(key)) throw this.conflictBlockedError();
    const expectedVersion = this.versions.get(key) || 0;
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
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    this.versions.set(key, Number(result.version));
    this.revision = Number(result.revision);
    this.clearPending(key, writeId);
    this.showConfirmedState();
  },
  async persistDelete(key, writeId) {
    if (this.conflicts.has(key)) throw this.conflictBlockedError();
    const expectedVersion = this.versions.get(key) || 0;
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
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    this.versions.delete(key);
    this.revision = Number(result.revision);
    this.clearPending(key, writeId);
    this.showConfirmedState();
  },
  conflictBlockedError() {
    const error = new Error("Gravacao bloqueada por conflito pendente.");
    error.code = "WRITE_CONFLICT";
    return error;
  },
  async handleConflict(key) {
    const pending = this.pendingWrites.get(key);
    this.conflicts.set(key, { ...pending, detectedAt: new Date().toISOString() });
    await this.load(true, new Set([key]));
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
  async retryConflict(key) {
    const conflict = this.conflicts.get(key);
    const pending = this.pendingWrites.get(key) || conflict;
    if (!pending) return false;
    this.conflicts.delete(key);
    try {
      if (pending.method === "DELETE") await this.persistDelete(key, pending.writeId);
      else await this.persist(key, pending.value, pending.writeId);
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
  discardConflict(key) {
    this.conflicts.delete(key);
    this.clearPending(key);
    this.showConfirmedState();
    if (typeof this.onUpdate === "function") this.onUpdate();
  },
  async retryPending(key) {
    const pending = this.pendingWrites.get(key);
    if (!pending) return false;
    if (this.conflicts.has(key)) return this.retryConflict(key);
    if (pending.method === "DELETE") await this.persistDelete(key, pending.writeId);
    else await this.persist(key, pending.value, pending.writeId);
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
  showConflictWarning(key) {
    const warning = document.getElementById("central-server-warning");
    if (!warning) return;
    warning.textContent = `Conflito em ${key}: a versao do servidor foi preservada. Sua alteracao local esta pendente.`;
    if (typeof document.createElement === "function") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Reaplicar minha alteracao";
      retry.addEventListener("click", () => {
        retry.disabled = true;
        this.retryConflict(key).catch((error) => {
          console.error(`[BANCO] Nova tentativa consciente falhou para ${key}:`, error);
          retry.disabled = false;
        });
      });
      const discard = document.createElement("button");
      discard.type = "button";
      discard.textContent = "Manter versao do servidor";
      discard.addEventListener("click", () => this.discardConflict(key));
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
            try { await this.retryPending(key); } catch (error) {
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
