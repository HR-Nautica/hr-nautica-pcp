# HR Náutica — Registro de decisões abertas

Nenhum item abaixo autoriza que o agente escolha a regra sem aprovação. Ao implementar, citar a decisão aprovada e atualizar este arquivo.

## D-001 — Quando consumir bruto e bucha na OP de usinagem?

- **Comportamento atual verificado:** API de OP manual de hélices consome bruto ao criar. As lógicas de bucha e outros rastreios ainda precisam ser auditadas integralmente.
- **Nova intenção expressa:** “Criar OP é só pra acompanhar a produção.”
- **Opções de negócio:** (A) consumo ao criar; (B) reserva ao criar + consumo ao iniciar; (C) consumo ao iniciar sem reserva; (D) movimento manual apontado na execução.
- **Critérios para decidir:** quando o estoque deixa fisicamente o almoxarifado, se reserva existe, o que acontece em cancelamento, edição, parcial e falta de insumo.
- **Status:** PENDENTE; preservar produção atual até instrução explícita.

## D-002 — Entradas previstas do Excel versus OPs ativas

- A planilha de necessidade pode conter `Entradas previstas`; o V.I.N.I. também considera OPs ativas.
- É necessário determinar se representam o mesmo fornecimento, itens diferentes ou períodos distintos.
- **Status:** PENDENTE; evitar dupla contagem e não substituir uma pela outra por suposição.

## D-003 — Parâmetros de planejamento

- Horizonte mensal da média, cobertura-alvo, arredondamento, regra por família, saldo negativo e override manual.
- A planilha real fornecia média mensal explícita; sua lógica deve ser preservada até acordo sobre fórmula central.
- **Status:** PENDENTE para revisão geral; preservar valores oficiais sem recálculo arbitrário.

## D-004 — Escopo de importação

- Determinar quais abas/planilhas atualizam cada categoria e se relatórios diferentes são snapshots completos ou parciais.
- `saidas previstas.xls` pode conter apenas um subconjunto de SKUs; não o tratar como estoque total.
- **Status:** PENDENTE para publicação de pipeline unificado.

## D-005 — Papéis/permissões e modificação de parâmetros

- Quem pode importar, editar catálogo, definir parâmetro de simulação global, aprovar ajuste e criar/cancelar OP.
- **Status:** preservar permissões atuais até política aprovada.

## D-006 — Análise, apontamento por etapa e fracionamento de OP

- **Diretriz registrada em 05/11/2026:** abrir OP pela Análise, exibindo produto pai, BOM, estoque/disponibilidade por item e etapas concluídas/pendentes; registrar peças aprovadas para próxima etapa e separar as demais entre refugo e estoque temporário.
- **Fracionamento solicitado:** subordens vinculadas à ordem original; exemplos `1` → `1.1` ou `1A` → `1B`.
- **Status:** direção funcional aprovada pelo pedido do usuário; implementação ainda não iniciada. PENDENTES: padrão de numeração, gatilhos/destinos que geram subordem, liberação do temporário, fórmula de disponibilidade, permissões e eventos de movimentação. D-001 permanece aberta.
- **Referência:** [Fluxo de Análise e Ordens de Produção](production-analysis-orders-flow.md).
