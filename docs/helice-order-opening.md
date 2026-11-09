# Abertura de OP de Hélices — 06/11/2026

## Decisão e recorte

Usuário aprovou: quantidade sugerida editável; consumir só o bruto da BOM na abertura; bloquear sem bruto/sem saldo ou com saldo insuficiente; bucha não é consumida. Implementar abertura e consulta, sem execução, aprovação, refugo, fracionamento, cancelamento ou crédito de hélice. A etapa inicial é “A iniciar”, não uma operação executada.

Ator: administrador, preservando as permissões das APIs atuais de catálogo. Roteiro e SKU/descrição são fotografados na abertura. Produto continua ligado por UUID; mudar SKU posteriormente não perde a ordem.

## Persistência e contrato

Usa o armazenamento PostgreSQL versionado já existente (`app_state`) com namespace exclusivo `hrn_helice_order_v1:<requestId>` e contador `hrn_helice_order_counter_v1`, não localStorage nem as tabelas de OP antigas. A API genérica bloqueia escrita nessas chaves por padrão. Registro imutável nesta etapa, versão 1; a rota específica é a única gravação. Não se adiciona tabela/migration nesta entrega.

Tradeoff: referência do produto fica no documento, sem nova FK de banco. Toda abertura valida produto ativo pelo UUID sob bloqueio; não há API de exclusão física do catálogo. Evolução para tabelas dedicadas deverá preservar IDs, numeração e recibos; não fazer migração silenciosa nem reutilizar esse namespace para documentos incompatíveis.

`POST /api/catalog/orders/helices/:id/preview`: quantidade inteira positiva → sugestão atual, brutos, necessário/saldo/falta, bloqueios e token da prévia; nenhuma escrita. Campos/unidades/BOM pendentes, bruto inativo, físico desconhecido ou externo Tiny bloqueiam consumo. Não inventar conversão ou vínculo por prefixo.

`POST /api/catalog/orders/helices/:id`: quantidade, token da prévia e requestId aleatório → uma transação: serialização de aberturas; locks de catálogo/BOM/roteiro e saldos em ordem estável; validação da prévia atual; baixa numérica SQL protegida de cada bruto; contador e OP; recibo/auditoria. Se qualquer passo falhar, reverte tudo. Repetir o mesmo requestId e conteúdo retorna a OP existente sem nova baixa; reutilizar com outro produto/quantidade/ator gera conflito.

Cada recibo guarda UUID/SKU do bruto, quantidade/unidade, saldo e versão antes/depois. `audit_log` registra `OPEN_OP`, autor, data e payload completo. Sem escrita genérica ou remoção de ordens nesta etapa. Correções/cancelamentos futuros exigem estorno auditado, nunca apagar recibo.

## Leituras e interface

- A leitura central `attachTinyStockMetrics` agrega só novas OPs abertas e recalcula Estoque 1/virtual, preservando físico, médias e snapshot Tiny. Sem OP, entrada continua vazia e projeção usa zero. Sem físico/vendido informado, virtual não é fabricado.
- Listagem nova: `/api/catalog/orders/helices`; mais avançadas primeiro pelo progresso registrado, empate por número. Aberturas atuais têm progresso zero. Mostra quantidade, autor/data, roteiro congelado e recibo de bruto. Não oferece execução ainda.
- Análise: seta alinhada com prioridade; ação Abrir OP sempre no final; sugestão editável; conferência de bruto; confirmação desabilitada em falta. Após salvar, abre Ordens de Produção → Hélices. Ao retornar, entrada e OP ficam visíveis também na BOM.
- Falha de resposta: modal preserva payload/requestId e permite repetir a mesma abertura. Em erro incerto, bloqueia edição/fechamento enquanto se reconcilia pela mesma solicitação. Erro 409 mantém quantidade e exige nova conferência. Não declara sucesso antes da resposta.

## Evidências e limites

Testes PostgreSQL 17 descartável: baixa só de bruto; bucha/físico da hélice preservados; idempotência; falta e inatividade; prévia obsoleta; duas aberturas simultâneas; rollback após falha de auditoria; Tiny posterior mantém OP/entrada; OP antiga com o mesmo SKU não entra na projeção. Suíte geral e build. Interface local com dados fictícios: sugestão 30 bloqueada por bruto insuficiente, edição para 10, abertura, listagem e retorno à análise.

Não criar OP real no servidor apenas para testar. Publicação disponibiliza o fluxo para confirmação do usuário. Rollback do código não deve apagar OP/recibo nem restaurar bruto automaticamente; se já houver aberturas reais, manter a leitura/contagem dessas ordens durante qualquer rollback e corrigir por transação compensatória aprovada. Fluxos de estorno e etapas continuam pendentes.
