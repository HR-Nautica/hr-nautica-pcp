# HR Náutica ERP 2.0 — Fase 1B: decisões e preparação da base

**Status:** proposta arquitetural; nenhuma decisão abaixo está aprovada e este documento não autoriza código funcional, migration, banco, merge ou deploy.

**Referência:** [blueprint da Fase 1](hr-erp-2.0-fase-1-blueprint.md), copiado fielmente do worktree do PR #3 em 2026-10-26.

## 1. Situação preservada

| Worktree | Branch / SHA | Estado local observado | Preservação |
|---|---|---|---|
| `C:\Users\estagiario02\Desktop\hr-nautica-pcp` | `feat/vini-planejamento-integrado` / `1c78bac` | `Iniciar PCP.bat` removido e arquivos locais não rastreados, incluindo o blueprint original | Não alterado |
| `C:\Users\estagiario02\Desktop\hr-nautica-pcp-p0` | `fix/p0-state-write-protection` / `062ab5d` | P0 local extenso: mudanças em API/UI/testes e novas rotas de inventário, Buchas, rastreio e política de escrita | Não alterado |

O SHA de P0 é a base commitada, mas a implementação P0 efetiva para homologação é o conjunto local não versionado no segundo worktree. O PR #3 não foi transportado: ele segue três commits à frente de P0 e altera principalmente V.I.N.I., importação, árvore e testes.

## 2. Compatibilidade do modelo alvo com P0

| Contrato/P0 verificado | Compatibilidade com Cadastro Mestre | Condição |
|---|---|---|
| `/api/inventory` para materiais e movimentos | Compatível | Item mestre não pode substituir `hrn_materiais` nem criar movimento nesta fase |
| `/api/buchas/stock`, entradas, transições e saídas | Compatível | Bucha deve receber identidade estável sem alterar a semântica de lote, saldo ou `eventKey` |
| `/api/production-tracking/reconcile` | Compatível | Manter `sourceId`, `importId`, CAS e segregação de OP manual |
| `/api/production-ops` | Compatível com ressalva | Não tocar no consumo de bruto na criação antes de D-001 |
| `/api/fundicao-ops` e `/api/raw-stock` | Compatível | Conclusão de fundição continua creditando bruto uma única vez |
| Política P0 de escrita genérica | Compatível e obrigatória | F2A deve usar nova API/tabelas, nunca liberar `hrn_*` protegido |
| Snapshots `hrn_earv_*`, `hrn_vini_*` | Compatível como fonte de migração | Não os reinterpretar como ledger nem sobrescrever sem pipeline aprovado |

Incompatibilidades relevantes para iniciar F2A:

1. Não existe ainda tabela/API de item mestre; portanto F2A exige migration aditiva futura e API própria, sem reutilizar escrita genérica.
2. Os catálogos atuais continuam agregados JSON e alguns vínculos usam nome/texto; backfill precisa fila de colisões, não associação aproximada.
3. O P0 protege operações e ledger, mas catálogos continuam com PUT genérico permitido. F2A não deve ampliar essa permissão para a nova identidade.
4. O schema atual tem apenas papel `admin`; papéis específicos são decisão de política, não pré-requisito técnico para criar a base restrita inicialmente a administrador.

Não há incompatibilidade que exija refatorar P0 antes de desenhar F2A. Há bloqueios para qualquer corte de escrita, migração de saldo, BOM, consumo ou planejamento.

## 3. Matriz de decisões

### D-001 — Reserva e consumo físico de brutos e buchas

- **Situação:** pendente.
- **Comportamento comprovado:** OP manual de hélice consome bruto na criação e estorna no cancelamento/ajuste; P0 preserva essa regra. Buchas têm entradas/transições/saídas transacionais, mas OP/consumo de bucha ainda não é fluxo oficial.
- **Proposta recomendada:** manter o comportamento vigente intacto. Modelar futuramente reserva e consumo como eventos distintos, sem ativá-los até decisão operacional sobre início, parcial, cancelamento e estorno.
- **Modelo de dados:** reserva opcional e movimento idempotente vinculados à OP; nenhum saldo derivado da OP por si só.
- **Impacto:** OP manual, Buchas, bruto, Fundição e Planejamento.
- **Risco:** bloqueador; antecipar ou atrasar consumo altera físico e pode duplicar/estornar indevidamente.
- **Validação humana:** obrigatória, com responsável de operação/almoxarifado.

### D-002 — Necessidades, entradas previstas e OPs

- **Situação:** pendente.
- **Comportamento comprovado:** V.I.N.I. mantém necessidades/entradas em chaves separadas e considera OP de componente como projeção; não há regra aprovada contra dupla contagem.
- **Proposta recomendada:** persistir natureza e período separadamente; planejador só deduplica por chave de suprimento explicitamente aprovada, nunca por SKU/nome.
- **Modelo de dados:** snapshots de demanda e entrada prevista; projeção de OP com origem e período.
- **Impacto:** V.I.N.I., análise de hélices, importações e criação sugerida de OP.
- **Risco:** bloqueador de cálculo; dupla contagem reduz necessidade artificialmente.
- **Validação humana:** obrigatória, por PCP/comercial.

### D-003 — Fórmulas e parâmetros de planejamento

- **Situação:** pendente.
- **Comportamento comprovado:** existem cobertura-alvo configurada e médias vindas de planilha; parte do código ainda calcula média por horizonte fixo em caminhos legados.
- **Proposta recomendada:** preservar coluna/horizonte recebido e cálculo corrente por família; versionar fórmula e parâmetros antes de centralizar.
- **Modelo de dados:** versão de fórmula, fonte de média, horizonte e cenário; sem gravar resultado como físico.
- **Impacto:** V.I.N.I., análise de hélices, Fundição e futuro planejamento de Buchas.
- **Risco:** alto; recálculo silencioso muda prioridade/compra.
- **Validação humana:** obrigatória, por PCP.

### D-004 — Snapshots completos e parciais

- **Situação:** pendente.
- **Comportamento comprovado:** P0 permite snapshots de componentes em chaves distintas; `saidas previstas.xls` pode ser subconjunto e Tiny atual é fachada offline.
- **Proposta recomendada:** todo dataset declara família, local, natureza, completude e referência. Somente snapshot completo pode retirar ausentes de seu próprio escopo.
- **Modelo de dados:** lote/dataset de importação, checksum, status, escopo e linhas imutáveis.
- **Impacto:** sincronização, V.I.N.I., Central de Estoque e Catálogo Mestre.
- **Risco:** alto; parcial tratado como completo zera posições reais.
- **Validação humana:** obrigatória, por dono de cada planilha/Tiny.

### D-005 — Papéis e permissões

- **Situação:** pendente.
- **Comportamento comprovado:** autenticação atual só possui `admin`; P0 já exige sessão/CSRF/proxy nas mutações oficiais.
- **Proposta recomendada:** manter `admin` como único papel na F2A; aprovar separadamente permissões de importar, publicar snapshot/BOM, trocar fonte, ajustar físico e operar OP.
- **Modelo de dados:** futura matriz de permissões por ação, não por tela.
- **Impacto:** autenticação, APIs de domínio e auditoria.
- **Risco:** alto se o catálogo conceder indiretamente permissão sobre estoque.
- **Validação humana:** obrigatória, por gestão.

### D-006 — Identidade mestre e aliases de SKU

- **Situação:** proposta.
- **Comportamento comprovado:** SKU aparece em catálogos, snapshots e OPs; há vínculos por código e também por nome/coquilha.
- **Proposta recomendada:** UUID imutável como identidade; SKU canônico único entre ativos; `item_codigo` com namespace Tiny/legado/fornecedor, vigência e normalização conservadora.
- **Modelo de dados:** `item` + `item_codigo`; colisões bloqueiam publicação e entram em conciliação.
- **Impacto:** quatro catálogos, importações, rastreio e OPs futuras.
- **Risco:** alto; alias mal resolvido pode apontar saldo/OP para item errado.
- **Validação humana:** obrigatória para regra de unicidade global e para cada colisão.

### D-007 — Depósitos versus etapas produtivas

- **Situação:** pendente.
- **Comportamento comprovado:** Buchas expõem Usinagem, Retrabalho, Vulcanização e Estoque Final; rastreio e Fundição possuem etapas sem catálogo de locais físicos.
- **Proposta recomendada:** etapa é operação; local de estoque só existe se houver custódia e contagem física independentes. Iniciar com Estoque Final de Buchas e Estoque de Brutos; demais locais exigem lista aprovada.
- **Modelo de dados:** `local_estoque` separado de roteiro/operação.
- **Impacto:** Buchas, Fundição, Central de Estoque e planejamento.
- **Risco:** alto; tratar etapa como depósito cria saldo físico fictício.
- **Validação humana:** obrigatória, por produção e almoxarifado.

### D-008 — Versionamento e publicação de BOM

- **Situação:** proposta.
- **Comportamento comprovado:** árvore de componentes é snapshot importado; OP de componentes guarda explosão/etapas próprias.
- **Proposta recomendada:** importar em staging, adotar uma única versão 1 publicada após conciliação; edição cria rascunho e publicação nova versão. OP conserva versão/explosão de abertura.
- **Modelo de dados:** BOM, versão, linhas, vigência, origem e aprovador.
- **Impacto:** Componentes, V.I.N.I., OPs e importação de fabricação.
- **Risco:** bloqueador para edição; sobrescrever estrutura altera histórico e necessidade.
- **Validação humana:** obrigatória, por engenharia/PCP.

### D-009 — Transferência de autoridade Tiny/ERP

- **Situação:** proposta.
- **Comportamento comprovado:** acabados/componentes leem planilha; Buchas e brutos têm P0 transacional. Tiny não está homologado como integração direta.
- **Proposta recomendada:** política única por item/local com corte datado, conciliação assinada e permissão específica. Defaults: acabado/componente por snapshot; Bucha/bruto por ledger.
- **Modelo de dados:** política vigente, referência de corte e auditoria; nunca mistura de fontes no mesmo intervalo.
- **Impacto:** Central de Estoque, importação, inventário e todos os planejadores.
- **Risco:** bloqueador; duas autoridades causam dupla contagem.
- **Validação humana:** obrigatória, por gestão de estoque.

### D-010 — Lotes e OPs de Buchas

- **Situação:** pendente.
- **Comportamento comprovado:** P0 trata entrada/lote, transição parcial, saída e saldo final como fluxos oficiais; `hrn_buchas_ops` está bloqueado no genérico e não possui API oficial.
- **Proposta recomendada:** considerar entrada/lote a unidade física rastreável e OP uma ordem de execução separada, vinculável opcionalmente. Não inferir OP da entrada nem baixar saída pelo avanço da OP.
- **Modelo de dados:** vínculo explícito `op_bucha_lote`, sem alterar lotes legados.
- **Impacto:** Buchas, estoque, rastreio e futura BOM.
- **Risco:** bloqueador para migrar OPs de Buchas; fusão implícita perde rastreabilidade.
- **Validação humana:** obrigatória, por produção de Buchas.

### D-011 — Integração futura do PR #3

- **Situação:** pendente.
- **Comportamento comprovado:** PR #3 está em `1c78bac`, separado de P0, e altera V.I.N.I., árvore, pré-validação e testes; não está no worktree P0.
- **Proposta recomendada:** homologar P0 local isoladamente; decidir merge do PR #3 em `main` ou port seletivo posterior baseado em diff revisado. F2A não depende do código do PR #3.
- **Modelo de dados:** nenhum nesta fase.
- **Impacto:** V.I.N.I., importações, testes e ordem de integração Git.
- **Risco:** alto se mudanças forem copiadas sobre P0 sem rebase/revisão de conflitos.
- **Validação humana:** obrigatória, por responsável do repositório.

## 4. Aprovações operacionais necessárias

Antes de F2B ou de qualquer alteração de saldo/planejamento/BOM, exigem aprovação explícita: D-001, D-002, D-003, D-004, D-005, D-007, D-008, D-009 e D-010. D-006 é necessária antes do backfill produtivo; D-011 é necessária antes de integrar os dois trilhos Git.

F2A pode ser detalhada sem essas aprovações, desde que permaneça estritamente aditiva e não altere catálogo, saldo, snapshot, OP ou permissão vigente.

## 5. Fase 2 — plano de entregas

### F2A — identidade mestre e aliases

Escopo: migrations aditivas de `item` e `item_codigo`, API de leitura/escrita exclusiva, normalização conservadora, auditoria, CAS e relatório de colisões; sem backfill automático e sem trocar consumidores.

Aceite:

- UUID, SKU canônico, unidade e estado possuem constraints; alias respeita namespace, unicidade e vigência.
- SKU desconhecido/ambíguo não cria item nem altera snapshot.
- CAS, autorização atual, auditoria, idempotência e 409 são testados em PostgreSQL descartável.
- Nenhuma chave operacional P0 é liberada no endpoint genérico.
- Rollback de aplicação e migration dry-run estão documentados.

### F2B — cadastro e vínculos das quatro famílias

Escopo: extensões de catálogo para hélice, bucha, componente e bruto/coquilha; vínculos explícitos; tela somente após contrato aprovado. Sem saldo, consumo ou BOM editável.

Aceite:

- Um item pode ter apenas extensão coerente com sua família/tipo.
- Relações bruto/bucha/coquilha usam IDs, não descrição.
- Catálogos legados são legíveis durante dual-read; colisões vão para fila.
- Criar/editar catálogo não movimenta estoque, não cria OP e não publica snapshot.

### F2C — política de fonte oficial por item/local

Escopo: locais, política de autoridade e leitura consolidada; inicialmente read-only, com defaults que reproduzem P0.

Aceite:

- Uma única política vigente por item/local; não há soma Tiny+ERP.
- Buchas e brutos continuam lendo APIs P0 oficiais; acabado/componente continuam snapshots.
- Troca de fonte é bloqueada até D-009 e não existe caminho de UI implícito.
- Central read-only diferencia físico, demanda, entrada prevista e OP ativa.

### F2D — migração gradual dos catálogos existentes

Escopo: backfill idempotente e conciliado de `hrn_modelos`, `hrn_buchas`, fundição/coquilhas e árvore; adaptadores dual-read sem corte de escrita.

Aceite:

- Relatório antes/depois de contagem, SKU, alias, órfão e colisão.
- Nenhum registro legado, OP, lote, movimento ou snapshot é apagado/alterado.
- Reexecução não duplica item/alias/vínculo.
- Amostra operacional aprovada comprova que cada catálogo antigo resolve para o mesmo item mestre ou fica explicitamente pendente.

### F2E — validação, reconciliação e homologação

Escopo: comparação paralela, testes de regressão, homologação e decisão de cutover. Sem retirada de legado no mesmo marco.

Aceite:

- `npm run test:ci`, build e integrações PostgreSQL P0/F2 passam no SHA candidato.
- Concorrência, resposta perdida, 409, reimportação e rollback são exercitados.
- Conciliação de catálogo/snapshot/ledger sem divergência inexplicada.
- Aprovação operacional registrada e plano de rollback aprovado.

## 6. Porta de entrada para F2A

F2A só pode iniciar quando todos os itens abaixo forem verdadeiros:

1. O worktree P0 e suas alterações locais forem preservados em branch/commit autorizado ou snapshot verificável pelo responsável.
2. A decisão D-006 confirmar a regra de SKU canônico e namespaces de alias.
3. O escopo de F2A estiver limitado à identidade/alias, sem catálogo visual, fonte de saldo, backfill produtivo ou mudança de P0.
4. Houver desenho de migration aditiva com dry-run, constraints, rollback e estratégia de dados preexistentes.
5. A API nova respeitar autenticação/CSRF, CAS, auditoria e a política P0 de escrita genérica.
6. O plano de testes incluir PostgreSQL descartável e não depender de PR #3.
7. D-011 tiver pelo menos uma decisão de processo: manter PR #3 isolado até depois de F2A, ou aprovar sua integração antes da abertura da branch de F2A.

Enquanto qualquer critério falhar, a continuidade segura é somente refinamento documental e preparação de fixtures, sem iniciar implementação.
