/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *  tinyApi.js â€” MÃ³dulo de integraÃ§Ã£o com o servidor proxy local
 *
 *  Como funciona:
 *  - Ao carregar, testa se o servidor local estÃ¡ ativo em localhost:3001
 *  - Se estiver ativo: usa a API Tiny (dados em tempo real)
 *  - Se nÃ£o estiver: sistema continua funcionando normalmente
 *    com as planilhas sincronizadas manualmente (comportamento atual)
 *
 *  NÃ£o Ã© necessÃ¡rio alterar este arquivo para ativar a integraÃ§Ã£o.
 *  Basta rodar "node server.js" na pasta do projeto.
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

'use strict';

const TINY_PROXY_BASE = 'http://localhost:3001';

// Estado da integraÃ§Ã£o
const TinyAPI = {
  disponivel:       false,   // true quando o servidor proxy estÃ¡ rodando
  tokenConfigurado: false,   // true quando o token Tiny estÃ¡ definido no .env
  ultimaVerificacao: null,
  ultimoErro:        null,
};

// â”€â”€â”€ VerificaÃ§Ã£o de disponibilidade â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Testa se o servidor proxy local estÃ¡ rodando.
 * Chamado automaticamente ao iniciar o sistema.
 * @returns {Promise<boolean>}
 */
async function verificarServidorProxy() {
  try {
    const res = await fetch(`${TINY_PROXY_BASE}/api/status`, {
      method:  'GET',
      headers: { 'Accept': 'application/json' },
      // Timeout curto â€” se o servidor nÃ£o responder em 1s, nÃ£o estÃ¡ ativo
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

    console.log(`[TinyAPI] Servidor proxy ativo. Token: ${TinyAPI.tokenConfigurado ? 'âœ… configurado' : 'âš ï¸ nÃ£o configurado'}`);
    return true;

  } catch (err) {
    // Servidor nÃ£o estÃ¡ rodando â€” comportamento normal, sem erro visÃ­vel
    TinyAPI.disponivel  = false;
    TinyAPI.ultimoErro  = err.message;
    console.info('[TinyAPI] Servidor proxy nÃ£o detectado. Usando modo offline (planilhas manuais).');
    return false;
  }
}

// â”€â”€â”€ FunÃ§Ãµes de busca de dados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Busca o estoque fÃ­sico atual de todos os produtos via API Tiny.
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

    // Converte para mapa SKU â†’ estoque
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
 * Busca saÃ­das do perÃ­odo (Ãºltimos N dias) para cÃ¡lculo de mÃ©dia mensal.
 * @param {number} dias  NÃºmero de dias retroativos (padrÃ£o: 90)
 * @returns {Promise<Array>}
 */
async function buscarSaidasPeriodo(dias = 90) {
  if (!TinyAPI.disponivel) return null;

  try {
    const res  = await fetch(`${TINY_PROXY_BASE}/api/produtos/saidas?dias=${dias}`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.erro || 'Erro desconhecido');

    console.log(`[TinyAPI] SaÃ­das: ${data.total} notas fiscais dos Ãºltimos ${dias} dias`);
    return data.notas || [];

  } catch (err) {
    console.error('[TinyAPI] Erro ao buscar saÃ­das:', err.message);
    return null;
  }
}

// â”€â”€â”€ SincronizaÃ§Ã£o automÃ¡tica com o VINI_STATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Se o servidor proxy estiver ativo e com token configurado,
 * atualiza os dados de estoque do VINI_STATE com dados em tempo real do Tiny.
 *
 * Chamada futura: integrar ao botÃ£o "Sync PCP" ou a um timer automÃ¡tico.
 * Por enquanto Ã© apenas um stub â€” nÃ£o quebra nada se o servidor nÃ£o estiver ativo.
 *
 * @returns {Promise<{atualizado: boolean, mensagem: string}>}
 */
async function sincronizarComTiny(skus = []) {
  const servidorAtivo = await verificarServidorProxy();

  if (!servidorAtivo) {
    return {
      ok: false,
      mensagem:   'Servidor proxy local (server.js) nÃ£o estÃ¡ ativo na porta 3001.'
    };
  }

  if (!TinyAPI.tokenConfigurado) {
    return {
      ok: false,
      mensagem:   'Token Tiny nÃ£o configurado no arquivo .env.'
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
      mensagem: 'SincronizaÃ§Ã£o iniciada com sucesso!'
    };
  } catch (err) {
    console.error('[TinyAPI] Falha ao sincronizar com Tiny:', err.message);
    return {
      ok: false,
      mensagem: `Falha na conexÃ£o: ${err.message}`
    };
  }
}

/**
 * Consulta o status atual do processo de sincronizaÃ§Ã£o em background.
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
    console.error('[TinyAPI] Erro ao obter status da sincronizaÃ§Ã£o:', err.message);
    return null;
  }
}

// â”€â”€â”€ InicializaÃ§Ã£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Verifica automaticamente ao carregar o script (nÃ£o bloqueia nada)
verificarServidorProxy().then(ativo => {
  if (ativo && typeof window !== 'undefined') {
    // Aqui pode-se exibir um indicador visual no sistema de que a API estÃ¡ ativa
    // (implementar no index.html quando necessÃ¡rio)
    document.dispatchEvent(new CustomEvent('tinyapi:disponivel', {
      detail: { tokenConfigurado: TinyAPI.tokenConfigurado }
    }));
  }
});

// Exporta para uso em outros mÃ³dulos
if (typeof module !== 'undefined') {
  module.exports = { TinyAPI, verificarServidorProxy, buscarEstoqueTiny, buscarEntradasPrevistas, buscarSaidasPeriodo, sincronizarComTiny, obterStatusSincronizacao };
}

