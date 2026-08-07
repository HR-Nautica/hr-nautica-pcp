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

