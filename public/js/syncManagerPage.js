/**
 * Central de Sincronização (syncManagerPage.js)
 * Gerencia as abas "Sincronizar Estoque" e "Sincronizar Saídas (V.I.N.I.)".
 */

(function () {
  'use strict';

  const LAST_STOCK_SYNC_KEY = 'hrn_last_master_sync';
  const LAST_VINI_SYNC_KEY = 'hrn_last_vini_sync';

  let isStockSyncing = false;
  let isViniSyncing = false;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════
  // 1. SINCRONIZAR ESTOQUE
  // ═══════════════════════════════════════════
  function getLastStockSyncLog() {
    try {
      const raw = localStorage.getItem(LAST_STOCK_SYNC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLastStockSyncLog(logItem) {
    try {
      localStorage.setItem(LAST_STOCK_SYNC_KEY, JSON.stringify(logItem));
    } catch (e) {
      console.warn('[SyncManager] Erro ao salvar log de estoque:', e);
    }
    renderStockSyncHistory();
  }

  function renderStockSyncHistory() {
    const tbody = document.getElementById('sync-history-body');
    if (!tbody) return;

    const lastLog = getLastStockSyncLog();
    if (!lastLog) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhuma sincronização de estoque realizada até o momento.</td></tr>';
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td class="font-mono" style="color:#94a3b8; font-weight:600;">${escapeHtml(lastLog.date)}</td>
        <td style="font-weight:700; color:#f8fafc;">${escapeHtml(lastLog.fileName)}</td>
        <td>
          <span class="chip ${lastLog.analiseStatus === 'OK' ? 'chip--green' : 'chip--red'} font-mono" style="font-weight:700;">
            ${lastLog.analiseStatus === 'OK' ? `✓ ${lastLog.analiseCount || 0} itens` : '❌ Falha'}
          </span>
        </td>
        <td>
          <span class="chip ${lastLog.compStatus === 'OK' ? 'chip--green' : 'chip--red'} font-mono" style="font-weight:700;">
            ${lastLog.compStatus === 'OK' ? `✓ ${lastLog.compCount || 0} SKUs` : '❌ Falha'}
          </span>
        </td>
        <td>
          <span class="chip ${lastLog.status === 'OK' ? 'chip--green' : 'chip--red'} font-mono" style="font-weight:800; font-size:0.82rem;">
            ${lastLog.status === 'OK' ? '✓ Sucesso' : '❌ Falha'}
          </span>
        </td>
      </tr>
    `;
  }

  function updateCardStatus(badgeId, valId, subId, status, valText, subText) {
    const badge = document.getElementById(badgeId);
    const val = document.getElementById(valId);
    const sub = document.getElementById(subId);

    if (badge) {
      if (status === 'success') {
        badge.className = 'chip chip--green';
        badge.textContent = '✓ Sincronizado';
      } else if (status === 'error') {
        badge.className = 'chip chip--red';
        badge.textContent = '❌ Erro';
      } else if (status === 'syncing') {
        badge.className = 'chip chip--blue';
        badge.textContent = '🔄 Sincronizando...';
      } else {
        badge.className = 'chip chip--gray';
        badge.textContent = 'Aguardando';
      }
    }

    if (val && valText !== undefined) val.textContent = valText;
    if (sub && subText !== undefined) sub.textContent = subText;
  }

  async function distributeMasterExcel(file) {
    if (!file || isStockSyncing) return;
    isStockSyncing = true;

    if (typeof showToast === 'function') {
      showToast(`Sincronizando estoques a partir de: ${file.name}`, 'info');
    }

    updateCardStatus('sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'syncing', 'Reescrevendo...', 'Atualizando saldos de hélices');
    updateCardStatus('sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'syncing', 'Reescrevendo...', 'Atualizando saldos de componentes');

    let analiseCount = 0;
    let analiseStatus = 'ERROR';
    let compCount = 0;
    let compStatus = 'ERROR';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetNames = wb.SheetNames.map(s => s.trim());

      // 1. Análise de Produção Hélices
      try {
        if (typeof processAnaliseExcel === 'function') {
          const syncRes = await processAnaliseExcel(arrayBuffer);
          analiseCount = (syncRes && syncRes.count) || (window.ANALISE_STATE?.coberturaData?.length) || 0;
          analiseStatus = 'OK';
          updateCardStatus('sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'success', `${analiseCount} itens`, 'Estoques usinado/bruto reescritos com sucesso');
        }
      } catch (err) {
        console.warn('[SyncCentral] Erro na Análise de Produção:', err.message);
        updateCardStatus('sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'error', 'Pendente', err.message);
      }

      // 2. Estoque Componentes (Estoque Árvore / PCP)
      try {
        if (typeof earv_processPCPExcel === 'function') {
          const earvRes = earv_processPCPExcel(arrayBuffer);
          compCount = (earvRes && earvRes.estoque) || 0;
          compStatus = 'OK';

          if (typeof earv_processTreeExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('arvore') || s.toLowerCase().includes('estrutura'))) {
            earv_processTreeExcel(arrayBuffer);
          }

          updateCardStatus('sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'success', `${compCount} SKUs`, 'Estoques e saídas previstas reescritas');
        }
      } catch (err) {
        console.warn('[SyncCentral] Erro em Estoque Componentes:', err.message);
        updateCardStatus('sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'error', 'Pendente', err.message);
      }

      // Dispara atualizações da UI em todas as abas afetadas
      if (typeof window.renderAnaliseTable === 'function') window.renderAnaliseTable();
      if (typeof window.renderProgramacaoFundicao === 'function') window.renderProgramacaoFundicao();
      if (typeof window.earv_renderTable === 'function') window.earv_renderTable();

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      const overallStatus = (analiseStatus === 'OK' || compStatus === 'OK') ? 'OK' : 'ERROR';

      saveLastStockSyncLog({
        date: dateStr,
        fileName: file.name,
        analiseCount,
        analiseStatus,
        compCount,
        compStatus,
        status: overallStatus
      });

      if (typeof showToast === 'function') {
        showToast(`Estoques sincronizados e reescritos com sucesso!`, 'success');
      }
    } catch (err) {
      console.error('[SyncCentral] Erro crítico ao processar planilha de estoque:', err);
      if (typeof showToast === 'function') {
        showToast(`Falha na sincronização: ${err.message}`, 'error');
      }

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      saveLastStockSyncLog({
        date: dateStr,
        fileName: file.name,
        analiseCount: 0,
        analiseStatus: 'ERROR',
        compCount: 0,
        compStatus: 'ERROR',
        status: 'ERROR'
      });
    } finally {
      isStockSyncing = false;
    }
  }

  function initSyncManagerPage() {
    const dropzone = document.getElementById('sync-dropzone');
    const fileInput = document.getElementById('sync-master-file-input');
    const btnSelect = document.getElementById('btn-select-sync-file');

    if (btnSelect && fileInput && !fileInput.dataset.syncBound) {
      fileInput.dataset.syncBound = 'true';
      btnSelect.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          distributeMasterExcel(file);
          fileInput.value = '';
        }
      });
    }

    if (dropzone && !dropzone.dataset.syncBound) {
      dropzone.dataset.syncBound = 'true';
      ['dragenter', 'dragover'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = '#38bdf8';
          dropzone.style.background = 'linear-gradient(135deg, rgba(56,189,248,0.15) 0%, rgba(15,23,42,0.98) 100%)';
        });
      });

      ['dragleave', 'drop'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = 'rgba(56,189,248,0.4)';
          dropzone.style.background = 'linear-gradient(135deg, rgba(30,41,59,0.8) 0%, rgba(15,23,42,0.95) 100%)';
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const file = dt && dt.files && dt.files[0];
        if (file) {
          distributeMasterExcel(file);
        }
      });
    }

    renderStockSyncHistory();
  }

  // ═══════════════════════════════════════════
  // 2. SINCRONIZAR SAÍDAS (V.I.N.I.)
  // ═══════════════════════════════════════════
  function getLastViniSyncLog() {
    try {
      const raw = localStorage.getItem(LAST_VINI_SYNC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLastViniSyncLog(logItem) {
    try {
      localStorage.setItem(LAST_VINI_SYNC_KEY, JSON.stringify(logItem));
    } catch (e) {
      console.warn('[SyncVini] Erro ao salvar log de saídas:', e);
    }
    renderViniSyncHistory();
  }

  function renderViniSyncHistory() {
    const tbody = document.getElementById('sync-vini-history-body');
    if (!tbody) return;

    const lastLog = getLastViniSyncLog();
    if (!lastLog) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Nenhuma sincronização de saídas realizada até o momento.</td></tr>';
      return;
    }

    tbody.innerHTML = `
      <tr>
        <td class="font-mono" style="color:#94a3b8; font-weight:600;">${escapeHtml(lastLog.date)}</td>
        <td style="font-weight:700; color:#f8fafc;">${escapeHtml(lastLog.fileName)}</td>
        <td>
          <span class="chip ${lastLog.viniStatus === 'OK' ? 'chip--purple' : 'chip--red'} font-mono" style="font-weight:700;">
            ${lastLog.viniStatus === 'OK' ? `✓ Atualizado (${lastLog.viniSheets || 'Saídas / Fornecedores'})` : '❌ Falha'}
          </span>
        </td>
        <td>
          <span class="chip ${lastLog.status === 'OK' ? 'chip--green' : 'chip--red'} font-mono" style="font-weight:800; font-size:0.82rem;">
            ${lastLog.status === 'OK' ? '✓ Sucesso' : '❌ Falha'}
          </span>
        </td>
      </tr>
    `;
  }

  async function distributeViniSaidasExcel(file) {
    if (!file || isViniSyncing) return;
    isViniSyncing = true;

    if (typeof showToast === 'function') {
      showToast(`Sincronizando saídas V.I.N.I. a partir de: ${file.name}`, 'info');
    }

    updateCardStatus('sync-vini-badge', 'sync-vini-val', 'sync-vini-sub', 'syncing', 'Processando...', 'Lendo fornecedores e matriz de fabricação');

    let viniSheets = [];
    let viniStatus = 'ERROR';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetNames = wb.SheetNames.map(s => s.trim());

      let updated = false;
      let viniCount = 0;

      // 1. Necessidades PCP / Saídas V.I.N.I.
      const viniProc = window.processExcelWorkbook || (typeof processExcelWorkbook === 'function' ? processExcelWorkbook : null);
      if (viniProc) {
        viniProc(arrayBuffer);
        updated = true;
        viniSheets.push('Necessidades / Saídas');
        viniCount = window.VINI_STATE?.necessidadeData?.length || 0;
      }

      // 2. Fornecedores
      if (typeof processFornecedoresExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('forneced'))) {
        processFornecedoresExcel(arrayBuffer);
        updated = true;
        viniSheets.push('Fornecedores');
      }

      // 3. Fabricação
      if (typeof processFabriExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('fabri'))) {
        processFabriExcel(arrayBuffer);
        updated = true;
        viniSheets.push('Fabricação');
      }

      // 4. Saídas previstas em Componentes
      if (typeof earv_processSaidasPrevistasExcel === 'function') {
        earv_processSaidasPrevistasExcel(arrayBuffer);
        updated = true;
        viniSheets.push('Saídas Previstas');
      }

      viniStatus = updated ? 'OK' : 'OK';
      const sheetSummary = viniSheets.length ? viniSheets.join(', ') : 'Planilha de Saídas V.I.N.I.';
      const displayVal = viniCount > 0 ? `${viniCount} itens` : 'Atualizado';

      updateCardStatus('sync-vini-badge', 'sync-vini-val', 'sync-vini-sub', 'success', displayVal, `${sheetSummary} integradas com sucesso`);

      if (typeof window.renderViniTable === 'function') window.renderViniTable();

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      saveLastViniSyncLog({
        date: dateStr,
        fileName: file.name,
        viniSheets: sheetSummary,
        viniStatus: 'OK',
        status: 'OK'
      });

      if (typeof showToast === 'function') {
        showToast(`Saídas V.I.N.I. sincronizadas com sucesso!`, 'success');
      }
    } catch (err) {
      console.error('[SyncVini] Erro crítico ao processar saídas V.I.N.I.:', err);
      if (typeof showToast === 'function') {
        showToast(`Falha na sincronização de saídas: ${err.message}`, 'error');
      }

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      saveLastViniSyncLog({
        date: dateStr,
        fileName: file.name,
        viniSheets: 'Nenhuma',
        viniStatus: 'ERROR',
        status: 'ERROR'
      });

      updateCardStatus('sync-vini-badge', 'sync-vini-val', 'sync-vini-sub', 'error', 'Pendente', err.message);
    } finally {
      isViniSyncing = false;
    }
  }

  function initSyncViniPage() {
    const dropzone = document.getElementById('sync-vini-dropzone');
    const fileInput = document.getElementById('sync-vini-file-input');
    const btnSelect = document.getElementById('btn-select-sync-vini-file');

    if (btnSelect && fileInput && !fileInput.dataset.syncBound) {
      fileInput.dataset.syncBound = 'true';
      btnSelect.addEventListener('click', (e) => {
        e.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          distributeViniSaidasExcel(file);
          fileInput.value = '';
        }
      });
    }

    if (dropzone && !dropzone.dataset.syncBound) {
      dropzone.dataset.syncBound = 'true';
      ['dragenter', 'dragover'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = '#c084fc';
          dropzone.style.background = 'linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(15,23,42,0.98) 100%)';
        });
      });

      ['dragleave', 'drop'].forEach(evtName => {
        dropzone.addEventListener(evtName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.style.borderColor = 'rgba(168,85,247,0.4)';
          dropzone.style.background = 'linear-gradient(135deg, rgba(30,41,59,0.8) 0%, rgba(15,23,42,0.95) 100%)';
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const file = dt && dt.files && dt.files[0];
        if (file) {
          distributeViniSaidasExcel(file);
        }
      });
    }

    renderViniSyncHistory();
  }

  window.distributeMasterExcel = distributeMasterExcel;
  window.distributeViniSaidasExcel = distributeViniSaidasExcel;
  window.initSyncManagerPage = initSyncManagerPage;
  window.initSyncViniPage = initSyncViniPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initSyncManagerPage();
      initSyncViniPage();
    });
  } else {
    initSyncManagerPage();
    initSyncViniPage();
  }
})();
