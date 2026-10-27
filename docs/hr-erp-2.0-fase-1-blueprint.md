# HR Náutica ERP 2.0 — Blueprint funcional e arquitetural da Fase 1

**Status:** arquitetura proposta para aprovação; nenhuma funcionalidade ou migration é autorizada por este documento.

**Baseline inspecionado:** `fix/p0-state-write-protection` em `062ab5d` mais o conteúdo do PR #3 em `1c78bac`.

**Data da verificação:** 2026-10-26.

## 1. Escopo e princípios

Este blueprint reorganiza o ERP em sete limites funcionais: **Cadastro Mestre**, **Catálogos**, **BOM**, **Central de Estoque**, **Planejamento**, **Ordens de Produção** e **Integrações/Expedição**. A mesma identidade de item liga os módulos, mas cada domínio conserva sua autoridade de escrita.

Princípios obrigatórios:

1. Um SKU identifica um item; catálogo descreve, estoque posiciona, planejamento projeta e OP executa.
2. Cada combinação `item + local` possui exatamente uma fonte oficial de saldo físico em um instante.
3. Snapshot Tiny/planilha e ledger ERP são autoridades alternativas, nunca parcelas somadas do mesmo saldo.
4. Demanda, entrada prevista, OP ativa, reserva, simulação e saldo físico são naturezas distintas.
5. Importação publica snapshots imutáveis; não apaga cadastro, BOM publicada, OP, evento ou movimento.
6. Alteração de fonte, publicação de BOM e movimento físico exigem servidor, auditoria, autorização e controle de concorrência.
7. O frontend atual continua em Vite/HTML/JavaScript. A arquitetura não pressupõe React nem redesign nesta fase.

## 2. Estado atual verificado

### 2.1 Navegação antiga → nova

| Tela atual | Responsabilidade real hoje | Destino no ERP 2.0 | Tratamento |
|---|---|---|---|
| Painel de Controle | Resumo de OPs, estoque e atividades de agregados atuais | Início | Manter; trocar leituras gradualmente pelos contratos centrais |
| Central de Sincronização de Estoque | Importa árvore, posição/saídas e outros arquivos para chaves `hrn_earv_*` | Integrações › Importações | Separar cada dataset e sua publicação |
| Sincronizar Saídas (V.I.N.I.) | Entrada específica de arquivos usados pelo V.I.N.I. | Integrações › Importações › Demanda de componentes | Unificar o pipeline, sem unir snapshots |
| Catálogo de Hélices | CRUD de `hrn_modelos`; vínculos a bruto, bucha e embalagens | Hélices › Catálogo | Migrar para item mestre + extensão da família + BOM/vínculos explícitos |
| Análise de Produção de Hélices | Importa/anota análise temporária e considera OPs de hélices | Hélices › Planejamento | Preservar cálculo atual até decisão aprovada |
| Rastreio OP. Hélices | OP importada, operações, avanço parcial e finalização | Hélices › OPs | Adaptar `helice_production_orders`; conclusão não credita acabado |
| Catálogo de Buchas | CRUD de `hrn_buchas` | Buchas › Catálogo | Migrar para item mestre + especificação de bucha |
| Estoque de Buchas | Saldos derivados, entradas/lotes, etapas e saídas | Central de Estoque (filtro Buchas) + Buchas › OPs | Separar posição física de execução; preservar registros legados |
| Estoque Componentes | Árvore níveis 00/01/02, posição e saídas importadas | Componentes › Catálogo e BOM + Central de Estoque | Árvore vira BOM versionada; saldo continua snapshot separado |
| V.I.N.I. | Planejamento de componentes com estoque, demanda e OP ativa | Componentes › Planejamento (V.I.N.I.) | Primeiro planejador a consumir o contrato central |
| Produção de Componentes | OP com explosão da árvore e etapas embutidas | Componentes › OPs | Preservar snapshot da estrutura usado na criação da OP |
| Catálogo de Brutos | Relação coquilha/bruto ↔ hélice e peso | Fundição › Catálogo | Migrar para itens brutos, coquilhas e vínculos estáveis |
| Programação de Fundição | Necessidade de brutos e criação/edição de OP | Fundição › Planejamento | Separar sugestão de criação da OP |
| Rastreio de OPs de Fundição | Execução/finalização; crédito idempotente de bruto | Fundição › OPs | Manter regra transacional vigente |
| Controle de Expedição | Pedidos/vendas e estados de expedição em agregados | Expedição | Módulo independente; fornece demanda confirmada por contrato |
| Manutenção de Ferramentas | Cadastro e andamento de manutenção | Administração › Manutenção | Fora da migração produtiva inicial; manter íntegro |
| Relatórios e Métricas | Visões agregadas atuais | Relatórios | Migrar somente após estabilização dos contratos de leitura |

Lacunas atuais: não há Cadastro Mestre único, Central de Estoque unificada, planejamento próprio de Buchas, política de fonte por item/local nem BOM editável/versionada. A OP de Buchas existe dentro dos agregados e telas de estoque, não como módulo isolado.

### 2.2 Persistência, APIs e vínculos atuais reutilizáveis

| Estrutura atual | Conteúdo/autoridade observada | Reuso previsto |
|---|---|---|
| `app_state(key, value, version)` | Agregados JSON `hrn_*`, versão por chave | Fonte de backfill e camada de compatibilidade temporária |
| `app_revision` | Revisão global do snapshot remoto | Sincronização legada durante coexistência |
| `audit_log` | Auditoria de escrita por chave | Evidência de migração; não substitui auditoria relacional futura |
| `temp_analise_producao` | Último lote de análise de hélices; lote anterior é removido | Migrar para snapshots tipados e imutáveis |
| `helice_production_orders` | OPs importadas, operações, estágio e histórico | Preservar IDs, números, `source_key` e histórico; adaptar ao contrato de OP |
| `auth_users`, `auth_sessions` | Autenticação atual; papel restrito a `admin` | Manter; ampliar papéis somente em decisão própria |
| `hrn_modelos` | Catálogo de hélices e vínculos por texto/SKU | Backfill de item, aliases, especificação e BOM |
| `hrn_buchas`, `hrn_buchas_entradas`, `hrn_buchas_saidas`, `hrn_buchas_ops` | Catálogo, lotes/etapas, baixas e OPs de buchas | Backfill sem apagar nem consolidar eventos irreversivelmente |
| `hrn_fundicao_catalog`, `hrn_coquilhas_catalog`, `hrn_coquilhas_pesos` | Brutos/coquilhas e relações de fundição | Backfill de item bruto, ferramenta e relações técnicas |
| `hrn_fundicoes`, `hrn_materiais`, `hrn_movimentos` | OPs de fundição, saldos internos e movimentos | Base de migração do ledger de brutos |
| `hrn_ops` | OPs manuais de hélices; hoje consomem bruto na criação | Compatibilidade obrigatória até decisão D-001 |
| `hrn_estoque_arvore` | Árvore importada por linhas/níveis | Importação inicial da BOM versão 1 |
| `hrn_earv_estoque`, `hrn_earv_saidas_periodo`, `hrn_earv_saidas_previstas` | Snapshots separados de saldo e demanda | Backfill dos primeiros snapshots tipados |
| `hrn_vini_necessidades`, `hrn_vini_entradas` | Planejamento importado e entradas previstas | Fontes transitórias; não são cadastro mestre |
| `hrn_vini_fornecedores_map`, `hrn_vini_fabri_data` | Vínculos de fornecedor e fabricação | Staging de importação; mudanças futuras viram propostas |
| `hrn_prod_comp_ops` | OPs de componentes e estrutura explodida | Preservar como histórico; migrar OP e seus itens/etapas |

APIs reais a manter durante a transição: `/api/state`, `/api/analysis-temp`, `/api/helice-ops`, `/api/production-ops`, `/api/raw-stock`, `/api/fundicao-ops`. As rotas Tiny em `/api/produtos/*` retornam conjuntos vazios e a sincronização V.I.N.I. externa retorna indisponibilidade; são contratos de fachada, não integração Tiny homologada.

Vínculos aproveitáveis, após validação: SKU de hélice ↔ `codigoBruto`; SKU de hélice ↔ `skuBucha`; coquilha ↔ itens fundidos; linhas de árvore 00/01/02; `source_key` de OP importada; `eventKey` dos movimentos de bruto. Vínculo somente por descrição ou posição de linha deve ser convertido em pendência de conciliação, não aceito silenciosamente.

### 2.3 Fluxo atual em uma linha

| Origem | Entidade atual | Evento | Persistência | Leituras | Tela |
|---|---|---|---|---|---|
| Planilha de necessidade | análise de hélices | substituir lote | `temp_analise_producao` | análise + OPs ativas | Planejamento de Hélices |
| Planilhas de componentes | árvore/estoque/demanda | publicar chaves separadas | `app_state` | Estoque Componentes + V.I.N.I. | Sincronização/V.I.N.I. |
| Operador | OP manual de hélice | criar/editar/cancelar | transação sobre `hrn_ops`, materiais e movimentos | painel/OP/estoque bruto | Análise/OPs |
| Planilha de OPs | OP de hélice | importar/avançar/finalizar | `helice_production_orders` | rastreio + planejamento | Rastreio de Hélices |
| Operador | lote/OP de bucha | entrada/transição/saída | chaves `hrn_buchas_*` | saldos derivados | Estoque de Buchas |
| Operador | OP de fundição | criar/finalizar | transação sobre `hrn_fundicoes`, materiais e movimentos | programação/rastreio/estoque bruto | Fundição |
| Operador | OP de componente | criar/etapa/concluir/cancelar lógico | `hrn_prod_comp_ops` versionado | V.I.N.I. + Produção | Componentes |

## 3. Arquitetura funcional de destino

```text
Tiny/planilhas ──> Ingestão + validação ──> snapshots imutáveis ─┐
                                                                  │
ERP operacional ──> movimentos idempotentes ──> ledger/saldos ───┤
                                                                  ▼
Cadastro Mestre ──> políticas item/local ──> Central de Estoque (leitura)
       │                                  ┌──────────┼──────────┐
       ├── Catálogos por família          ▼          ▼          ▼
       └── BOM publicada/versionada   Planejamento  OPs     Expedição
                                            │          │
                                            └─ proposta┘ (ação explícita)
```

### 3.1 Modelo lógico

**Identidade e catálogo**

- `item`: UUID interno imutável, `sku_canonico`, descrição, unidade base, tipo, família, estado (`ativo/inativo`) e metadados de auditoria.
- `item_codigo`: códigos alternativos por namespace (`TINY`, `LEGADO`, `FORNECEDOR`); unicidade por `namespace + codigo_normalizado`; período de validade.
- `helice_especificacao`, `bucha_especificacao`, `componente_especificacao`, `bruto_especificacao`: atributos próprios sem duplicar identidade ou saldo.
- `coquilha`: ferramenta de fundição, não item estocável por padrão; relação explícita com os brutos que produz.
- `item_relacao`: vínculos técnicos que não são BOM, com tipo controlado, por exemplo `USINA_DE`, `USA_BUCHA`, `EMBALA_COM`.

**Estrutura de produto**

- `bom`: estrutura pertencente a um item fabricado.
- `bom_versao`: número sequencial, estado `rascunho/publicada/obsoleta`, vigência, origem e aprovador. Apenas uma publicada/vigente por BOM e contexto.
- `bom_linha`: versão, item componente, quantidade e unidade; pai e filho são IDs do item mestre. A multinível é obtida recursivamente pelas BOMs dos componentes, não por níveis fixos 00/01/02.
- `roteiro`, `roteiro_versao`, `operacao`: etapas produtivas versionadas separadamente; uma linha pode apontar a operação de consumo quando essa regra for aprovada.

**Estoque e importação**

- `local_estoque`: depósito físico ou buffer controlado. Etapa produtiva é `operacao`; só será local quando houver custódia e contagem física próprias.
- `politica_saldo`: `item_id + local_id + vigencia`, fonte `TINY_SNAPSHOT` ou `ERP_LEDGER`, configuração e estado. Constraint impede duas políticas vigentes.
- `lote_importacao`: arquivo, checksum, ator, datas e estado `recebido/validado/rejeitado/publicado/parcial_legado`.
- `dataset_importacao`: tipo e escopo do conjunto encontrado no arquivo.
- `snapshot_estoque`/`snapshot_estoque_linha`: posição física datada e imutável.
- `snapshot_demanda`/`snapshot_demanda_linha`: saídas previstas datadas e imutáveis.
- `snapshot_entrada_prevista`/linhas: fornecimento futuro; nunca saldo físico.
- `movimento_estoque`: evento ERP imutável, quantidade assinada, item, local, motivo, ator, vínculo operacional e `event_key` único.
- `saldo_erp`: projeção transacional/reconstruível do ledger, atualizada atomicamente com o movimento.

**Planejamento e execução**

- `ordem_producao`: número, família, item, quantidade, estado técnico, origem, datas e responsável.
- `ordem_item`, `ordem_operacao`, `ordem_evento`: estrutura/roteiro congelados na abertura e histórico cronológico. Alterar BOM futura não reescreve OP existente.
- `reserva_estoque`: entidade opcional, criada somente após aprovação da política de reserva/consumo.
- `cenario_planejamento`: parâmetros e resultados de simulação; não atualiza fonte oficial.

Relações centrais:

```text
item 1──N item_codigo                item 1──N politica_saldo N──1 local_estoque
item 1──N bom 1──N bom_versao 1──N bom_linha N──1 item(componente)
item 1──N snapshot_estoque_linha     item 1──N movimento_estoque
item 1──N ordem_producao 1──N ordem_operacao / ordem_evento / ordem_item
coquilha N──N item(bruto)            ordem_producao ──0..N── movimento_estoque
```

### 3.2 Identidade de SKU

1. O UUID é a chave interna e nunca muda; SKU é chave de negócio única entre itens ativos.
2. Normalização para comparação: trim, caixa alta e normalização de espaços. Pontuação interna não é removida, pois pode distinguir códigos reais.
3. O valor original é preservado; uma troca de SKU cria alias com vigência e auditoria, não altera históricos.
4. Importação resolve primeiro `item_codigo(namespace=TINY)`, depois SKU canônico. Não cria item automaticamente na publicação: desconhecidos ficam em conciliação.
5. Colisões (`um código → vários itens` ou `vários candidatos → um item`) bloqueiam publicação do dataset afetado.
6. Prefixos e descrições aproximadas podem sugerir correspondência, nunca confirmá-la.

### 3.3 Política de fonte por item e local

| Família/natureza | Política inicial obrigatória | Evento que altera | Proibido |
|---|---|---|---|
| Hélice usinada — físico | `TINY_SNAPSHOT` no depósito de acabados | publicar snapshot de estoque | conclusão de OP creditar físico |
| Componente — físico | `TINY_SNAPSHOT` no depósito configurado | publicar snapshot de estoque | V.I.N.I./OP criar físico |
| Bucha — físico | `ERP_LEDGER` nos locais de bucha | entrada, transição física, saída, consumo ou estorno autorizado | planilha Tiny sobrescrever saldo |
| Bruto fundido — físico | `ERP_LEDGER` no estoque de brutos | fundição finalizada, consumo/estorno ou ajuste autorizado | snapshot Tiny sobrescrever saldo |
| Saída prevista | `snapshot_demanda` | publicação de dataset próprio | subtrair diretamente do ledger |
| Entrada prevista | `snapshot_entrada_prevista` | publicação de dataset próprio | somar ao físico sem recebimento |
| OP ativa | projeção de execução | transição de OP | duplicar entrada prevista |
| Reserva | inexistente até aprovação | evento futuro autorizado | inferir reserva de uma OP |
| Simulação | cenário isolado | ação do planejador | persistir como saldo/OP |

A configuração por item/local permite exceções futuras, mas a carga inicial deve reproduzir a matriz vigente acima. Trocar a fonte requer: permissão específica, data efetiva, snapshot/ledger de corte, conciliação documentada, auditoria e impossibilidade de sobreposição temporal. O depósito não é deduzido da etapa produtiva; buffers produtivos só entram no estoque quando cadastrados como locais contáveis.

### 3.4 BOM: da importação à gestão no ERP

1. A planilha de árvore atual entra em **staging**, mantendo arquivo, checksum, linha, nível e valores originais.
2. O sistema resolve SKUs no Cadastro Mestre e apresenta órfãos, duplicidades, ciclos, unidades ausentes e relações ambíguas.
3. Após aprovação, cada estrutura válida é adotada uma única vez como `bom_versao = 1`, `publicada`, com vínculo ao lote de importação.
4. A partir da adoção, o editor ERP cria uma nova versão em rascunho. Publicar exige validação de ciclo, quantidades, unidades, concorrência e permissão.
5. Importações posteriores nunca escrevem na versão publicada. Geram uma **proposta de comparação** (`novo`, `alterado`, `removido`) que pode ser descartada ou usada para formar novo rascunho.
6. OP guarda a versão e a explosão usadas na abertura. Nova BOM afeta apenas cálculos/OPs posteriores à sua vigência.
7. Rollback funcional é publicar uma nova versão baseada numa anterior; versões e linhas usadas nunca são apagadas.

### 3.5 Contratos entre módulos

| Produtor | Contrato | Consumidores | Regras |
|---|---|---|---|
| Cadastro Mestre | `ItemRef {itemId, sku, descricao, familia, unidade, ativo}` | todos | leitura comum; nenhuma tela inventa identidade |
| Catálogo | especificação + relações/BOM publicada | Planejamento, OP | não contém saldo |
| Estoque | `StockPosition {itemId, localId, fisico, fonte, referenciaEm, atualizadoEm, status}` | Central, Planejamento, OP | uma fonte oficial; projeções em campos separados |
| Integrações | snapshots publicados e relatório de conciliação | Estoque, Planejamento | idempotência por checksum/escopo; publicação atômica por dataset/lote aprovado |
| Planejamento | `PlanningProjection {fisico, demanda, entradaPrevista, opAtiva, reserva, projetado, sugestao, formulaVersao}` | operador/OP | recalcular não cria OP; fórmula atual preservada |
| OP | ordem, estrutura congelada, estados e eventos | Planejamento, Rastreio, Estoque | movimento somente no evento autorizado da família |
| Expedição | demanda confirmada/atendida | Planejamento e relatórios | não altera estoque sem evento de saída próprio |

Contratos HTTP novos devem nascer versionados (`/api/v2/...`) enquanto adaptadores mantêm as rotas atuais. Toda mutação recebe versão esperada ou chave idempotente; `409` exige reconciliação, e timeout não pode aparecer como sucesso.

## 4. Fluxos funcionais por família

### Hélices usinadas

`Cadastro Mestre → Catálogo/vínculos com bruto e bucha → snapshot Tiny de acabados + demanda separada → Planejamento → criação explícita de OP → operações/rastreio → conclusão`.

- Físico acabado continua vindo do snapshot.
- OP ativa é projeção; conclusão remove a parcela ativa, sem crédito do acabado.
- Consumo/reserva de bruto e bucha permanece no comportamento legado até D-001.

### Buchas

`Cadastro Mestre → Catálogo → saldos ERP por local/etapa contável → Planejamento → OP/lote → etapas → entrada no estoque final → saída/consumo`.

- Entradas, transições e saídas viram eventos auditáveis; não se apaga lote concluído.
- A semântica entre OP de bucha e “entrada/lote” atual precisa ser aprovada antes da normalização.

### Componentes

`Cadastro Mestre → Catálogo + BOM publicada → snapshot Tiny de físico + demanda → V.I.N.I. → criação explícita de OP → execução da estrutura congelada → conclusão`.

- V.I.N.I. lê Central/BOM/OP; renderização não persiste.
- OP concluída não credita físico enquanto a política do item/local for Tiny.
- Entradas previstas e OPs ativas ficam separadas até D-002.

### Fundição / brutos

`Cadastro Mestre → Catálogo de brutos/coquilhas → saldo ERP → Planejamento da Fundição → OP → apontamento produzido → movimento idempotente de entrada do bruto`.

- Finalizar duas vezes não duplica saldo.
- Editar/excluir OP finalizada permanece bloqueado; correção física usa estorno/ajuste autorizado.

## 5. Pipeline Tiny/planilhas e snapshots separados

Cada upload segue `receber → detectar layouts/cabeçalhos → parsear todos os datasets → validar → conciliar SKUs → mostrar prévia → publicar`. Nenhuma gravação ocorre antes da validação integral; a publicação definitiva deve ser transacional no servidor.

| Dataset | Exemplo atual | Destino | Escopo de substituição |
|---|---|---|---|
| Posição de estoque | `necessidade.xlsx`: SKU, estoque físico | snapshot de estoque | somente família/local/tipo declarados |
| Saídas previstas | `saidas previstas.xls`, aba `Vendas` | snapshot de demanda | somente demanda; pode ser subconjunto |
| Saídas do período/média | colunas do arquivo de necessidade | snapshot de consumo histórico | preservar média/horizonte informados |
| Entradas previstas | aba/conjunto próprio | snapshot de entrada prevista | nunca somar ao físico |
| Estrutura/BOM | árvore níveis 00/01/02 | staging/proposta de BOM | nunca sobrescrever BOM publicada |
| Fornecedor | mapa SKU/fornecedor | staging de vínculo | não altera item/saldo automaticamente |
| Fabricação/roteiro | planilha de fabricação | staging/proposta de roteiro | não altera OP existente |

Zeros e negativos são preservados no snapshot. Ausência de SKU só remove sua posição corrente quando o dataset for declarado e validado como snapshot completo daquele escopo. Dataset parcial produz nova observação parcial e não zera os ausentes. `import_id`, checksum, ator, referência temporal, contagens, erros e versão do parser são obrigatórios.

## 6. Sequência de evolução sem perda de dados

1. **Base Git/P0:** homologar o PR #3 sobre P0; registrar SHA; criar branch da Fase 2 somente depois da decisão de integração. Não construir sobre um merge sintético não aprovado.
2. **Contratos e inventário executável:** congelar dicionário das chaves/estados atuais, fixtures anônimas e adaptadores de leitura. Nenhuma troca de fonte.
3. **Cadastro Mestre e locais:** migrations apenas aditivas; backfill por SKU; relatório de colisões; dual-read comparado, ainda sem cortar escrita.
4. **Políticas e snapshots:** cadastrar defaults da matriz, pipeline transacional e Central de Estoque read-only. Comparar posição nova com telas atuais.
5. **BOM:** staging da árvore, conciliação, adoção da versão 1 e editor versionado. Manter `hrn_estoque_arvore` somente como fallback durante homologação.
6. **Planejamento:** migrar V.I.N.I. primeiro, depois Hélices, Buchas e Fundição. Cada corte preserva fórmula e roda comparação paralela.
7. **OPs:** adaptar Componentes, Hélices importadas, Fundição, Buchas e por último OP manual de hélices, pois D-001 afeta estoque.
8. **Navegação:** ativar novos módulos por feature flag/permissão; links antigos redirecionam somente após aceite funcional. Expedição e Integrações permanecem separados.
9. **Descontinuação:** cessar escrita legada apenas após reconciliação, janela de observação e rollback ensaiado. Arquivos/chaves legados permanecem arquivados, não apagados na mesma release.

Estratégia de migration: `expand → backfill idempotente → validar → dual-read → cutover → contract` em releases distintas. Toda migration terá dry-run, contagens antes/depois, constraints inicialmente compatíveis, rollback de aplicação e backup verificado. Não há migration aprovada nesta Fase 1.

## 7. Git, PR #3 e integração com `main`

- `main`, `origin/main` e `fix/p0-state-write-protection` apontam para `062ab5d`.
- O worktree desta análise está em `feat/vini-planejamento-integrado`, SHA `1c78bac`, três commits à frente de P0.
- PR #3, “Etapa 2A: integrar V.I.N.I. ao planejamento de componentes”, está **aberto**, não draft, `mergeable_state=clean`, base `main`, head `1c78bac` (consulta GitHub em 2026-10-26).
- Checks do head: `test=success`, `deploy=skipped`, previews concluídos/skipped conforme o job; isso não equivale a homologação funcional nem deploy.
- Dependência recomendada: concluir homologação funcional e decidir o merge do PR #3; depois atualizar a branch da Fase 2 a partir da `main` resultante. Se o PR for rejeitado, portar explicitamente apenas os contratos de pré-validação, confirmação e V.I.N.I. aprovados.
- O worktree contém alterações locais preexistentes (inclusive documentação não rastreada e `Iniciar PCP.bat` removido). Não incluí-las automaticamente em branch, commit ou PR futuro.

## 8. Riscos e controles

| Severidade | Risco real | Evidência atual | Controle de arquitetura |
|---|---|---|---|
| Bloqueador | Dupla contagem de entrada prevista e OP ativa | D-002 e cálculo distribuído no V.I.N.I. | naturezas separadas + regra aprovada/versionada |
| Bloqueador | Mudança silenciosa no consumo de bruto/bucha | OP manual consome bruto na criação; intenção nova diverge | D-001 antes de migrar esse fluxo |
| Bloqueador | Mistura de fontes no mesmo item/local | alvo configurável versus defaults por família | política única vigente + corte conciliado |
| Bloqueador | BOM importada sobrescrever edição ERP | árvore atual é snapshot substituível | adoção única + versões/propostas |
| Alto | Escrita parcial de várias chaves | P0 pré-valida, mas `app_state` não transaciona várias chaves | publicação server-side transacional |
| Alto | Identidade por texto/coquilha inconsistente | vínculos atuais incluem nomes e códigos heterogêneos | UUID + aliases + fila de conciliação |
| Alto | Buchas misturam estoque, lote e OP | agregados/tela atuais sobrepostos | mapear eventos e locais antes do backfill |
| Alto | OP histórica mudar com BOM nova | componente embute árvore hoje | preservar explosão e versão na OP |
| Alto | Exclusão de histórico em CRUD legado | há deletes físicos/lógicos distintos | cancelamento/evento; migração sem delete |
| Médio | Integração Tiny ser presumida pronta | rotas atuais são stub/offline | homologação própria e fallback por planilha |
| Médio | Permissões insuficientes | schema atual só aceita papel `admin` | decisão de papéis antes de mutações novas |

## 9. Critérios de aprovação das próximas fases

### Fase 2 — fundação de dados

- Dicionário de dados e mapeamento de 100% das chaves legadas aprovado.
- Backfill em base descartável conserva contagens, IDs externos e vínculos; colisões ficam em relatório, não são autocorrigidas.
- SKU canônico/aliases, locais e políticas possuem constraints e testes de concorrência.
- Nenhuma leitura/escrita produtiva é cortada; rollback documentado e ensaiado.
- `npm run test:ci`, `npm run build` e integração PostgreSQL 17 descartável aprovados no SHA candidato.

### Fase 3 — Central de Estoque e importações

- Cada linha exibe item, local, físico, fonte e data de referência.
- Snapshots completo/parcial, zero/negativo, SKU desconhecido/duplicado e workbook parcialmente inválido têm testes.
- Reimportação do mesmo checksum é idempotente; componentes não alteram buchas/brutos.
- Publicação é atômica; falha de rede não produz sucesso falso.
- Saldos novos conciliam com os atuais em amostra operacional assinada.

### Fase 4 — BOM e Catálogos

- Importação inicial cria versão 1 somente após conciliação e aprovação.
- Ciclo, unidade/quantidade inválida, item órfão e edição concorrente bloqueiam publicação.
- Nova importação gera diff e não sobrescreve versão publicada.
- OP antiga continua exibindo sua estrutura após nova versão da BOM.

### Fase 5 — Planejamento

- Resultado novo é comparado ao atual por família e mesma entrada; divergências são explicadas.
- Físico, demanda, entrada prevista, OP ativa, reserva, projetado e simulado aparecem separados.
- Renderizar/recalcular não grava saldo nem cria OP.
- Fórmula, horizonte, arredondamento e tratamento de negativos têm versão e aprovação explícita.

### Fase 6 — OPs e movimentos

- Máquinas de estado e permissões por família aprovadas.
- Criação, parcial, conclusão, cancelamento, repetição de request e dois operadores são testados.
- Hélice/componente concluído não credita snapshot; fundição finalizada credita uma vez.
- Movimento e saldo ERP são atômicos; correção usa estorno, não delete.
- Importação/refresh nunca remove OP ou histórico.

### Fase 7 — navegação e retirada do legado

- Todas as rotas antigas têm destino, telemetria e rollback.
- Homologação ampla/estreita cobre carregamento, vazio, erro, offline, 409 e permissão negada.
- Zero consumidores escrevem na estrutura legada antes de removê-la.
- CI, homologação funcional, plano de release e autorização explícita precedem merge/deploy.

## 10. Decisões que exigem aprovação antes da Fase 2

1. **D-001 — consumo de bruto e bucha:** manter consumo na criação, reservar, consumir no início ou apontar manualmente; definir parcial, edição, cancelamento e estorno.
2. **D-002 — entradas previstas × OP ativa:** confirmar sobreposição, escopo e regra de deduplicação por família/período.
3. **D-003 — parâmetros de planejamento:** horizonte, cobertura, arredondamento, negativos e overrides; até lá preservar valores/fórmulas atuais.
4. **D-004 — escopo dos arquivos:** classificar cada arquivo/aba como snapshot completo ou parcial e indicar família/local.
5. **D-005 — papéis:** quem importa/publica snapshot, edita item, publica BOM, troca fonte, ajusta estoque e opera/cancela OP.
6. **D-006 — governança do SKU:** confirmar se SKU canônico é globalmente único e aprovar namespaces/aliases para Tiny e códigos legados.
7. **D-007 — depósitos e etapas:** listar locais físicos oficiais e decidir quais etapas de Buchas/Fundição são locais contáveis versus apenas status de processo.
8. **D-008 — adoção da BOM:** definir aprovador, vigência e se fornecedor/roteiro entram na mesma aprovação ou em versões independentes.
9. **D-009 — política de troca de fonte:** aprovar quem pode alterar `TINY_SNAPSHOT ↔ ERP_LEDGER` e o procedimento de corte/conciliação.
10. **D-010 — semântica de Buchas:** decidir se “entrada/lote” atual é OP, lote de estoque ou ambos, e qual evento forma o estoque final.
11. **D-011 — integração Git:** aprovar homologação/merge do PR #3 ou a estratégia de port seletivo antes de abrir a implementação da Fase 2.

Enquanto essas decisões estiverem abertas, a Fase 2 pode detalhar migrations e protótipos de contrato em ambiente descartável, mas não deve executar migration nem alterar comportamento operacional.
