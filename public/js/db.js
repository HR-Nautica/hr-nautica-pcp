/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   db.js â€“ Camada de dados (RemoteStorage)
   HR NÃ¡utica PCP
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const DB = {

  // â”€â”€â”€ Keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  },

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â•â•â• ORDENS DE PRODUÃ‡ÃƒO â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  getOps()         { return this._get(this.KEYS.ops); },
  saveOps(list)    { this._set(this.KEYS.ops, list); },

  // â”€â”€â”€ Helpers para Insumos / Consumo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        tipo: 'SaÃ­da',
        qty: qty,
        opId: opId,
        opNumero: opNumero,
        obs: `Consumo automÃ¡tico (OP ${opNumero} concluÃ­da)`
      });
    }

    if (reqs.caixa) {
      this.addMovimento({
        materialId: reqs.caixa.materialId,
        materialNome: reqs.caixa.nome,
        tipo: 'SaÃ­da',
        qty: qty,
        opId: opId,
        opNumero: opNumero,
        obs: `Consumo automÃ¡tico (OP ${opNumero} concluÃ­da)`
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
    this.addAtividade(`Nova OP criada: ${op.numero} â€“ ${op.modelo}`, 'blue');
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

  // â•â•â• MODELOS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  getModelos()      { return this._get(this.KEYS.modelos); },
  saveModelos(list) { this._set(this.KEYS.modelos, list); },

  addModelo(data) {
    const modelos = this.getModelos();
    const m = {
      id:            this._id(),
      nome:          data.nome          || '',
      pas:           data.pas           || '3',
      material:      data.material      || 'AlumÃ­nio',
      diametro:      data.diametro      || '',
      passo:         data.passo         || '',
      peso:          data.peso          || '',
      desc:          data.desc          || '',
      
      // Custom metadata fields from matrix
      sku:           data.sku           || '',
      codigoBruto:   data.codigoBruto   || '',
      gravacaoBruto: data.gravacaoBruto || '',
      tuboAnel:      data.tuboAnel      || '',
      bucha:         data.bucha         || '',
      cor:           data.cor           || '',
      estria:        data.estria        || '',
      caixa:         data.caixa         || '',
      skuCaixa:      data.skuCaixa      || '',
      buchaModelo:   data.buchaModelo   || '',
      
      criadoEm:      this._now(),
    };
    modelos.push(m);
    this.saveModelos(modelos);
    this.addAtividade(`Novo modelo cadastrado: ${m.nome}`, 'blue');
    return m;
  },

  updateModelo(id, data) {
    const list = this.getModelos().map(m =>
      m.id === id ? { ...m, ...data } : m
    );
    this.saveModelos(list);
    return list.find(m => m.id === id);
  },

  deleteModelo(id) {
    this.saveModelos(this.getModelos().filter(m => m.id !== id));
    this.addAtividade('Modelo de hÃ©lice removido', 'red');
  },

  // â•â•â• MATERIAIS / ESTOQUE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

  // â•â•â• MOVIMENTAÃ‡Ã•ES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    this.addAtividade(`MovimentaÃ§Ã£o: ${mov.tipo} de ${mov.qty} ${mov.materialNome}`, mov.tipo === 'Entrada' ? 'green' : 'orange');
    return mov;
  },

  // â•â•â• PEDIDOS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    this.addAtividade(`Novo pedido: ${p.numero} â€“ ${p.cliente}`, 'purple');
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

  // â•â•â• PROGRAMAÃ‡ÃƒO DE FUNDIÃ‡ÃƒO â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    this.addAtividade(`Nova programaÃ§Ã£o de fundiÃ§Ã£o: ${f.numero} â€“ ${f.modelo}`, 'orange');
    return f;
  },

  updateFundicao(id, data) {
    const list = this.getFundicoes().map(f =>
      f.id === id ? { ...f, ...data } : f
    );
    this.saveFundicoes(list);
    this.addAtividade(`Prog. fundiÃ§Ã£o ${list.find(f=>f.id===id)?.numero} atualizada`, 'teal');
    return list.find(f => f.id === id);
  },

  deleteFundicao(id) {
    const list = this.getFundicoes();
    const f = list.find(x => x.id === id);
    this.saveFundicoes(list.filter(x => x.id !== id));
    if (f) this.addAtividade(`Prog. fundiÃ§Ã£o ${f.numero} removida`, 'red');
  },

  // â•â•â• MANUTENÃ‡ÃƒO DE FERRAMENTAS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
      status:       data.status       || 'Em ManutenÃ§Ã£o',
      prioridade:   data.prioridade   || 'Normal',
      obs:          data.obs          || '',
      criadoEm:     this._now(),
      atualizadoEm: this._now(),
    };
    list.push(m);
    this.saveManutencoes(list);
    this.addAtividade(`Ferramenta interditada: ${m.numero} â€“ ${m.ferramenta}`, 'orange');
    return m;
  },

  updateManutencao(id, data) {
    const list = this.getManutencoes().map(m =>
      m.id === id ? { ...m, ...data, atualizadoEm: this._now() } : m
    );
    this.saveManutencoes(list);
    const updated = list.find(m => m.id === id);
    this.addAtividade(`ManutenÃ§Ã£o ${updated?.numero} atualizada`, 'teal');
    return updated;
  },

  deleteManutencao(id) {
    const list = this.getManutencoes();
    const m = list.find(x => x.id === id);
    this.saveManutencoes(list.filter(x => x.id !== id));
    if (m) this.addAtividade(`ManutenÃ§Ã£o ${m.numero} removida`, 'red');
  },

  // â•â•â• PEÃ‡AS / RASTREIO DE OPERAÃ‡Ã•ES â•â•â•â•â•â•â•â•â•â•â•â•
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
      historico: [{ op: data.operacaoAtual || '01', data: this._now(), obs: 'Entrada na operaÃ§Ã£o' }],
      criadoEm:      this._now(),
      atualizadoEm:  this._now(),
    };
    list.push(p);
    this.savePecas(list);
    this.addAtividade(`Nova peÃ§a ${p.numero} â€“ ${p.modelo} (Op. ${p.operacaoAtual})`, 'blue');
    return p;
  },

  updatePeca(id, data) {
    let list = this.getPecas();
    list = list.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...data, atualizadoEm: this._now() };
      // Se a operaÃ§Ã£o mudou, registra no histÃ³rico
      if (data.operacaoAtual && data.operacaoAtual !== p.operacaoAtual) {
        updated.historico = [...(p.historico || []), {
          op: data.operacaoAtual,
          data: this._now(),
          obs: data.obsMovimento || 'Movido para operaÃ§Ã£o',
        }];
        this.addAtividade(`PeÃ§a ${p.numero} movida para Op. ${data.operacaoAtual}`, 'teal');
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
    if (p) this.addAtividade(`PeÃ§a ${p.numero} removida`, 'red');
  },

  // â•â•â• ATIVIDADES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  getAtividades()      { return this._get(this.KEYS.atividades); },
  saveAtividades(list) { this._set(this.KEYS.atividades, list); },

  addAtividade(titulo, cor = 'blue') {
    const list = this.getAtividades();
    list.unshift({ id: this._id(), titulo, cor, data: this._now() });
    // mantÃ©m apenas 50 Ãºltimas
    this.saveAtividades(list.slice(0, 50));
  },

  // â”€â”€â”€ Seed Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  seed() {
    // One-time cleanup to ensure all mock/fake data is removed from RemoteStorage
    if (!RemoteStorage.getItem('hrn_cleaned_mock_data_v3')) {
      Object.values(this.KEYS).forEach(k => RemoteStorage.removeItem(k));
      RemoteStorage.setItem('hrn_cleaned_mock_data_v3', 'true');
    }

    // Auto-seed models from MATRIZ_DATA if models database is empty
    const modelos = this.getModelos();
    if (modelos.length === 0 && typeof MATRIZ_DATA !== 'undefined' && Array.isArray(MATRIZ_DATA)) {
      MATRIZ_DATA.forEach(m => {
        this.addModelo(m);
      });
      this.addAtividade(`Matriz importada automaticamente: ${MATRIZ_DATA.length} modelos de hÃ©lices.`, 'green');
    }

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
      // 1. Tubo AlumÃ­nio
      if (m.tuboAnel && m.tuboAnel !== 'N/A' && m.tuboAnel !== 'N/T') {
        const tuboNome = `Tubo AlumÃ­nio ${m.tuboAnel}`;
        if (!materialNomes.has(tuboNome.toLowerCase())) {
          this.addMaterial({ nome: tuboNome, unidade: 'barras', saldo: 0, minimo: 5, fornecedor: 'Fornecedor de Tubos' });
          materialNomes.add(tuboNome.toLowerCase());
        }
      }
      // 2. LatÃ£o Bucha / Redondo
      if (m.bucha && m.bucha !== 'N/A') {
        const buchaMatNome = `LatÃ£o Redondo ${m.bucha.split(' x ')[0]}`;
        if (!materialNomes.has(buchaMatNome.toLowerCase())) {
          this.addMaterial({ nome: buchaMatNome, unidade: 'kg', saldo: 0, minimo: 10, fornecedor: 'Fornecedor de Metais' });
          materialNomes.add(buchaMatNome.toLowerCase());
        }
      }
      // 3. Modelo Caixa
      if (m.caixa && m.caixa !== 'N/A') {
        const caixaNome = m.caixa;
        if (!materialNomes.has(caixaNome.toLowerCase())) {
          this.addMaterial({ nome: caixaNome, unidade: 'peÃ§as', saldo: 0, minimo: 20, fornecedor: 'Fornecedor de Embalagens' });
          materialNomes.add(caixaNome.toLowerCase());
        }
      }
      // 4. Bucha Pronta (Usinada)
      if (m.buchaModelo && m.buchaModelo !== 'N/A') {
        const buchaProntaNome = m.buchaModelo;
        if (!materialNomes.has(buchaProntaNome.toLowerCase())) {
          this.addMaterial({ nome: buchaProntaNome, unidade: 'peÃ§as', saldo: 0, minimo: 10, fornecedor: 'FabricaÃ§Ã£o Interna / Estoque' });
          materialNomes.add(buchaProntaNome.toLowerCase());
        }
      }
    });

    // â”€â”€ Seed Itens em ProduÃ§Ã£o (Rastreio de OP + OPs vinculadas) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (!RemoteStorage.getItem('hrn_seeded_itens_producao_v2') &&
        typeof ITENS_PRODUCAO !== 'undefined' && Array.isArray(ITENS_PRODUCAO)) {

      // Limpa dados do seed anterior (v1) para evitar duplicaÃ§Ã£o
      this.savePecas([]);
      const opsRestantes = this.getOps().filter(o => o.cliente !== 'Estoque Interno');
      this.saveOps(opsRestantes);
      RemoteStorage.removeItem('hrn_seeded_itens_producao_v1');

      // Mapa de localizaÃ§Ã£o â†’ cÃ³digo de operaÃ§Ã£o
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

      // Mapa de cÃ³digo de OP â†’ etapa da OP (Ordens de ProduÃ§Ã£o)
      const opToEtapa = {
        '01': 'InjeÃ§Ã£o/FundiÃ§Ã£o',
        '02': 'Pintura/Polimento',
        '03': 'Pintura/Polimento',
        '04': 'Usinagem',
        '05': 'Pintura/Polimento',
        '06': 'Em ProduÃ§Ã£o',
        '07': 'Em ProduÃ§Ã£o',
      };

      // Agrupa por SKU + localizaÃ§Ã£o para criar OPs Ãºnicas
      const opMap = {}; // chave: sku|opCode â†’ { id, numero }

      ITENS_PRODUCAO.forEach((item, idx) => {
        if (!item.nome || item.qty === 0) return;

        const opCode = locToOp(item.localizacao);
        const etapa  = opToEtapa[opCode] || 'Em ProduÃ§Ã£o';
        const mapKey = `${item.sku}|${opCode}`;

        // Cria OP se ainda nÃ£o existir para esse SKU+operaÃ§Ã£o
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
            obs:        `Importado de itens_em_produÃ§Ã£o. Bruto: ${item.bruto}. Loc: ${item.localizacao}`,
          });
          opId     = novaOp.id;
          opNumero = novaOp.numero;
          opMap[mapKey] = { id: opId, numero: opNumero };
        }

        // Cria PeÃ§a no Rastreio vinculada Ã  OP
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
          historico: [{ op: opCode, data: this._now(), obs: `Importado de itens_em_produÃ§Ã£o â€“ ${item.localizacao}` }],
          criadoEm:      this._now(),
          atualizadoEm:  this._now(),
        };
        list.push(peca);
        this.savePecas(list);
      });

      this.addAtividade(`Itens em produÃ§Ã£o importados: ${ITENS_PRODUCAO.length} registros carregados no Rastreio de OP.`, 'teal');
      RemoteStorage.setItem('hrn_seeded_itens_producao_v2', 'true');
    }
  },
};

