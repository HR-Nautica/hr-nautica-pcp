# HR Náutica — Constituição permanente do ERP e orquestração de agentes

> Este projeto é um **ERP/PCP industrial em operação**. Cada alteração deve preservar os dados e fluxos reais. A estética deve alcançar a qualidade do Zion, mas a integridade das operações prevalece sobre o visual.

## Leia isto antes de começar

1. Identifique a tarefa, o módulo, o ator e as tabelas/chaves/API envolvidos.
2. Leia as regras pertinentes em `.agents/rules/` antes de editar.
3. Consulte o(s) especialista(s) correspondente(s) em `.agents/agents/` e produza um plano breve quando houver impacto de domínio, integração, navegação ou banco.
4. Inspecione o código atual: **documentos de proposta não significam funcionalidades já implementadas**.
5. Implemente de forma incremental, com testes, evidências e sem publicação automática de mudanças além do que o usuário autorizou.

## Orquestração por especialista

| Tipo de alteração | Especialista principal | Revisão cruzada obrigatória |
|---|---|---|
| Arquitetura, módulos, banco e contratos | `hr-erp-architect.md` | Stock/Production conforme o impacto; Quality |
| Estoques, importações, inventário e saldos | `hr-stock-guardian.md` | Architect + Quality |
| Planejamento, catálogo, OPs, fundição e buchas | `hr-production-engineer.md` | Stock + Quality |
| UX/UI, CSS, tabelas, menus e formulários | `hr-visual-director.md` | Architect, se houver alteração de fluxo |
| Testes, conflitos, migrations e releases | `hr-quality-guardian.md` | Especialista do domínio afetado |

Se o ambiente não suportar subagentes automáticos, use os arquivos como **papéis de revisão** no agente principal. O responsável final pela tarefa continua verificando todas as invariantes.

## Referências normativas

- `.agents/rules/hr-domain.md` — modelo de domínio e fontes oficiais.
- `.agents/rules/hr-data-integrity.md` — contratos de dados, importação, transações, concorrência.
- `.agents/rules/hr-production-flow.md` — semântica de catálogo, planejamento e OP.
- `.agents/rules/hr-interface.md` — direção visual/UX inspirada em Zion.
- `.agents/rules/hr-delivery.md` — ambientes, testes, CI, PR e deploy.
- `docs/hr-architecture-blueprint.md` — **proposta arquitetural** e estratégia incremental, ainda não implantada.
- `docs/hr-open-decisions.md` — decisões de negócio não resolvidas; nunca presumir aprovação.

## Stack e estrutura atual verificadas

- Frontend: Vite, HTML, JavaScript e CSS (não presumir React).
- `index.html` contém app shell e telas; `public/js/` contém os controladores existentes.
- `public/css/style.css` é legado; `public/css/design-system.css` é a camada de tokens visual carregada por último.
- API: Node.js/Express; banco central PostgreSQL 17; sessões/autorização no servidor.
- `server/database.js` concentra lógica relevante de transações de estoque/OP.
- `public/js/remote-storage.js` mantém estado remoto versionado com conflitos; **não tratar localStorage como verdade oficial**.
- **Estado dos PRs muda**: confirmar branch/commit real antes de propor merge; PR #3 foi deixado em homologação na revisão que originou este pacote.

## Produto-alvo (proposta, NÃO migração aprovada)

Uma **Central de Estoque** disponibiliza dados consistentes para quatro famílias:

- **Hélices usinadas**: catálogo → planejador/análise → OPs e rastreio.
- **Buchas**: catálogo → planejador → OPs e estágios de produção.
- **Componentes**: catálogo/árvore → **V.I.N.I.** → OPs de componentes.
- **Hélices fundidas / Brutos**: catálogo/coquilhas → planejamento da fundição → OPs/rastreio.

A Central de Estoque é a visão e a API agregadora; **não é autorização para sobrescrever todos os saldos com Excel**. O domínio de origem prevalece.

## Invariantes: NÃO QUEBRAR

1. **Hélices usinadas e componentes**: estoque físico oficial proveniente de snapshots Excel da categoria correspondente.
2. **Buchas e hélices fundidas/brutos**: estoque físico administrado por movimentações internas do ERP; nunca sobrescrever por importação de Excel.
3. Estoque físico ≠ entradas futuras ≠ OP ativa ≠ reserva ≠ estoque virtual ≠ simulação. Rotular e calcular separadamente.
4. V.I.N.I. é **planejamento de componentes** alimentado pela fonte central; não cria saldo físico nem deve fazer persistência só por renderizar.
5. Concluir OP de usinagem **não aumenta** estoque físico de hélices usinadas; a planilha oficial o determina.
6. Finalizar OP de fundição pode creditar **brutos físicos** pela quantidade produzida, via transação protegida e idempotente.
7. OPs nunca são apagadas por importações; histórico e movimentações devem sobreviver a refresh, substituição de snapshot e refatoração visual.
8. Não inventar fórmula de cobertura, arredondamento, unidade, prioridade, consumo de insumos ou regra comercial. Preservar o cálculo vigente até decisão explícita.
9. A regra vigente no código para OP manual de hélices consome bruto na **criação**; o usuário manifestou intenção de usar OP só como acompanhamento. **É uma decisão pendente**: não mudar momento do consumo sem aprovação e testes transacionais.
10. Multiusuário: sempre considerar concorrência, idempotência, permissões, falha de rede e reconciliação de estado.
11. Alterações de UX/UI não podem mudar saldo, OP, importação, API ou permissões implicitamente.
12. Sem merge, deploy, migrations ou mudanças no servidor de produção sem instrução explícita.

## Contrato de conclusão de tarefa

Toda entrega reporta: contexto e regra afetada; arquivos alterados; comportamento antes/depois; origem do dado; cenários de erro; testes **realmente executados**; impacto no banco e migrations; estado do PR/CI; riscos e decisões abertas. Nunca declarar publicado ou testado sem evidência.
