/* ═══════════════════════════════════════════
   db.js – Camada de dados (RemoteStorage)
   HR Náutica PCP
═══════════════════════════════════════════ */

const DB = {

  // ─── Keys ───────────────────────────────
  KEYS: {
    ops:          'hrn_ops',
    modelos:      'hrn_modelos',
    materiais:    'hrn_materiais',
    movimentos:   'hrn_movimentos',
    pedidos:      'hrn_pedidos',
    fundicoes:    'hrn_fundicoes',
    pecas:        'hrn_pecas',
    atividades:   'hrn_atividades',
    config:       'hrn_config',
    manutencoes:  'hrn_manutencoes',
    buchas:       'hrn_buchas',
    buchasOps:    'hrn_buchas_ops',
    buchasEntradas:'hrn_buchas_entradas',
    buchasSaidas:  'hrn_buchas_saidas',
    fundicaoCatalog: 'hrn_fundicao_catalog',
    coquilhasCatalog: 'hrn_coquilhas_catalog',
  },

  // ─── Helpers ────────────────────────────
  _get(key) {
    try { return JSON.parse(RemoteStorage.getItem(key)) || []; }
    catch { return []; }
  },
  _set(key, data) {
    RemoteStorage.setItem(key, JSON.stringify(data));
    if (typeof SyncManager !== 'undefined' && typeof SyncManager.saveToServer === 'function') {
      SyncManager.saveToServer();
    }
  },
  _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },
  _now() {
    return new Date().toISOString();
  },

  // ─── Config ─────────────────────────────
  getConfig() {
    try { return JSON.parse(RemoteStorage.getItem(this.KEYS.config)) || { meta: 100, opCounter: 0 }; }
    catch { return { meta: 100, opCounter: 0 }; }
  },
  setConfig(cfg) {
    RemoteStorage.setItem(this.KEYS.config, JSON.stringify(cfg));
    if (typeof SyncManager !== 'undefined' && typeof SyncManager.saveToServer === 'function') {
      SyncManager.saveToServer();
    }
  },
  nextOpNumber() {
    const cfg = this.getConfig();
    cfg.opCounter = (cfg.opCounter || 0) + 1;
    this.setConfig(cfg);
    return String(cfg.opCounter).padStart(4, '0');
  },

  // ═══ ORDENS DE PRODUÇÃO ══════════════════
  getOps()         { return this._get(this.KEYS.ops); },
  saveOps(list)    { this._set(this.KEYS.ops, list); },

  // ─── Helpers para Insumos / Consumo ────────────────
  getOpRequirements(modeloNome, qty) {
    if (!modeloNome) return null;
    const model = this.getModelos().find(m => m.nome === modeloNome);
    if (!model) return null;

    const result = {
      bucha: null,
      caixa: null
    };

    const materiais = this.getMateriais();

    if (model.buchaModelo) {
      const matBucha = materiais.find(m => m.nome.toLowerCase() === model.buchaModelo.toLowerCase());
      if (matBucha) {
        result.bucha = {
          materialId: matBucha.id,
          nome: matBucha.nome,
          unidade: matBucha.unidade,
          saldo: matBucha.saldo,
          necessario: qty,
          insuficiente: matBucha.saldo < qty,
          falta: Math.max(0, qty - matBucha.saldo)
        };
      }
    }

    if (model.caixa) {
      const matCaixa = materiais.find(m => m.nome.toLowerCase() === model.caixa.toLowerCase());
      if (matCaixa) {
        result.caixa = {
          materialId: matCaixa.id,
          nome: matCaixa.nome,
          unidade: matCaixa.unidade,
          saldo: matCaixa.saldo,
          necessario: qty,
          insuficiente: matCaixa.saldo < qty,
          falta: Math.max(0, qty - matCaixa.saldo)
        };
      }
    }

    return result;
  },

  consumeMaterialsForOp(modeloNome, qty, opNumero, opId) {
    const reqs = this.getOpRequirements(modeloNome, qty);
    if (!reqs) return;

    if (reqs.bucha) {
      this.addMovimento({
        materialId: reqs.bucha.materialId,
        materialNome: reqs.bucha.nome,
        tipo: 'Saída',
        qty: qty,
        opId: opId,
        opNumero: opNumero,
        obs: `Consumo automático (OP ${opNumero} concluída)`
      });
    }

    if (reqs.caixa) {
      this.addMovimento({
        materialId: reqs.caixa.materialId,
        materialNome: reqs.caixa.nome,
        tipo: 'Saída',
        qty: qty,
        opId: opId,
        opNumero: opNumero,
        obs: `Consumo automático (OP ${opNumero} concluída)`
      });
    }
  },

  revertConsumptionForOp(op) {
    if (!op.consumido) return;
    const reqs = this.getOpRequirements(op.modelo, op.qty);
    if (!reqs) return;

    if (reqs.bucha) {
      this.addMovimento({
        materialId: reqs.bucha.materialId,
        materialNome: reqs.bucha.nome,
        tipo: 'Entrada',
        qty: op.qty,
        opId: op.id,
        opNumero: op.numero,
        obs: `Estorno de consumo (OP ${op.numero} alterada de Pronto/Entregue)`
      });
    }

    if (reqs.caixa) {
      this.addMovimento({
        materialId: reqs.caixa.materialId,
        materialNome: reqs.caixa.nome,
        tipo: 'Entrada',
        qty: op.qty,
        opId: op.id,
        opNumero: op.numero,
        obs: `Estorno de consumo (OP ${op.numero} alterada de Pronto/Entregue)`
      });
    }
  },

  addOp(data) {
    const ops = this.getOps();
    const op = {
      id:         this._id(),
      numero:     'OP-' + this.nextOpNumber(),
      modelo:     data.modelo     || '',
      qty:        data.qty        || 1,
      cliente:    data.cliente    || '',
      prazo:      data.prazo      || '',
      etapa:      data.etapa      || 'Fila de Espera',
      prioridade: data.prioridade || 'Normal',
      obs:        data.obs        || '',
      consumido:  false,
      criadoEm:   this._now(),
      atualizadoEm: this._now(),
    };

    if (op.etapa === 'Pronto/Entregue') {
      this.consumeMaterialsForOp(op.modelo, op.qty, op.numero, op.id);
      op.consumido = true;
    }

    ops.push(op);
    this.saveOps(ops);
    this.addAtividade(`Nova OP criada: ${op.numero} – ${op.modelo}`, 'blue');
    return op;
  },

  updateOp(id, data) {
    const ops = this.getOps();
    const oldOpIndex = ops.findIndex(o => o.id === id);
    if (oldOpIndex === -1) return null;

    const oldOp = ops[oldOpIndex];
    let consumido = oldOp.consumido || false;

    // Transition checks
    if (oldOp.etapa === 'Pronto/Entregue') {
      if (data.etapa !== 'Pronto/Entregue') {
        // Reverted
        this.revertConsumptionForOp(oldOp);
        consumido = false;
      } else if (data.qty !== oldOp.qty || data.modelo !== oldOp.modelo) {
        // Quantity or model changed
        this.revertConsumptionForOp(oldOp);
        this.consumeMaterialsForOp(data.modelo, data.qty, oldOp.numero, oldOp.id);
        consumido = true;
      }
    } else if (data.etapa === 'Pronto/Entregue') {
      // Completed now
      this.consumeMaterialsForOp(data.modelo, data.qty, oldOp.numero, oldOp.id);
      consumido = true;
    }

    const updatedOp = {
      ...oldOp,
      ...data,
      consumido,
      atualizadoEm: this._now()
    };

    ops[oldOpIndex] = updatedOp;
    this.saveOps(ops);
    this.addAtividade(`OP ${updatedOp.numero} atualizada`, 'teal');
    return updatedOp;
  },

  deleteOp(id) {
    const ops = this.getOps();
    const op  = ops.find(o => o.id === id);
    if (op && op.consumido) {
      this.revertConsumptionForOp(op);
    }
    this.saveOps(ops.filter(o => o.id !== id));
    if (op) this.addAtividade(`OP ${op.numero} removida`, 'red');
  },

  getOpById(id) { return this.getOps().find(o => o.id === id); },

  // ═══ MODELOS ════════════════════════════
  getModelos()      { return this._get(this.KEYS.modelos); },
  saveModelos(list) { this._set(this.KEYS.modelos, list); },

  normalizeModelo(data, existing = {}) {
    const value = (field, fallback = '') => {
      if (Object.prototype.hasOwnProperty.call(data, field)) return String(data[field] ?? '').trim();
      return String(existing[field] ?? fallback).trim();
    };

    const diametroTuboAnel = value('diametroTuboAnel', data.tuboAnel ?? existing.tuboAnel ?? '');
    const descricaoCaixa = value('descricaoCaixa', data.caixa ?? existing.caixa ?? '');
    const now = this._now();

    return {
      ...existing,
      id: existing.id || this._id(),
      nome: value('nome'),
      sku: value('sku'),
      codigoBruto: value('codigoBruto'),
      diametroTuboAnel,
      descricaoTinyTuboAl: value('descricaoTinyTuboAl'),
      skuTinyTuboAl: value('skuTinyTuboAl'),
      comprimentoAnel: value('comprimentoAnel'),
      anel: value('anel'),
      diametroLataoBucha: value('diametroLataoBucha'),
      descricaoTinyLatao: value('descricaoTinyLatao'),
      skuTinyLatao: value('skuTinyLatao'),
      comprimentoBucha: value('comprimentoBucha'),
      bucha: value('bucha'),
      cor: value('cor'),
      alturaBuchas: value('alturaBuchas'),
      modeloBucha: value('modeloBucha', data.buchaModelo ?? existing.buchaModelo ?? ''),
      skuBucha: value('skuBucha', data.skuTinyBucha ?? existing.skuTinyBucha ?? ''),
      descricaoCaixa,
      skuCaixa: value('skuCaixa'),
      pas: value('pas', '3'),
      material: value('material', 'Alumínio'),
      diametro: value('diametro'),
      passo: value('passo'),
      peso: value('peso'),
      desc: value('desc'),
      // Compatibilidade com os módulos de estoque/OP existentes.
      tuboAnel: diametroTuboAnel,
      caixa: descricaoCaixa,
      buchaModelo: value('modeloBucha', data.buchaModelo ?? existing.buchaModelo ?? ''),
      criadoEm: existing.criadoEm || now,
      atualizadoEm: now,
    };
  },

  validateModeloUnique(data, ignoreId = '') {
    const sku = String(data.sku || '').trim().toLocaleUpperCase('pt-BR');
    if (!sku) throw new Error('Informe o SKU da hélice.');
    const duplicate = this.getModelos().find((modelo) =>
      modelo.id !== ignoreId && String(modelo.sku || '').trim().toLocaleUpperCase('pt-BR') === sku
    );
    if (duplicate) throw new Error(`O SKU ${data.sku} já pertence a ${duplicate.nome}.`);
  },

  addModelo(data) {
    const modelos = this.getModelos();
    this.validateModeloUnique(data);
    const m = this.normalizeModelo(data);
    modelos.push(m);
    this.saveModelos(modelos);
    this.addAtividade(`Novo modelo cadastrado: ${m.nome}`, 'blue');
    return m;
  },

  updateModelo(id, data) {
    this.validateModeloUnique(data, id);
    const list = this.getModelos().map(m =>
      m.id === id ? this.normalizeModelo(data, m) : m
    );
    this.saveModelos(list);
    return list.find(m => m.id === id);
  },

  deleteModelo(id) {
    const modelos = this.getModelos();
    const modelo = modelos.find(m => m.id === id);
    if (!modelo) return null;
    this.saveModelos(modelos.filter(m => m.id !== id));
    this.addAtividade(`Modelo removido do catálogo: ${modelo.nome}`, 'red');
    return modelo;
  },

  ensureCatalogoAtualizado() {
    if (typeof CATALOGO_DATA === 'undefined' || !Array.isArray(CATALOGO_DATA)) return false;
    if (typeof CATALOGO_VERSION === 'undefined') return false;

    const config = this.getConfig();
    if (config.catalogoVersion === CATALOGO_VERSION) return false;

    const existingBySku = new Map(
      this.getModelos().map((modelo) => [String(modelo.sku || '').trim().toLocaleUpperCase('pt-BR'), modelo])
    );
    const catalogo = CATALOGO_DATA.map((data) => {
      const key = String(data.sku || '').trim().toLocaleUpperCase('pt-BR');
      return this.normalizeModelo(data, existingBySku.get(key) || {});
    });

    this.saveModelos(catalogo);
    this.setConfig({
      ...config,
      catalogoVersion: CATALOGO_VERSION,
      catalogoAtualizadoEm: this._now(),
    });
    this.addAtividade(`Catálogo ${CATALOGO_VERSION} carregado: ${catalogo.length} hélices.`, 'green');
    return true;
  },

  // ═══ BUCHAS ═════════════════════════════
  getBuchas()      { return this._get(this.KEYS.buchas); },
  saveBuchas(list) { this._set(this.KEYS.buchas, list); },

  normalizeBucha(data, existing = {}) {
    const value = (field, fallback = '') => {
      if (Object.prototype.hasOwnProperty.call(data, field)) return String(data[field] ?? '').trim();
      return String(existing[field] ?? fallback).trim();
    };

    const now = this._now();
    return {
      ...existing,
      id: existing.id || this._id(),
      sku: value('sku'),
      descricao: value('descricao'),
      dimensoes: value('dimensoes'),
      comprimento: parseFloat(data.comprimento ?? existing.comprimento) || 0,
      peso: parseFloat(data.peso ?? existing.peso) || 0,
      aplicacao: value('aplicacao', 'Geral'),
      criadoEm: existing.criadoEm || now,
      atualizadoEm: now,
    };
  },

  validateBuchaUnique(data, ignoreId = '') {
    const sku = String(data.sku || '').trim().toLocaleUpperCase('pt-BR');
    if (!sku) throw new Error('Informe o SKU da bucha.');
    const duplicate = this.getBuchas().find((bucha) =>
      bucha.id !== ignoreId && String(bucha.sku || '').trim().toLocaleUpperCase('pt-BR') === sku
    );
    if (duplicate) {
      throw new Error(`O SKU "${data.sku}" já pertence à bucha "${duplicate.descricao}".`);
    }
  },

  // ═══ CATÁLOGO DE FUNDIÇÃO (COQUILHAS & APLICAÇÕES) ════
  getFundicaoCatalog() {
    let list = this._get(this.KEYS.fundicaoCatalog);
    if (!list || !list.length) {
      this.ensureFundicaoCatalogAtualizada();
      list = this._get(this.KEYS.fundicaoCatalog);
    }
    return list || [];
  },

  saveFundicaoCatalog(list) {
    this._set(this.KEYS.fundicaoCatalog, list);
  },

  getCoquilhasCatalog() {
    let list = this._get(this.KEYS.coquilhasCatalog);
    if (!list || !list.length) {
      if (typeof window !== 'undefined' && window.WINDOW_COQUILHAS_DEFAULT) {
        list = window.WINDOW_COQUILHAS_DEFAULT;
        this.saveCoquilhasCatalog(list);
      }
    }
    return list || [];
  },

  saveCoquilhasCatalog(list) {
    this._set(this.KEYS.coquilhasCatalog, list);
  },

  ensureFundicaoCatalogAtualizada() {
    const list = this._get(this.KEYS.fundicaoCatalog);
    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    if (!list.length && win.WINDOW_FUNDICAO_CATALOG_DEFAULT) {
      this.saveFundicaoCatalog(win.WINDOW_FUNDICAO_CATALOG_DEFAULT);
      if (win.WINDOW_COQUILHAS_DEFAULT) {
        this.saveCoquilhasCatalog(win.WINDOW_COQUILHAS_DEFAULT);
      }
      this.addAtividade('Catálogo de Fundição importado com sucesso da planilha oficial.', 'teal');
      return true;
    }
    return false;
  },

  addFundicaoCatalogItem(data) {
    const catalog = this.getFundicaoCatalog();
    const item = {
      id: `fnd_${this._id()}`,
      coquilha: String(data.coquilha || '').trim(),
      descricao: String(data.descricao || '').trim(),
      sku: String(data.sku || '').trim().toUpperCase()
    };
    catalog.unshift(item);
    this.saveFundicaoCatalog(catalog);
    this.addAtividade(`Novo item adicionado ao Catálogo de Fundição: ${item.coquilha} - ${item.sku}`, 'teal');
    return item;
  },

  updateFundicaoCatalogItem(id, data) {
    const catalog = this.getFundicaoCatalog();
    const idx = catalog.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Item do Catálogo de Fundição não encontrado.');

    catalog[idx] = {
      ...catalog[idx],
      coquilha: String(data.coquilha || catalog[idx].coquilha).trim(),
      descricao: String(data.descricao || catalog[idx].descricao).trim(),
      sku: String(data.sku || catalog[idx].sku).trim().toUpperCase()
    };

    this.saveFundicaoCatalog(catalog);
    this.addAtividade(`Item do Catálogo de Fundição atualizado: ${catalog[idx].sku}`, 'blue');
    return catalog[idx];
  },

  deleteFundicaoCatalogItem(id) {
    const catalog = this.getFundicaoCatalog();
    const item = catalog.find(c => c.id === id);
    if (!item) return false;

    const filtered = catalog.filter(c => c.id !== id);
    this.saveFundicaoCatalog(filtered);
    this.addAtividade(`Item removido do Catálogo de Fundição: ${item.sku}`, 'red');
    return true;
  },

  addBucha(data) {
    this.validateBuchaUnique(data);
    const bucha = this.normalizeBucha(data);
    const list = [...this.getBuchas(), bucha];
    this.saveBuchas(list);
    this.addAtividade(`Bucha adicionada: ${bucha.descricao} (${bucha.sku})`, 'teal');
    return bucha;
  },

  updateBucha(id, data) {
    this.validateBuchaUnique(data, id);
    let updated = null;
    const list = this.getBuchas().map((item) => {
      if (item.id === id) {
        updated = this.normalizeBucha(data, item);
        return updated;
      }
      return item;
    });
    this.saveBuchas(list);
    return updated;
  },

  deleteBucha(id) {
    const buchas = this.getBuchas();
    const bucha = buchas.find((b) => b.id === id);
    if (!bucha) return null;
    this.saveBuchas(buchas.filter((b) => b.id !== id));
    this.addAtividade(`Bucha removida do catálogo: ${bucha.descricao}`, 'red');
    return bucha;
  },

  ensureBuchasAtualizadas() {
    if (typeof BUCHAS_DATA === 'undefined' || !Array.isArray(BUCHAS_DATA)) return false;
    if (typeof BUCHAS_VERSION === 'undefined') return false;

    const config = this.getConfig();
    if (config.buchasVersion === BUCHAS_VERSION) return false;

    const existingBySku = new Map(
      this.getBuchas().map((bucha) => [String(bucha.sku || '').trim().toLocaleUpperCase('pt-BR'), bucha])
    );
    const buchas = BUCHAS_DATA.map((data) => {
      const key = String(data.sku || '').trim().toLocaleUpperCase('pt-BR');
      return this.normalizeBucha(data, existingBySku.get(key) || {});
    });

    this.saveBuchas(buchas);
    this.setConfig({
      ...config,
      buchasVersion: BUCHAS_VERSION,
      buchasAtualizadasEm: this._now(),
    });
    this.addAtividade(`Catálogo de buchas ${BUCHAS_VERSION} carregado: ${buchas.length} itens.`, 'teal');
    return true;
  },

  // ═══ OPs DE BUCHAS ══════════════════════
  getBuchasOps()      { return this._get(this.KEYS.buchasOps); },
  saveBuchasOps(list) { this._set(this.KEYS.buchasOps, list); },

  generateBuchaOpNumber() {
    const ops = this.getBuchasOps();
    const numbers = ops
      .map(o => parseInt(String(o.opNumber || '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const max = numbers.length ? Math.max(...numbers) : 0;
    return `OPB-${String(max + 1).padStart(6, '0')}`;
  },

  addBuchaOp(data) {
    const buchas = this.getBuchas();
    const bucha = buchas.find(b => b.sku === data.sku) || {};
    const opNumber = data.opNumber || this.generateBuchaOpNumber();
    const qty = parseInt(data.quantity, 10) || 1;
    const now = this._now();

    const op = {
      id: `opb_${this._id()}`,
      opNumber,
      sku: data.sku || 'DESCONHECIDO',
      description: bucha.descricao || data.description || 'Bucha sem descrição',
      quantity: qty,
      priority: data.priority || 'Normal',
      currentStage: 'op01', // op01: Retrabalho, op02: Vulcanização, op03: Estoque Final
      status: 'em_producao', // em_producao | finalizada | refugada
      entryDate: data.entryDate || now.split(' ')[0],
      obs: data.obs || '',
      history: [
        { date: now, stage: 'Retrabalho', action: 'OP de Bucha gerada', user: 'Sistema' }
      ],
      stages: [
        { code: 'op01', name: 'Retrabalho', quantity: qty },
        { code: 'op02', name: 'Vulcanização', quantity: 0 },
        { code: 'op03', name: 'Estoque Final', quantity: 0 }
      ]
    };

    const list = [op, ...this.getBuchasOps()];
    this.saveBuchasOps(list);
    this.addAtividade(`Nova OP de Bucha criada: ${op.opNumber} (${op.sku} - ${qty} un)`, 'teal');
    return op;
  },

  advanceBuchaOp(id, quantityToMove, destinationStage, remainingAction = 'split') {
    const ops = this.getBuchasOps();
    const opIndex = ops.findIndex(o => o.id === id);
    if (opIndex === -1) throw new Error('OP de Bucha não encontrada.');

    const op = ops[opIndex];
    const qtyMove = Math.min(op.quantity, parseInt(quantityToMove, 10) || op.quantity);
    const qtyRemaining = op.quantity - qtyMove;
    const now = this._now();
    const stageNames = { op01: 'Retrabalho', op02: 'Vulcanização', op03: 'Estoque Final' };

    if (qtyRemaining > 0) {
      if (remainingAction === 'split') {
        const subOpNumber = `${op.opNumber}.1`;
        const subOp = {
          ...JSON.parse(JSON.stringify(op)),
          id: `opb_${this._id()}`,
          opNumber: subOpNumber,
          quantity: qtyRemaining,
          history: [
            ...op.history,
            { date: now, stage: stageNames[op.currentStage], action: `Desmembrada da OP ${op.opNumber} com ${qtyRemaining} un`, user: 'Operador' }
          ]
        };
        ops.splice(opIndex + 1, 0, subOp);
      } else if (remainingAction === 'scrap') {
        const refOpNumber = `${op.opNumber}.REF.1`;
        const refOp = {
          ...JSON.parse(JSON.stringify(op)),
          id: `opb_${this._id()}`,
          opNumber: refOpNumber,
          quantity: qtyRemaining,
          status: 'refugada',
          history: [
            ...op.history,
            { date: now, stage: stageNames[op.currentStage], action: `Refugada com ${qtyRemaining} un`, user: 'Operador' }
          ]
        };
        ops.splice(opIndex + 1, 0, refOp);
      }
    }

    op.quantity = qtyMove;
    op.currentStage = destinationStage;
    if (destinationStage === 'op03') {
      op.status = 'finalizada';
    }

    op.stages = op.stages.map(st => {
      if (st.code === destinationStage) return { ...st, quantity: qtyMove };
      return st;
    });

    op.history.push({
      date: now,
      stage: stageNames[destinationStage],
      action: `Avançou ${qtyMove} peças para ${stageNames[destinationStage]}`,
      user: 'Operador'
    });

    this.saveBuchasOps(ops);
    this.addAtividade(`OP de Bucha ${op.opNumber} avançou para ${stageNames[destinationStage]}`, 'green');
    return op;
  },

  deleteBuchaOp(id) {
    const ops = this.getBuchasOps();
    const op = ops.find(o => o.id === id);
    if (!op) return null;
    this.saveBuchasOps(ops.filter(o => o.id !== id));
    this.addAtividade(`OP de Bucha removida: ${op.opNumber}`, 'red');
    return op;
  },

  ensureBuchasOpsSeed() {
    const existing = this.getBuchasOps();
    if (existing && existing.length > 0) return false;

    const buchas = this.getBuchas();
    if (!buchas.length) return false;

    const seedSpecs = [
      { sku: 'HR BH 001', qty: 200, stage: 'op01', status: 'em_producao' },
      { sku: 'HR BH 002', qty: 150, stage: 'op01', status: 'em_producao' },
      { sku: 'HR BH 003', qty: 100, stage: 'op02', status: 'em_producao' },
      { sku: 'HR BH 004', qty: 80,  stage: 'op02', status: 'em_producao' },
      { sku: 'HR BH 005', qty: 250, stage: 'op03', status: 'finalizada' }
    ];

    const seedOps = seedSpecs.map((spec, i) => {
      const bucha = buchas.find(b => b.sku === spec.sku) || buchas[i % buchas.length];
      const opNum = `OPB-${String(i + 1).padStart(6, '0')}`;
      const stageNames = { op01: 'Retrabalho', op02: 'Vulcanização', op03: 'Estoque Final' };
      return {
        id: `opb_seed_${i + 1}`,
        opNumber: opNum,
        sku: bucha.sku,
        description: bucha.descricao,
        quantity: spec.qty,
        priority: i % 2 === 0 ? 'Alta' : 'Normal',
        currentStage: spec.stage,
        status: spec.status,
        entryDate: '2026-08-07',
        obs: 'Lote inicial cadastrado',
        history: [
          { date: '2026-08-07 10:00:00', stage: stageNames[spec.stage], action: 'Lote inicial registrado', user: 'Sistema' }
        ],
        stages: [
          { code: 'op01', name: 'Retrabalho', quantity: spec.stage === 'op01' ? spec.qty : 0 },
          { code: 'op02', name: 'Vulcanização', quantity: spec.stage === 'op02' ? spec.qty : 0 },
          { code: 'op03', name: 'Estoque Final', quantity: spec.stage === 'op03' ? spec.qty : 0 }
        ]
      };
    });

    this.saveBuchasOps(seedOps);
    this.addAtividade('Demonstração de OPs de Bucha carregada com sucesso.', 'teal');
    return true;
  },

  // ═══ ENTRADAS E SAÍDAS DE BUCHAS ════════
  getBuchasEntradas()      { return this._get(this.KEYS.buchasEntradas); },
  saveBuchasEntradas(list) { this._set(this.KEYS.buchasEntradas, list); },
  getBuchasSaidas()        { return this._get(this.KEYS.buchasSaidas); },
  saveBuchasSaidas(list)   { this._set(this.KEYS.buchasSaidas, list); },

  generateBuchaEntradaCodigo() {
    const list = this.getBuchasEntradas();
    const numbers = list
      .map(e => parseInt(String(e.codigoEntrada || '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const max = numbers.length ? Math.max(...numbers) : 0;
    return `ENT-BCH-${String(max + 1).padStart(6, '0')}`;
  },

  generateBuchaSaidaCodigo() {
    const list = this.getBuchasSaidas();
    const numbers = list
      .map(s => parseInt(String(s.codigoSaida || '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n));
    const max = numbers.length ? Math.max(...numbers) : 0;
    return `SAI-BCH-${String(max + 1).padStart(6, '0')}`;
  },

  addBuchaEntrada(data) {
    const buchas = this.getBuchas();
    const bucha = buchas.find(b => b.sku === data.sku) || {};
    const codigoEntrada = data.codigoEntrada || this.generateBuchaEntradaCodigo();
    const qty = parseInt(data.quantidade, 10) || 1;
    const etapaInicial = data.etapaInicial || 'Usinagem'; // 'Usinagem' | 'Retrabalho' | 'Vulcanizacao' | 'Estoque Final'
    const now = this._now();

    const entrada = {
      id: `ent_${this._id()}`,
      codigoEntrada,
      sku: data.sku || 'DESCONHECIDO',
      descricao: bucha.descricao || data.descricao || 'Bucha sem descrição',
      quantidade: qty,
      etapaAtual: etapaInicial,
      status: etapaInicial === 'Estoque Final' ? 'Concluido' : 'Em Andamento',
      dataCriacao: now,
      origemObs: data.origemObs || 'Entrada manual de lote',
      historico: [
        { data: now, acao: `Entrada registrada em ${etapaInicial} com ${qty} un`, usuario: 'Operador' }
      ]
    };

    const list = [entrada, ...this.getBuchasEntradas()];
    this.saveBuchasEntradas(list);
    this.addAtividade(`Nova Entrada de Bucha registrada: ${entrada.codigoEntrada} (${entrada.sku} - ${qty} un em ${etapaInicial})`, 'teal');
    return entrada;
  },

  moverBuchaEntrada(id, qtyMover, proximaEtapa, acaoSaldoRestante = 'manter') {
    const entradas = this.getBuchasEntradas();
    const idx = entradas.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Entrada de bucha não encontrada.');

    const entrada = entradas[idx];
    const moveQty = Math.min(entrada.quantidade, parseInt(qtyMover, 10) || entrada.quantidade);
    const remainingQty = entrada.quantidade - moveQty;
    const now = this._now();

    if (remainingQty > 0) {
      if (acaoSaldoRestante === 'manter' || acaoSaldoRestante === 'split') {
        const subCodigo = `${entrada.codigoEntrada}.1`;
        const subEntrada = {
          ...JSON.parse(JSON.stringify(entrada)),
          id: `ent_${this._id()}`,
          codigoEntrada: subCodigo,
          quantidade: remainingQty,
          historico: [
            ...entrada.historico,
            { data: now, acao: `Desmembrado de ${entrada.codigoEntrada} mantendo ${remainingQty} un em ${entrada.etapaAtual}`, usuario: 'Operador' }
          ]
        };
        entradas.splice(idx + 1, 0, subEntrada);
      }
    }

    entrada.quantidade = moveQty;
    entrada.etapaAtual = proximaEtapa;
    if (proximaEtapa === 'Estoque Final') {
      entrada.status = 'Concluido';
    }

    entrada.historico.push({
      data: now,
      acao: `Avançou ${moveQty} un para ${proximaEtapa}`,
      usuario: 'Operador'
    });

    this.saveBuchasEntradas(entradas);
    this.addAtividade(`Lote de Bucha ${entrada.codigoEntrada} avançou para ${proximaEtapa} (${moveQty} un)`, 'green');
    return entrada;
  },

  addBuchaSaida(data) {
    const buchas = this.getBuchas();
    const bucha = buchas.find(b => b.sku === data.sku) || {};
    const codigoSaida = data.codigoSaida || this.generateBuchaSaidaCodigo();
    const qty = parseInt(data.quantidade, 10) || 1;
    const now = this._now();

    const saldos = this.getBuchasSaldosConsolidados();
    const saldoObj = saldos.find(s => s.sku === data.sku);
    const disponivel = saldoObj ? saldoObj.qtdAcabada : 0;

    if (qty > disponivel) {
      throw new Error(`Saldo insuficiente no Estoque Final para ${data.sku}. Disponível: ${disponivel} un, Solicitado: ${qty} un.`);
    }

    const saida = {
      id: `sai_${this._id()}`,
      codigoSaida,
      sku: data.sku,
      descricao: bucha.descricao || 'Bucha sem descrição',
      quantidade: qty,
      destinoObs: data.destinoObs || 'Baixa de estoque',
      dataSaida: now,
      usuario: 'Operador'
    };

    const list = [saida, ...this.getBuchasSaidas()];
    this.saveBuchasSaidas(list);
    this.addAtividade(`Saída de Bucha registrada: ${saida.codigoSaida} (${saida.sku} - ${qty} un)`, 'orange');
    return saida;
  },

  getBuchasSaldosConsolidados() {
    const catalog = this.getBuchas();
    const entradas = this.getBuchasEntradas();
    const saidas = this.getBuchasSaidas();

    return catalog.map(bucha => {
      const skuUpper = String(bucha.sku || '').trim().toUpperCase();

      const qtdUsinagem = entradas
        .filter(e => String(e.sku || '').trim().toUpperCase() === skuUpper && e.status === 'Em Andamento' && e.etapaAtual === 'Usinagem')
        .reduce((sum, e) => sum + (Number(e.quantidade) || 0), 0);

      const qtdRetrabalho = entradas
        .filter(e => String(e.sku || '').trim().toUpperCase() === skuUpper && e.status === 'Em Andamento' && e.etapaAtual === 'Retrabalho')
        .reduce((sum, e) => sum + (Number(e.quantidade) || 0), 0);

      const qtdVulcanizacao = entradas
        .filter(e => String(e.sku || '').trim().toUpperCase() === skuUpper && e.status === 'Em Andamento' && e.etapaAtual === 'Vulcanizacao')
        .reduce((sum, e) => sum + (Number(e.quantidade) || 0), 0);

      const qtdEstoqueEntradas = entradas
        .filter(e => String(e.sku || '').trim().toUpperCase() === skuUpper && (e.etapaAtual === 'Estoque Final' || e.status === 'Concluido'))
        .reduce((sum, e) => sum + (Number(e.quantidade) || 0), 0);

      const qtdSaidas = saidas
        .filter(s => String(s.sku || '').trim().toUpperCase() === skuUpper)
        .reduce((sum, s) => sum + (Number(s.quantidade) || 0), 0);

      const qtdAcabada = Math.max(0, qtdEstoqueEntradas - qtdSaidas);
      const saldoTotal = qtdUsinagem + qtdRetrabalho + qtdVulcanizacao + qtdAcabada;

      return {
        ...bucha,
        qtdUsinagem,
        qtdRetrabalho,
        qtdVulcanizacao,
        qtdAcabada,
        qtdSaidas,
        saldoTotal
      };
    });
  },

  ensureBuchasEntradasSeed() {
    const existingEntradas = this.getBuchasEntradas();
    // Se contiver dados fictícios antigos de teste, limpa para garantir saldos zerados reais
    if (Array.isArray(existingEntradas) && existingEntradas.some(e => String(e.id || '').includes('seed'))) {
      const semSeed = existingEntradas.filter(e => !String(e.id || '').includes('seed'));
      this.saveBuchasEntradas(semSeed);
    }
    const existingSaidas = this.getBuchasSaidas();
    if (Array.isArray(existingSaidas) && existingSaidas.some(s => String(s.id || '').includes('seed'))) {
      const semSeedSaidas = existingSaidas.filter(s => !String(s.id || '').includes('seed'));
      this.saveBuchasSaidas(semSeedSaidas);
    }
    return true;
  },

  // ═══ MATERIAIS / ESTOQUE ════════════════
  getMateriais()      { return this._get(this.KEYS.materiais); },
  saveMateriais(list) { this._set(this.KEYS.materiais, list); },

  addMaterial(data) {
    const list = this.getMateriais();
    const m = {
      id:         this._id(),
      nome:       data.nome       || '',
      unidade:    data.unidade    || 'kg',
      saldo:      parseFloat(data.saldo)   || 0,
      minimo:     parseFloat(data.minimo)  || 0,
      fornecedor: data.fornecedor || '',
      criadoEm:  this._now(),
    };
    list.push(m);
    this.saveMateriais(list);
    this.addAtividade(`Material cadastrado: ${m.nome}`, 'blue');
    return m;
  },

  updateMaterial(id, data) {
    const list = this.getMateriais().map(m =>
      m.id === id ? { ...m, ...data } : m
    );
    this.saveMateriais(list);
    return list.find(m => m.id === id);
  },

  deleteMaterial(id) {
    this.saveMateriais(this.getMateriais().filter(m => m.id !== id));
    this.addAtividade('Material removido do estoque', 'red');
  },

  getMaterialById(id) { return this.getMateriais().find(m => m.id === id); },

  // ═══ MOVIMENTAÇÕES ══════════════════════
  getMovimentos()      { return this._get(this.KEYS.movimentos); },
  saveMovimentos(list) { this._set(this.KEYS.movimentos, list); },

  addMovimento(data) {
    const movs = this.getMovimentos();
    const mov = {
      id:          this._id(),
      materialId:  data.materialId  || '',
      materialNome:data.materialNome || '',
      tipo:        data.tipo        || 'Entrada',
      qty:         parseFloat(data.qty) || 0,
      opId:        data.opId        || '',
      opNumero:    data.opNumero    || '',
      obs:         data.obs         || '',
      data:        this._now(),
    };
    movs.push(mov);
    this.saveMovimentos(movs);

    // Atualiza saldo do material
    const mats = this.getMateriais().map(m => {
      if (m.id === mov.materialId) {
        const delta = mov.tipo === 'Entrada' ? mov.qty : -mov.qty;
        return { ...m, saldo: Math.max(0, m.saldo + delta) };
      }
      return m;
    });
    this.saveMateriais(mats);
    this.addAtividade(`Movimentação: ${mov.tipo} de ${mov.qty} ${mov.materialNome}`, mov.tipo === 'Entrada' ? 'green' : 'orange');
    return mov;
  },

  // ═══ PEDIDOS ════════════════════════════
  getPedidos()      { return this._get(this.KEYS.pedidos); },
  savePedidos(list) { this._set(this.KEYS.pedidos, list); },
  _pedidoCounter: null,

  nextPedidoNumber() {
    const list = this.getPedidos();
    const nums = list.map(p => parseInt(p.numero?.replace('PED-','') || '0', 10));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return 'PED-' + String(next).padStart(4, '0');
  },

  addPedido(data) {
    const list = this.getPedidos();
    const p = {
      id:         this._id(),
      numero:     this.nextPedidoNumber(),
      cliente:    data.cliente    || '',
      modelo:     data.modelo     || '',
      qty:        data.qty        || 1,
      prazo:      data.prazo      || '',
      prioridade: data.prioridade || 'Normal',
      status:     data.status     || 'Aguardando',
      obs:        data.obs        || '',
      criadoEm:   this._now(),
    };
    list.push(p);
    this.savePedidos(list);
    this.addAtividade(`Novo pedido: ${p.numero} – ${p.cliente}`, 'purple');
    return p;
  },

  updatePedido(id, data) {
    const list = this.getPedidos().map(p =>
      p.id === id ? { ...p, ...data } : p
    );
    this.savePedidos(list);
    return list.find(p => p.id === id);
  },

  deletePedido(id) {
    this.savePedidos(this.getPedidos().filter(p => p.id !== id));
    this.addAtividade('Pedido removido', 'red');
  },

  // ═══ PROGRAMAÇÃO DE FUNDIÇÃO ══════════════
  getFundicoes()       { return this._get(this.KEYS.fundicoes); },
  saveFundicoes(list)  { this._set(this.KEYS.fundicoes, list); },

  nextFundicaoNumber() {
    const list = this.getFundicoes();
    const nums = list.map(f => parseInt(f.numero?.replace('FND-','') || '0', 10));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return 'FND-' + String(next).padStart(4, '0');
  },

  addFundicao(data) {
    const list = this.getFundicoes();
    const f = {
      id:         this._id(),
      numero:     this.nextFundicaoNumber(),
      modelo:     data.modelo     || '',
      material:   data.material   || '',
      qty:        parseInt(data.qty) || 1,
      peso:       parseFloat(data.peso) || 0,
      data:       data.data       || '',
      forno:      data.forno      || '',
      temp:       data.temp       || '',
      status:     data.status     || 'Agendado',
      obs:        data.obs        || '',
      criadoEm:   this._now(),
    };
    list.push(f);
    this.saveFundicoes(list);
    this.addAtividade(`Nova programação de fundição: ${f.numero} – ${f.modelo}`, 'orange');
    return f;
  },

  updateFundicao(id, data) {
    const list = this.getFundicoes().map(f =>
      f.id === id ? { ...f, ...data } : f
    );
    this.saveFundicoes(list);
    this.addAtividade(`Prog. fundição ${list.find(f=>f.id===id)?.numero} atualizada`, 'teal');
    return list.find(f => f.id === id);
  },

  deleteFundicao(id) {
    const list = this.getFundicoes();
    const f = list.find(x => x.id === id);
    this.saveFundicoes(list.filter(x => x.id !== id));
    if (f) this.addAtividade(`Prog. fundição ${f.numero} removida`, 'red');
  },

  // ═══ MANUTENÇÃO DE FERRAMENTAS ════════════════
  getManutencoes()       { return this._get(this.KEYS.manutencoes); },
  saveManutencoes(list)  { this._set(this.KEYS.manutencoes, list); },

  nextManutencaoNumber() {
    const list = this.getManutencoes();
    const nums = list.map(m => parseInt(m.numero?.replace('MNT-','') || '0', 10));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return 'MNT-' + String(next).padStart(4, '0');
  },

  addManutencao(data) {
    const list = this.getManutencoes();
    const m = {
      id:           this._id(),
      numero:       this.nextManutencaoNumber(),
      ferramenta:   data.ferramenta   || '',
      tipo:         data.tipo         || 'Coquilha',
      motivo:       data.motivo       || '',
      responsavel:  data.responsavel  || '',
      dataEntrada:  data.dataEntrada  || '',
      dataPrevisao: data.dataPrevisao || '',
      status:       data.status       || 'Em Manutenção',
      prioridade:   data.prioridade   || 'Normal',
      obs:          data.obs          || '',
      criadoEm:     this._now(),
      atualizadoEm: this._now(),
    };
    list.push(m);
    this.saveManutencoes(list);
    this.addAtividade(`Ferramenta interditada: ${m.numero} – ${m.ferramenta}`, 'orange');
    return m;
  },

  updateManutencao(id, data) {
    const list = this.getManutencoes().map(m =>
      m.id === id ? { ...m, ...data, atualizadoEm: this._now() } : m
    );
    this.saveManutencoes(list);
    const updated = list.find(m => m.id === id);
    this.addAtividade(`Manutenção ${updated?.numero} atualizada`, 'teal');
    return updated;
  },

  deleteManutencao(id) {
    const list = this.getManutencoes();
    const m = list.find(x => x.id === id);
    this.saveManutencoes(list.filter(x => x.id !== id));
    if (m) this.addAtividade(`Manutenção ${m.numero} removida`, 'red');
  },

  // ═══ PEÇAS / RASTREIO DE OPERAÇÕES ════════════
  getPecas()       { return this._get(this.KEYS.pecas); },
  savePecas(list)  { this._set(this.KEYS.pecas, list); },

  nextPecaNumber() {
    const list = this.getPecas();
    const nums = list.map(p => parseInt(p.numero?.replace('PCA-','') || '0', 10));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return 'PCA-' + String(next).padStart(4, '0');
  },

  addPeca(data) {
    const list = this.getPecas();
    const p = {
      id:            this._id(),
      numero:        this.nextPecaNumber(),
      modelo:        data.modelo        || '',
      tipoFundicao:  data.tipoFundicao  || '',
      qty:           parseInt(data.qty) || 1,
      operacaoAtual: data.operacaoAtual || '01',
      obs:           data.obs           || '',
      historico: [{ op: data.operacaoAtual || '01', data: this._now(), obs: 'Entrada na operação' }],
      criadoEm:      this._now(),
      atualizadoEm:  this._now(),
    };
    list.push(p);
    this.savePecas(list);
    this.addAtividade(`Nova peça ${p.numero} – ${p.modelo} (Op. ${p.operacaoAtual})`, 'blue');
    return p;
  },

  updatePeca(id, data) {
    let list = this.getPecas();
    list = list.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...data, atualizadoEm: this._now() };
      // Se a operação mudou, registra no histórico
      if (data.operacaoAtual && data.operacaoAtual !== p.operacaoAtual) {
        updated.historico = [...(p.historico || []), {
          op: data.operacaoAtual,
          data: this._now(),
          obs: data.obsMovimento || 'Movido para operação',
        }];
        this.addAtividade(`Peça ${p.numero} movida para Op. ${data.operacaoAtual}`, 'teal');
      }
      return updated;
    });
    this.savePecas(list);
    return list.find(p => p.id === id);
  },

  deletePeca(id) {
    const list = this.getPecas();
    const p = list.find(x => x.id === id);
    this.savePecas(list.filter(x => x.id !== id));
    if (p) this.addAtividade(`Peça ${p.numero} removida`, 'red');
  },

  // ═══ ATIVIDADES ═════════════════════════
  getAtividades()      { return this._get(this.KEYS.atividades); },
  saveAtividades(list) { this._set(this.KEYS.atividades, list); },

  addAtividade(titulo, cor = 'blue') {
    const list = this.getAtividades();
    list.unshift({ id: this._id(), titulo, cor, data: this._now() });
    // mantém apenas 50 últimas
    this.saveAtividades(list.slice(0, 50));
  },

  // ─── Seed Data ──────────────────────────
  seed() {
    // One-time cleanup to ensure all mock/fake data is removed from RemoteStorage
    if (!RemoteStorage.getItem('hrn_cleaned_mock_data_v3')) {
      Object.values(this.KEYS).forEach(k => RemoteStorage.removeItem(k));
      RemoteStorage.setItem('hrn_cleaned_mock_data_v3', 'true');
    }

    this.ensureCatalogoAtualizado();

    // Seed/register raw materials in inventory (Estoque) based on standard materials and Excel sheet data
    const materiais = this.getMateriais();
    
    // Standard materials
    const temBucha = materiais.some(m => m.nome.toLowerCase() === 'bucha');
    const temCaixas = materiais.some(m => m.nome.toLowerCase() === 'caixas');
    if (!temBucha) {
      this.addMaterial({ nome: 'Bucha', unidade: 'un', saldo: 0, minimo: 10, fornecedor: 'Fornecedor de Buchas' });
    }
    if (!temCaixas) {
      this.addMaterial({ nome: 'Caixas', unidade: 'un', saldo: 0, minimo: 5, fornecedor: 'Fornecedor de Embalagens' });
    }

    // Now, scan all models and auto-register materials from the imported models if they do not exist
    const updatedMateriais = this.getMateriais();
    const materialNomes = new Set(updatedMateriais.map(m => m.nome.toLowerCase()));

    // Get all loaded models again
    const loadedModelos = this.getModelos();
    loadedModelos.forEach(m => {
      // 1. Tubo Alumínio
      if (m.tuboAnel && m.tuboAnel !== 'N/A' && m.tuboAnel !== 'N/T') {
        const tuboNome = `Tubo Alumínio ${m.tuboAnel}`;
        if (!materialNomes.has(tuboNome.toLowerCase())) {
          this.addMaterial({ nome: tuboNome, unidade: 'barras', saldo: 0, minimo: 5, fornecedor: 'Fornecedor de Tubos' });
          materialNomes.add(tuboNome.toLowerCase());
        }
      }
      // 2. Latão Bucha / Redondo
      if (m.bucha && m.bucha !== 'N/A') {
        const buchaMatNome = `Latão Redondo ${m.bucha.split(' x ')[0]}`;
        if (!materialNomes.has(buchaMatNome.toLowerCase())) {
          this.addMaterial({ nome: buchaMatNome, unidade: 'kg', saldo: 0, minimo: 10, fornecedor: 'Fornecedor de Metais' });
          materialNomes.add(buchaMatNome.toLowerCase());
        }
      }
      // 3. Modelo Caixa
      if (m.caixa && m.caixa !== 'N/A') {
        const caixaNome = m.caixa;
        if (!materialNomes.has(caixaNome.toLowerCase())) {
          this.addMaterial({ nome: caixaNome, unidade: 'peças', saldo: 0, minimo: 20, fornecedor: 'Fornecedor de Embalagens' });
          materialNomes.add(caixaNome.toLowerCase());
        }
      }
      // 4. Bucha Pronta (Usinada)
      if (m.buchaModelo && m.buchaModelo !== 'N/A') {
        const buchaProntaNome = m.buchaModelo;
        if (!materialNomes.has(buchaProntaNome.toLowerCase())) {
          this.addMaterial({ nome: buchaProntaNome, unidade: 'peças', saldo: 0, minimo: 10, fornecedor: 'Fabricação Interna / Estoque' });
          materialNomes.add(buchaProntaNome.toLowerCase());
        }
      }
    });

    // ── Seed Itens em Produção (Rastreio de OP + OPs vinculadas) ──────────────
    if (!RemoteStorage.getItem('hrn_seeded_itens_producao_v2') &&
        typeof ITENS_PRODUCAO !== 'undefined' && Array.isArray(ITENS_PRODUCAO)) {

      // Limpa dados do seed anterior (v1) para evitar duplicação
      this.savePecas([]);
      const opsRestantes = this.getOps().filter(o => o.cliente !== 'Estoque Interno');
      this.saveOps(opsRestantes);
      RemoteStorage.removeItem('hrn_seeded_itens_producao_v1');

      // Mapa de localização → código de operação
      const locToOp = (loc) => {
        if (!loc) return '01';
        const l = loc.toLowerCase().replace(/\r?\n/g, ' ').trim();
        if (l.includes('fundid') || l.includes('fundindo') || l.includes('produzindo fund')) return '01';
        if (l.includes('vulcaniz')) return '02';
        if (l.includes('polimento')) return '03';
        if (l.includes('estoque bruto') || l.includes('codan)')) return '03';
        if (l.includes('usinagem')) return '04';
        if (l.includes('estoque usinado')) return '04';
        if (l.includes('pintura')) return '05';
        if (l.includes('embuchamento')) return '06';
        if (l.includes('grava')) return '07';
        if (l.includes('entrada')) return '07';
        return '01';
      };

      // Mapa de código de OP → etapa da OP (Ordens de Produção)
      const opToEtapa = {
        '01': 'Injeção/Fundição',
        '02': 'Pintura/Polimento',
        '03': 'Pintura/Polimento',
        '04': 'Usinagem',
        '05': 'Pintura/Polimento',
        '06': 'Em Produção',
        '07': 'Em Produção',
      };

      // Agrupa por SKU + localização para criar OPs únicas
      const opMap = {}; // chave: sku|opCode → { id, numero }

      ITENS_PRODUCAO.forEach((item, idx) => {
        if (!item.nome || item.qty === 0) return;

        const opCode = locToOp(item.localizacao);
        const etapa  = opToEtapa[opCode] || 'Em Produção';
        const mapKey = `${item.sku}|${opCode}`;

        // Cria OP se ainda não existir para esse SKU+operação
        let opId     = opMap[mapKey]?.id;
        let opNumero = opMap[mapKey]?.numero;

        if (!opId) {
          const novaOp = this.addOp({
            modelo:     item.nome,
            qty:        item.qty,
            cliente:    'Estoque Interno',
            prazo:      '',
            etapa,
            prioridade: 'Normal',
            obs:        `Importado de itens_em_produção. Bruto: ${item.bruto}. Loc: ${item.localizacao}`,
          });
          opId     = novaOp.id;
          opNumero = novaOp.numero;
          opMap[mapKey] = { id: opId, numero: opNumero };
        }

        // Cria Peça no Rastreio vinculada à OP
        const loteNum = `${item.sku}-L${String(idx + 1).padStart(3,'0')}`;
        const list = this.getPecas();
        const peca = {
          id:            this._id(),
          numero:        loteNum,
          modelo:        item.nome,
          tipoFundicao:  item.bruto || '',
          qty:           item.qty,
          operacaoAtual: opCode,
          opId:          opId,
          opNumero:      opNumero,
          obs:           `Loc. planilha: ${item.localizacao} | Bruto: ${item.bruto}`,
          historico: [{ op: opCode, data: this._now(), obs: `Importado de itens_em_produção – ${item.localizacao}` }],
          criadoEm:      this._now(),
          atualizadoEm:  this._now(),
        };
        list.push(peca);
        this.savePecas(list);
      });

      this.addAtividade(`Itens em produção importados: ${ITENS_PRODUCAO.length} registros carregados no Rastreio de OP.`, 'teal');
      RemoteStorage.setItem('hrn_seeded_itens_producao_v2', 'true');
    }
  },
};

