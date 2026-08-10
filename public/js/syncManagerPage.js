/**
 * Central de Sincronização Geral (syncManagerPage.js)
 * Gerencia o upload único de planilhas Master Excel e distribui automaticamente
 * os dados para Análise de Produção, Programação de Fundição, Estoque de Componentes, V.I.N.I. e Rastreio de OPs.
 */

(function () {
  'use strict';

  const SYNC_LOGS_KEY = 'hrn_central_sync_logs';

  function getSyncLogs() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_LOGS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveSyncLog(logItem) {
    const logs = getSyncLogs();
    logs.unshift(logItem);
    if (logs.length > 50) logs.pop();
    try {
      localStorage.setItem(SYNC_LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
      console.warn('[SyncManager] Não foi possível persistir histórico de sync:', e);
    }
    renderSyncHistory();
  }

  function renderSyncHistory() {
    const tbody = document.getElementById('sync-history-body');
    if (!tbody) return;

    const logs = getSyncLogs();
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Nenhum histórico de sincronização registrado até o momento.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => `
      <tr>
        <td class="font-mono" style="color:var(--text-secondary);">${escapeHtml(log.date)}</td>
        <td style="font-weight:600; color:#f8fafc;">${escapeHtml(log.fileName)}</td>
        <td class="font-mono" style="color:#38bdf8;">${escapeHtml(log.sheetsProcessed || 'Master')}</td>
        <td class="font-mono" style="font-weight:700;">${log.totalRecords || 0} reg.</td>
        <td>
          <span class="chip ${log.status === 'OK' ? 'chip--green' : 'chip--red'} font-mono" style="font-weight:700;">
            ${log.status === 'OK' ? '✓ Sucesso' : '❌ Falha'}
          </span>
        </td>
      </tr>
    `).join('');
  }

  function updateCardStatus(cardId, badgeId, valId, subId, status, valText, subText) {
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
        badge.textContent = '🔄 Processando...';
      } else {
        badge.className = 'chip chip--gray';
        badge.textContent = 'Aguardando';
      }
    }

    if (val && valText !== undefined) val.textContent = valText;
    if (sub && subText !== undefined) sub.textContent = subText;
  }

  async function distributeMasterExcel(file) {
    if (!file) return;

    if (typeof showToast === 'function') {
      showToast(`Iniciando sincronização master do arquivo: ${file.name}`, 'info');
    }

    updateCardStatus('sync-card-analise', 'sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'syncing', 'Processando...', 'Lendo aba de Cobertura');
    updateCardStatus('sync-card-rastreio', 'sync-badge-rastreio', 'sync-val-rastreio', 'sync-sub-rastreio', 'syncing', 'Processando...', 'Lendo aba de Rastreio');
    updateCardStatus('sync-card-componentes', 'sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'syncing', 'Processando...', 'Lendo saldos de estoque');
    updateCardStatus('sync-card-vini', 'sync-badge-vini', 'sync-val-vini', 'sync-sub-vini', 'syncing', 'Processando...', 'Lendo planejamento VINI');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetNames = wb.SheetNames.map(s => s.trim());

      let totalRecordsCount = 0;
      const processedSheets = [];

      // 1. Análise de Produção & Fundição (3-Cobertura ou similar)
      let analiseCount = 0;
      try {
        if (typeof processAnaliseExcel === 'function') {
          const syncRes = await processAnaliseExcel(arrayBuffer);
          analiseCount = (syncRes && syncRes.count) || (window.ANALISE_STATE?.coberturaData?.length) || 0;
          totalRecordsCount += analiseCount;
          processedSheets.push('3-Cobertura');
          updateCardStatus('sync-card-analise', 'sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'success', `${analiseCount} itens`, 'Análise e Fundição atualizadas');
        }
      } catch (err) {
        console.warn('[SyncCentral] Análise de Produção não sincronizada:', err.message);
        updateCardStatus('sync-card-analise', 'sync-badge-analise', 'sync-val-analise', 'sync-sub-analise', 'error', 'Pendente', err.message);
      }

      // 2. Rastreio de OPs
      try {
        if (typeof syncRastreioPecas === 'function') {
          const rastreioRes = syncRastreioPecas(wb);
          const rastreioCount = (rastreioRes && (rastreioRes.movidas + rastreioRes.criadas)) || 0;
          totalRecordsCount += rastreioCount;
          processedSheets.push('Rastreio');
          updateCardStatus('sync-card-rastreio', 'sync-badge-rastreio', 'sync-val-rastreio', 'sync-sub-rastreio', 'success', `${rastreioCount || 'OK'} peças`, 'Etapas e OPs sincronizadas');
        }
      } catch (err) {
        console.warn('[SyncCentral] Rastreio OPs não sincronizado:', err.message);
        updateCardStatus('sync-card-rastreio', 'sync-badge-rastreio', 'sync-val-rastreio', 'sync-sub-rastreio', 'error', 'Pendente', err.message);
      }

      // 3. Componentes & Buchas (Estoque Arvore)
      try {
        if (typeof earv_processPCPExcel === 'function') {
          const earvRes = earv_processPCPExcel(arrayBuffer);
          const compCount = (earvRes && earvRes.estoque) || 0;
          totalRecordsCount += compCount;
          processedSheets.push('Componentes');

          // Tenta também estrutura/árvore se houver
          if (typeof earv_processTreeExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('arvore') || s.toLowerCase().includes('estrutura'))) {
            earv_processTreeExcel(arrayBuffer);
            processedSheets.push('Árvore Estrutura');
          }

          updateCardStatus('sync-card-componentes', 'sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'success', `${compCount} SKUs`, 'Estoque e Saídas atualizados');
        }
      } catch (err) {
        console.warn('[SyncCentral] Componentes não sincronizado:', err.message);
        updateCardStatus('sync-card-componentes', 'sync-badge-componentes', 'sync-val-componentes', 'sync-sub-componentes', 'error', 'Pendente', err.message);
      }

      // 4. Planejamento V.I.N.I.
      try {
        let viniUpdated = false;
        if (typeof processFornecedoresExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('forneced'))) {
          processFornecedoresExcel(arrayBuffer);
          viniUpdated = true;
          processedSheets.push('Fornecedores');
        }
        if (typeof processFabriExcel === 'function' && sheetNames.some(s => s.toLowerCase().includes('fabri'))) {
          processFabriExcel(arrayBuffer);
          viniUpdated = true;
          processedSheets.push('Fabricação');
        }

        if (viniUpdated) {
          updateCardStatus('sync-card-vini', 'sync-badge-vini', 'sync-val-vini', 'sync-sub-vini', 'success', 'Atualizado', 'V.I.N.I e Fornecedores vinculados');
        } else {
          updateCardStatus('sync-card-vini', 'sync-badge-vini', 'sync-val-vini', 'sync-sub-vini', 'success', 'Inalterado', 'Mantido estado atual');
        }
      } catch (err) {
        console.warn('[SyncCentral] VINI não sincronizado:', err.message);
        updateCardStatus('sync-card-vini', 'sync-badge-vini', 'sync-val-vini', 'sync-sub-vini', 'error', 'Pendente', err.message);
      }

      // Dispara atualizações da UI em todas as abas
      if (typeof window.renderAnaliseTable === 'function') window.renderAnaliseTable();
      if (typeof window.renderProgramacaoFundicao === 'function') window.renderProgramacaoFundicao();
      if (typeof window.renderViniTable === 'function') window.renderViniTable();

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      saveSyncLog({
        date: dateStr,
        fileName: file.name,
        sheetsProcessed: processedSheets.join(', ') || 'Planilha Master',
        totalRecords: totalRecordsCount,
        status: 'OK'
      });

      if (typeof showToast === 'function') {
        showToast(`Sincronização Master concluída com sucesso! (${totalRecordsCount} registros distribuídos)`, 'success');
      }
    } catch (err) {
      console.error('[SyncCentral] Erro crítico ao processar planilha master:', err);
      if (typeof showToast === 'function') {
        showToast(`Falha na sincronização: ${err.message}`, 'error');
      }

      const now = new Date();
      const dateStr = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      saveSyncLog({
        date: dateStr,
        fileName: file.name,
        sheetsProcessed: 'Nenhuma',
        totalRecords: 0,
        status: 'ERROR'
      });
    }
  }

  function initSyncManagerPage() {
    const dropzone = document.getElementById('sync-dropzone');
    const fileInput = document.getElementById('sync-master-file-input');
    const btnSelect = document.getElementById('btn-select-sync-file');

    if (btnSelect && fileInput) {
      btnSelect.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          distributeMasterExcel(file);
          fileInput.value = '';
        }
      });
    }

    if (dropzone) {
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

    renderSyncHistory();
  }

  window.distributeMasterExcel = distributeMasterExcel;
  window.initSyncManagerPage = initSyncManagerPage;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSyncManagerPage);
  } else {
    initSyncManagerPage();
  }
})();
