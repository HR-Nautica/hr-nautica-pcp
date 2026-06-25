/**
 * ═══════════════════════════════════════════════════════════════
 *  tinyApi.js — Módulo de integração com o servidor proxy local
 *
 *  Como funciona:
 *  - Aço carregar, testa se o servidor local está ativo em localhost:3001
 *  - Se estiver ativo: usa a API Tiny (dados em tempo real)
 *  - Se não estiver: sistema continua funcionando normalmente
 *    com as planilhas sincronizadas manualmente (comportamento atual)
 *
 *  Não é necessário alterar este arquivo para ativar a integração.
 *  Basta rodar "node server.js" na pasta do projeto.
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const TINY_PROXY_BASE = 'http://localhost:3001';

// Estado da integração
const TinyAPI = {
  disponivel:       false,   // true quando o servidor proxy está rodando
  tokenConfigurado: false,   // true quando o token Tiny está definido no .env
  ultimaVerificacao: null,
  ultimoErro:        null,
};

// ─── Verificação de disponibilidade ───────────────────────────────────────────

/**
 * Testa se o servidor proxy local está rodando.
 * Chamado automaticamente ao iniciar o sistema.
 * @returns {Promise<boolean>}
 */
async function verificarServidorProxy() {
  try {
    const res = await fetch(`${TINY_PROXY_BASE}/api/status`, {
      method:  'GET',
      headers: { 'Accept': 'application/json' },
      // Timeout curto — se o servidor não responder em 1s, não está ativo
      signal:  AbortSignal.timeout(1500),
    });

    if (!res.ok) {
      TinyAPI.disponivel = false;
      return false;
    }

    const data = await res.json();
    TinyAPI.disponivel       = true;
    TinyAPI.tokenConfigurado = data.tokenConfigurado || false;
    TinyAPI.ultimaVerificacao = new Date();
    TinyAPI.ultimoErro        = null;

    console.log(`[TinyAPI] Servidor proxy ativo. Token: ${TinyAPI.tokenConfigurado ? 'âœ… configurado' : 'âš ï¸ não configurado'}`);
    return true;

  } catch (err) {
    // Servidor não está rodando — comportamento normal, sem erro visível
    TinyAPI.disponivel  = false;
    TinyAPI.ultimoErro  = err.message;
    console.info('[TinyAPI] Servidor proxy não detectado. Usando modo offline (planilhas manuais).');
    return false;
  }
}

// ─── Funções de busca de dados ─────────────────────────────────────────────────

/**
 * Busca o estoque físico atual de todos os produtos via API Tiny.
 * Retorna um mapa { SKU: estoqueAtual } para substituir os dados da planilha.
 * @returns {Promise<Object>}  ex: { 'HR CNS 007': 42, 'UN2131': 8 }
 */
async function buscarEstoqueTiny() {
  if (!TinyAPI.disponivel) return null;

  try {
    const res  = await fetch(`${TINY_PROXY_BASE}/api/produtos/estoque`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');
    if (data.mock) {
      console.info('[TinyAPI] Retornando dados de exemplo. Configure o token para dados reais.');
    }

    // Converte para mapa SKU → estoque
    const estoqueMap = {};
    (data.produtos || []).forEach(p => {
      estoqueMap[p.sku.trim().toUpperCase()] = p.estoqueFisico;
    });

    console.log(`[TinyAPI] Estoque carregado: ${Object.keys(estoqueMap).length} produtos`);
    return estoqueMap;

  } catch (err) {
    console.error('[TinyAPI] Erro ao buscar estoque:', err.message);
    return null;
  }
}

/**
 * Busca ordens de compra em aberto (entradas previstas) via API Tiny.
 * @returns {Promise<Array>}
 */
async function buscarEntradasPrevistas() {
  if (!TinyAPI.disponivel) return null;

  try {
    const res  = await fetch(`${TINY_PROXY_BASE}/api/produtos/entradas-previstas`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');

    console.log(`[TinyAPI] Entradas previstas: ${data.total} registros`);
    return data.entradas || [];

  } catch (err) {
    console.error('[TinyAPI] Erro ao buscar entradas previstas:', err.message);
    return null;
  }
}

/**
 * Busca saídas do período (últimos N dias) para cálculo de média mensal.
 * @param {number} dias  Número de dias retroativos (padrão: 90)
 * @returns {Promise<Array>}
 */
async function buscarSaidasPeriodo(dias = 90) {
  if (!TinyAPI.disponivel) return null;

  try {
    const res  = await fetch(`${TINY_PROXY_BASE}/api/produtos/saidas?dias=${dias}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');

    console.log(`[TinyAPI] Saídas: ${data.total} notas fiscais dos últimos ${dias} dias`);
    return data.notas || [];

  } catch (err) {
    console.error('[TinyAPI] Erro ao buscar saídas:', err.message);
    return null;
  }
}

// ─── Sincronização automática com o VINI_STATE ────────────────────────────────

/**
 * Se o servidor proxy estiver ativo e com token configurado,
 * atualiza os dados de estoque do VINI_STATE com dados em tempo real do Tiny.
 *
 * Chamada futura: integrar ao botão "Sync PCP" ou a um timer automático.
 * Por enquanto é apenas um stub — não quebra nada se o servidor não estiver ativo.
 *
 * @returns {Promise<{atualizado: boolean, mensagem: string}>}
 */
async function sincronizarComTiny(skus = []) {
  const servidorAtivo = await verificarServidorProxy();

  if (!servidorAtivo) {
    return {
      ok: false,
      mensagem:   'Servidor proxy local (server.js) não está ativo na porta 3001.'
    };
  }

  if (!TinyAPI.tokenConfigurado) {
    return {
      ok: false,
      mensagem:   'Token Tiny não configurado no arquivo .env.'
    };
  }

  try {
    const res = await fetch(`${TINY_PROXY_BASE}/api/vini/sincronizar`, {
      method: 'POST',
      headers: { 
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ skus })
    });
    
    if (!res.ok) {
      throw new Error(`Servidor retornou erro ${res.status}`);
    }
    
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.erro || 'Erro ao sincronizar dados no Tiny');
    }
    
    return {
      ok: true,
      status: data.status,
      progresso: data.progresso,
      mensagem: 'Sincronização iniciada com sucesso!'
    };
  } catch (err) {
    console.error('[TinyAPI] Falha ao sincronizar com Tiny:', err.message);
    return {
      ok: false,
      mensagem: `Falha na conexão: ${err.message}`
    };
  }
}

/**
 * Consulta o status atual do processo de sincronização em background.
 * @returns {Promise<Object>}
 */
async function obterStatusSincronizacao() {
  if (!TinyAPI.disponivel) return null;
  try {
    const res = await fetch(`${TINY_PROXY_BASE}/api/vini/status`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!res.ok) {
      throw new Error(`Servidor retornou erro ${res.status}`);
    }
    
    return await res.json();
  } catch (err) {
    console.error('[TinyAPI] Erro ao obter status da sincronização:', err.message);
    return null;
  }
}

// ─── Inicialização ─────────────────────────────────────────────────────────────

// Verifica automaticamente ao carregar o script (não bloqueia nada)
verificarServidorProxy().then(ativo => {
  if (ativo && typeof window !== 'undefined') {
    // Aqui pode-se exibir um indicador visual no sistema de que a API está ativa
    // (implementar no index.html quando necessário)
    document.dispatchEvent(new CustomEvent('tinyapi:disponivel', {
      detail: { tokenConfigurado: TinyAPI.tokenConfigurado }
    }));
  }
});

// Exporta para uso em outros módulos
if (typeof module !== 'undefined') {
  module.exports = { TinyAPI, verificarServidorProxy, buscarEstoqueTiny, buscarEntradasPrevistas, buscarSaidasPeriodo, sincronizarComTiny, obterStatusSincronizacao };
}

