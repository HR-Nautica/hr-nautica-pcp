# P0 — proteção de escrita do estado compartilhado

## Diagnóstico

`/api/state/:key` aceitava qualquer chave `hrn_*` e chamava a persistência
central diretamente. Assim, um cliente autenticado podia substituir snapshots
inteiros de estoque, OPs e movimentos sem passar pelos locks e validações das
rotas de domínio.

## Matriz de chaves encontrada

| Classe | Chaves |
| --- | --- |
| Configuração, interface e simulação | `hrn_config` (mista: também contém `opCounter`), `hrn_analise_cobertura_alvo`, `hrn_analise_op_sugerida`, `hrn_atividades`, `hrn_coquilhas_pesos`, `hrn_earv_meta`, `hrn_earv_quantidades_usuario`, `hrn_vini_inativados`, `hrn_vini_expanded_items`, `hrn_vini_expanded_comps`, `hrn_vini_materiais_usuario` |
| Snapshots/importações | `hrn_estoque_arvore`, `hrn_earv_estoque`, `hrn_earv_saidas_periodo`, `hrn_earv_saidas_previstas`, `hrn_vini_necessidades`, `hrn_vini_entradas`, `hrn_vini_fabri_data`, `hrn_vini_fornecedores_map` |
| Cadastros e agregados administrativos | `hrn_modelos`, `hrn_buchas`, `hrn_fundicao_catalog`, `hrn_coquilhas_catalog`, `hrn_solicitacoes_acesso`, `hrn_pedidos`, `hrn_manutencoes` |
| Operação protegida | `hrn_ops`, `hrn_fundicoes`, `hrn_buchas_ops`, `hrn_buchas_entradas`, `hrn_buchas_saidas` |
| Estoque/ledger protegido | `hrn_materiais`, `hrn_movimentos` |
| Operação ainda em migração | `hrn_pecas`, `hrn_prod_comp_ops` |
| Marcadores | `hrn_cleaned_mock_data_v3`, `hrn_seeded_itens_producao_v1`, `hrn_seeded_itens_producao_v2`, `hrn_prod_comp_entradas` |
| Somente cache local | `hrn_last_master_sync`, `hrn_last_vini_sync`, `hrn_session`, `hrn_homolog_session`, `hrn_sync_timestamp` |

## Política P0

O endpoint genérico é *deny by default*, por igualdade exata de chave e método.
Não há liberação por prefixo, curinga, case-folding ou caminho alternativo.
As chaves protegidas retornam `403 GENERIC_STATE_WRITE_FORBIDDEN`, antes de
abrir banco, incrementar revisão ou escrever auditoria. A mesma barreira fica
nas funções públicas `upsertState` e `deleteState`.

| Chave protegida | Fluxo específico |
| --- | --- |
| `hrn_ops` | `/api/production-ops` |
| `hrn_fundicoes` | `/api/fundicao-ops` |
| `hrn_materiais`, `hrn_movimentos` | `/api/raw-stock` cobre somente brutos; CRUD legado pendente |
| `hrn_buchas_entradas` | `/api/buchas/entries` (P0.2A); leitura em `/api/buchas/stock` |
| `hrn_buchas_ops`, `hrn_buchas_saidas` | API de buchas pendente |

## Consumidores que exigem a próxima migração

O PR não libera por exceção os consumidores abaixo: tentativas passam a ser
rejeitadas e o `RemoteStorage` restaura o cache confirmado, sem retry offline.

- `public/js/app.js`: CRUD legado de materiais e movimentos.
- `public/js/estoque-buchas.js` e `public/js/db.js`: entradas, saídas e OPs de buchas.
- `public/js/analise.js`: sincronização de rastreio que ainda altera `hrn_ops`.
- `public/js/db.js`: bootstrap antigo de seed (desativado neste P0 para não limpar/fabricar dados).

`hrn_pecas` e `hrn_prod_comp_ops` permanecem explicitamente permitidas como
compatibilidade temporária, pois não possuem rota de domínio neste recorte.

## Limites e decisão aberta

O blueprint é uma proposta incremental; esta P0 não altera fórmula de saldo,
momento de consumo de bruto, importações, schema nem produção. A migração dos
consumidores acima deve introduzir APIs transacionais e idempotentes antes de
remover sua compatibilidade remanescente.

## Homologacao P0.1

`npm run inventory:test:integration` executa API HTTP autenticada contra PostgreSQL 17 descartavel. Material, movimentos, CAS e idempotencia passaram. O rollback real usa trigger temporario que falha ao inserir `INV_MOVE_CREATE` depois da escrita de estado; saldo, movimentos, versoes, auditoria e revisao permanecem iguais e uma movimentacao posterior funciona apos remover o trigger.

Os helpers legados de OP e fundicao ficam para P0.3. A protecao global de `/api/state` permanece pendente de P0.4 e nao deve ser considerada pronta neste recorte.

## P0.2A — Base transacional de Buchas

`GET /api/buchas/stock` e `POST /api/buchas/entries` sao a primeira camada oficial de Buchas. A leitura consolida catalogo, entradas e saidas legadas sem alterar nenhuma chave: expoe Usinagem, Retrabalho, Vulcanizacao, Estoque Final e total, com `origin=ERP_INTERNAL_TRANSACTIONS`, versoes e inconsistencias explicitas (SKU ausente do catalogo, etapa/quantidade invalida e saldo final negativo). Nao aplica `Math.max` para ocultar deficit historico.

`POST /api/buchas/entries` exige PostgreSQL, sessao/CSRF/proxy autenticados, SKU cadastrado, etapa legada valida, quantidade inteira positiva, `eventKey`, CAS e auditoria `BCH_ENTRY_CREATE`. O mesmo `eventKey` com o mesmo payload recupera o resultado sem duplicar entrada; com payload diferente e rejeitado. A nova entrada preserva o formato legado (`id`, `codigoEntrada`, `historico`) e registra o usuario autenticado. Nenhuma OP, saida, transicao, estorno ou dado legado e modificado nesta etapa.

`npm run buchas:test:integration` reutiliza PostgreSQL 17 descartavel e valida por HTTP leitura sem escrita, entrada valida, rejeicao de quantidade/SKU invalidos, idempotencia, conflito de `eventKey`, concorrencia CAS e persistencia direta no banco. A interface legada `estoque-buchas.js` ainda usa os metodos genericos para entradas/saidas/OPs e fica para P0.2B; `hrn_buchas_ops` e `hrn_buchas_saidas` continuam sem API especifica. A protecao global de `/api/state` segue pendente de P0.4.

## P0.2B — Transicoes transacionais de lotes

`POST /api/buchas/entries/:id/transition` move lotes de `hrn_buchas_entradas` em uma transacao PostgreSQL com CAS, `eventKey`, historico, ator, data e auditoria `BCH_ENTRY_MOVE`. O fluxo preservado do legado permite Usinagem → Retrabalho/Vulcanizacao/Estoque Final, Retrabalho → Vulcanizacao/Estoque Final e Vulcanizacao → Estoque Final; lote ja finalizado nao volta a transicionar. A quantidade e inteira positiva, nao pode exceder o lote e nao ha saida, consumo de OP ou baixa automatica no estoque final.

Para uma transicao parcial, o registro original torna-se a parcela movimentada e o restante permanece na etapa original em novo sublote com `parentEntryId` e `loteOrigemId`. Os codigos derivados sao verificados contra todos os lotes existentes antes de serem criados. No legado, `manter` e `split` executam a mesma divisao; ambos sao aceitos como compatibilidade, mas a interface atual expoe somente `manter`. A divergencia de nomenclatura nao introduz uma regra operacional nova.

`npm run buchas:test:integration` agora tambem prova no PostgreSQL 17 transicao integral, estoque final, divisao parcial sucessiva (10 → 4 + 6 → 4 + 2 + 4), validacoes, idempotencia, conflito de evento, concorrencia CAS, conservacao de quantidade, historico/auditoria e rollback real por trigger temporario apos a escrita de estado. A migracao da interface, das saidas e das OPs continua pendente para P0.2C; a protecao global `/api/state` permanece para P0.4.

## P0.2C — Saidas transacionais de Estoque Final

`POST /api/buchas/outputs` registra baixa somente contra o saldo acabado calculado no PostgreSQL: entradas em Estoque Final (ou historicamente concluidas) menos saidas confirmadas. A transacao bloqueia catalogo, entradas e saidas; valida SKU, quantidade inteira positiva, CAS, `eventKey` e inconsistencias do SKU antes de inserir uma unica saida em `hrn_buchas_saidas`. Nao usa `Math.max`, nao altera lotes/historicos de entrada e nao cria consumo de OP, estorno ou saida automatica.

O registro preserva o formato legado e adiciona `eventKey`, historico, ator, horario, identificador e codigo `SAI-BCH-*` unicos; a auditoria e `BCH_OUT_CREATE`. Repeticao identica recupera a saida original e payload divergente e rejeitado. A homologacao PostgreSQL inclui baixa parcial, saldo insuficiente, entrada invalida, SKU inexistente, conflito CAS, disputa simultanea pelo mesmo saldo, idempotencia, leitura consolidada e rollback real por trigger temporario. Interface, OPs e estornos ficam para P0.2D ou decisao posterior; `/api/state` continua pendente de P0.4.

## P0.2D — Interface de Buchas nas APIs oficiais

`estoque-buchas.js` le o snapshot coerente de `GET /api/buchas/stock`, que agora inclui catalogo, lotes/entradas com historicos e saidas, alem dos saldos confirmados. A interface nao recalcula saldos a partir do cache nem grava antecipadamente: atualiza o cache somente por `RemoteStorage.applyServerState` apos resposta oficial, sem `setItem`, `saveBuchasEntradas` ou `saveBuchasSaidas` nos tres handlers migrados.

Nova entrada, transicao e saida aguardam respectivamente `/entries`, `/entries/:id/transition` e `/outputs`; mantem o modal aberto em erro, desabilitam o botao durante envio e so mostram sucesso apos confirmacao. Cada intencao preserva seu `eventKey` enquanto o payload nao mudar, inclusive se a resposta for perdida; conflitos 409 atualizam o snapshot oficial sem sobrescrita local e nao ha retry automatico com nova chave. A tela busca novamente o snapshot ao ser aberta e apos cada confirmacao. A migracao dos metodos legados `DB.addBuchaEntrada`, `DB.moverBuchaEntrada` e `DB.addBuchaSaida` para outros consumidores, assim como OPs de Buchas, permanece pendente para P0.2E/P0.4.

## P0.2E — Reconciliacao e homologacao de Buchas

O contrato final de leitura e `GET /api/buchas/stock`: `catalog`, `entries`, `outputs`, `ops`, `items`, `versions`, `revision`, `origin` e `inconsistencies`. Cada item traz Usinagem, Retrabalho, Vulcanizacao, Estoque Final e total; Estoque Final e entradas finalizadas menos saidas confirmadas. A leitura e imutavel e pode ser consumida pela futura Central de Estoque sem autoridade de escrita.

A fixture PostgreSQL legada confirmou compatibilidade com campos opcionais, lotes concluidos por status, lotes parciais, historicos e codigos preexistentes sem sobrescrita. Inconsistencias sao somente reportadas com `severity=error`: saldo final negativo/saida excedente, SKU ausente do catalogo, etapa invalida, codigo de entrada ou saida duplicado e divergencia de OP apenas quando ha vinculo explicito com lote. Nenhuma delas e corrigida automaticamente.

Os fluxos oficiais da tela nao usam escrita generica. Permanecem em `public/js/db.js` apenas as definicoes legadas e seus usos internos: `addBuchaEntrada`, `moverBuchaEntrada`, `addBuchaSaida` e a limpeza de registros `seed`; nao foram removidos porque uma remocao exigiria migracao/confirmacao de todos os consumidores e do bootstrap. P0.3 pode iniciar sem alterar Buchas; P0.4 somente pode bloquear globalmente as chaves criticas depois de tratar esses consumidores legados, OPs de Buchas, estornos e devolucoes.

## P0.3A — Reconciliacao transacional de Rastreio

`POST /api/production-tracking/reconcile` recebe um lote normalizado com `sourceId` estavel, SKU/modelo, bruto, quantidade, localizacao, operacao, referencia de origem, `importId` e `eventKey`. Um `sourceId` e obrigatorio para criar ou atualizar acompanhamento: a reconciliacao nao usa numero de linha como identidade definitiva. O lote inteiro e atomico; identificacao duplicada, ambigua, vinculo inconsistente ou origem incompativel rejeita toda a operacao.

Registros importados criam OP e peca com `origin=tracking_import` e `trackingSourceId`; sao distintos das OPs manuais e nunca passam pela rota de OP manual. Reimportacao identica mantem os IDs, alteracao atualiza somente o acompanhamento e acrescenta historico. `eventKey` e persistido em `hrn_tracking_reconcile_events`; repeticao identica e idempotente, divergente e rejeitada. A transacao bloqueia apenas `hrn_ops`, `hrn_pecas` e o ledger de eventos de rastreio, sem alterar `hrn_materiais`, `hrn_movimentos` ou qualquer chave de Buchas.

`npm run tracking:test:integration` valida HTTP autenticado em PostgreSQL 17 descartavel: criacao, reimportacao, atualizacao, preservacao de IDs/OP manual, CAS, ambiguidade, concorrencia/idempotencia, rollback real e comparacao direta dos agregados fisicos. A migracao de `syncRastreioPecas` e a apresentacao separada do resultado de cobertura/rastreio ficam para P0.3B. A protecao global `/api/state` segue pendente de P0.4.

## P0.3B — Interface de importação de rastreio

`syncRastreioPecas` agora envia exclusivamente `POST /api/production-tracking/reconcile`; não cria OP, peça ou atividade pelo `DB`, nem chama `DB.addOp`, `DB.saveOps` ou `DB.savePecas`. A identidade é extraída somente de coluna explícita de lote/identificador (`ID Lote`, `Identificador`, `Lote`, número/código de lote). Não há fixture de planilha de rastreio versionada no repositório; por isso a coluna é validada na importação e a ausência ou duplicidade interrompe apenas o rastreio, sem inventar identidade pela posição da linha.

`sourceId` é o identificador estável externo do lote, `importId` identifica a leitura atual da planilha e `eventKey` identifica a intenção de reconciliação. Uma falha de rede reutiliza o mesmo `eventKey` enquanto o payload normalizado for igual; após confirmação ele é descartado. Em `409`, as versões confirmadas são recarregadas sem sobrescrever localmente e não há retry automático.

A importação de cobertura é confirmada antes da reconciliação. O retorno e a tela distinguem `coverage=confirmed` de `tracking=confirmed|failed|skipped`: se o rastreio falhar, o estado é parcial explícito, sem alegar rollback da cobertura. O cache de `hrn_ops` e `hrn_pecas` só é atualizado com resposta confirmada pela API. Estoque físico, materiais, movimentos, OP manual, Buchas e regras de consumo não são tocados. A proteção global de `/api/state` continua dependente do P0.4 e da migração dos demais consumidores legados.

## P0.4A — Proteção das escritas operacionais críticas

| Chave | Consumidor ativo | API oficial | Situação |
| --- | --- | --- | --- |
| `hrn_materiais`, `hrn_movimentos` | tela de estoque via `DB.addMaterial/update/delete/addMovimento` | `/api/inventory` | bloqueada no genérico |
| `hrn_buchas_entradas`, `hrn_buchas_saidas` | `estoque-buchas.js` | `/api/buchas/entries`, `/transition`, `/outputs` | bloqueada no genérico |
| `hrn_ops` | OP manual | `/api/production-ops` | bloqueada no genérico |
| `hrn_pecas` | importação de rastreio | `/api/production-tracking/reconcile` | bloqueada no genérico |
| `hrn_fundicoes` | OP/finalização de fundição | `/api/fundicao-ops` | bloqueada no genérico |
| `hrn_config` | nenhum consumidor ativo de escrita genérica confirmado | nenhuma | bloqueada preventivamente |
| `hrn_buchas_ops` | somente helpers legados sem consumidor ativo confirmado | nenhuma | permanece bloqueada; migração/remoção em P0.4B |

O guard deny-by-default é aplicado na rota `/api/state/:key`, em `upsertState`/`deleteState` e também em `upsertStatePostgres`/`deleteStatePostgres`, eliminando bypass direto. Chaves operacionais proibidas retornam `403 GENERIC_STATE_WRITE_FORBIDDEN` antes de alterar estado, versão, revisão ou auditoria; leituras de snapshot continuam permitidas. Os caches de Fundição foram ajustados para usar apenas `RemoteStorage.applyServerState` após resposta oficial, sem fallback `DB.saveFundicoes`.

`npm run tracking:test:integration` agora prova em PostgreSQL 17 descartável PUT/DELETE HTTP proibidos para os agregados protegidos, leitura permitida, bloqueio das funções genéricas diretas e igualdade de estado, auditoria e revisão antes/depois. As APIs oficiais continuam cobertas pelas integrações de inventário, Buchas, rastreio, OP manual e Fundição. Seeds antigos de Buchas e helpers `DB.save*` permanecem definidos, mas sem consumidor ativo confirmado para os fluxos migrados; P0.4B deve remover/migrar somente após confirmar cada uso restante. A proteção global para todas as chaves de negócio ainda não está declarada concluída.

## P0.4B — Matriz final da política genérica

| Classe | Chaves | Consumidores de escrita | Decisão |
| --- | --- | --- | --- |
| Operação e ledger | `hrn_materiais`, `hrn_movimentos`, `hrn_ops`, `hrn_pecas`, `hrn_fundicoes`, `hrn_buchas_entradas`, `hrn_buchas_saidas` | Inventário, OP manual, rastreio, Fundição e Buchas | PUT/DELETE bloqueados; somente APIs de domínio |
| OP de Buchas sem fluxo oficial | `hrn_buchas_ops` | Nenhum consumidor ativo confirmado | PUT/DELETE bloqueados; não liberar sem API e decisão de negócio |
| Configuração operacional | `hrn_config` | Nenhum consumidor ativo confirmado | PUT/DELETE bloqueados; não é contador auxiliar do cliente |
| Catálogos e cadastros administrativos | `hrn_modelos`, `hrn_buchas`, `hrn_fundicao_catalog`, `hrn_coquilhas_catalog`, `hrn_coquilhas_pesos`, `hrn_pedidos`, `hrn_manutencoes`, `hrn_atividades`, `hrn_solicitacoes_acesso` | Formulários de catálogo/administração e auditoria de interface | PUT explícito, com CAS do estado remoto; DELETE genérico negado |
| Snapshots e planejamento | `hrn_estoque_arvore`, `hrn_earv_*`, `hrn_vini_*`, `hrn_analise_*`, `hrn_prod_comp_ops` | Importadores de cobertura/componentes e preferências de planejadores | PUT explícito; não representa saldo interno de Buchas/brutos |
| Limpeza de cache planejado | `hrn_vini_entradas`, `hrn_prod_comp_entradas` | VINI e produção de componentes | DELETE explícito somente para limpar cache de planejamento local/remoto |
| Marcadores antigos | `hrn_cleaned_mock_data_v3`, `hrn_seeded_itens_producao_*` | Nenhum caminho ativo | PUT/DELETE bloqueados; qualquer uso futuro exige revisão explícita |
| Somente navegador | `hrn_session`, `hrn_homolog_session`, `hrn_last_master_sync`, `hrn_last_vini_sync`, `hrn_sync_timestamp` | Sessão/log local | Não são autoridade de banco |

O bootstrap não chama mais seeds de OPs, entradas ou saídas de Buchas, nem atualizações automáticas que dependiam de `hrn_config`. Os helpers `ensureBuchasOpsSeed` e `ensureBuchasEntradasSeed` foram removidos por não possuírem consumidores após essa retirada. `DB.seed()` permanece limitado ao catálogo em banco vazio e não cria estado operacional; o trecho legado inatingível não é executado. Helpers `DB.save*` de agregados protegidos permanecem somente como compatibilidade sem consumidor ativo confirmado e continuam incapazes de persistir pela barreira de backend.

`RemoteStorage` trata `403 GENERIC_STATE_WRITE_FORBIDDEN` restaurando o snapshot confirmado, limpando a pendência e sem retry infinito; os fluxos transacionais aplicam cache apenas após resposta oficial. Os testes de política cobrem as permissões explícitas de cadastros, a rejeição das chaves críticas, o guard direto do banco, leitura de snapshots e o bootstrap sem seeds operacionais. A homologação futura exige manter PostgreSQL descartável, autenticação/CSRF, as integrações de domínio e esta matriz; não há autorização para liberar novas chaves por prefixo.
