"use strict";

const RemoteStorage = {
  data: new Map(),
  versions: new Map(),
  revision: 0,
  writeQueues: new Map(),
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
    this.data.set(key, value);
    if (key.startsWith("hrn_") && key !== "hrn_sync_timestamp") {
      this.enqueue(key, () => this.persist(key, value));
    }
  },
  removeItem(key) {
    this.data.delete(key);
    if (key.startsWith("hrn_")) this.enqueue(key, () => this.persistDelete(key));
  },
  clear() {
    throw new Error("Limpeza total bloqueada para proteger o banco central.");
  },
  parse(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  },
  async init(onUpdate) {
    this.currentUser = window.PCP_CURRENT_USER || "";
    this.onUpdate = onUpdate || null;
    await this.load(true);
    this.pollingId = window.setInterval(() => this.load(false), 3000);
  },
  async load(initial) {
    try {
      const suffix = initial ? "" : `?since=${this.revision}`;
      const response = await fetch(`/api/state${suffix}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      this.setConnectionState(true);
      if (!result.modified) return;
      this.revision = Number(result.revision || 0);
      this.data = new Map(Object.entries(result.data || {}));
      this.versions = new Map(
        Object.entries(result.versions || {}).map(([key, value]) => [key, Number(value)])
      );
      if (!initial && typeof this.onUpdate === "function") this.onUpdate();
    } catch (error) {
      this.setConnectionState(false);
      if (initial) throw error;
      console.error("[ACCESS] Falha ao atualizar:", error);
    }
  },
  enqueue(key, operation) {
    const previous = this.writeQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation).catch((error) => {
      this.setConnectionState(false);
      console.error(`[ACCESS] Falha ao gravar ${key}:`, error);
    });
    this.writeQueues.set(key, next);
  },
  async persist(key, value) {
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-PCP-User": this.currentUser },
      body: JSON.stringify({ value, expectedVersion: this.versions.get(key) || 0 })
    });
    const result = await response.json();
    if (response.status === 409) return this.handleConflict(key);
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    this.versions.set(key, Number(result.version));
    this.revision = Number(result.revision);
  },
  async persistDelete(key) {
    const response = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-PCP-User": this.currentUser },
      body: JSON.stringify({ expectedVersion: this.versions.get(key) || 0 })
    });
    const result = await response.json();
    if (response.status === 409) return this.handleConflict(key);
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    this.versions.delete(key);
    this.revision = Number(result.revision);
  },
  async handleConflict(key) {
    await this.load(true);
    const warning = document.getElementById("central-server-warning");
    if (warning) {
      warning.textContent =
        `Os dados de ${key} foram alterados por outro usuario. Repita sua alteracao.`;
      warning.style.display = "block";
    }
    if (typeof this.onUpdate === "function") this.onUpdate();
  },
  setConnectionState(online) {
    const warning = document.getElementById("central-server-warning");
    const container = document.getElementById("net-sync-status");
    const text = document.getElementById("net-sync-text");
    if (container) container.className = `sync-status-container ${online ? "online" : "offline"}`;
    if (text) text.textContent = online ? "Access conectado" : "Banco indisponivel";
    if (warning && online && !warning.textContent.startsWith("Os dados de")) {
      warning.style.display = "none";
    }
    if (warning && !online) {
      warning.textContent = "Banco indisponivel. As gravacoes estao bloqueadas.";
      warning.style.display = "block";
    }
  }
};

window.RemoteStorage = RemoteStorage;





