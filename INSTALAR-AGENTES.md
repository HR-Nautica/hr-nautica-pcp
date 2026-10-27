# Instalar o sistema de agentes na HR Náutica

1. Extraia o ZIP **na raiz** do repositório `hr-nautica-pcp`, preservando pastas ocultas `.agents/`.
2. Faça uma revisão do diff local, especialmente se já existir `AGENTS.md` ou `.agents/` (o pacote os substitui/expande; não sobrescreva personalizações sem comparar).
3. Abra o workspace no Antigravity, leia `AGENTS.md` e peça que os agentes auditem o sistema **sem editar** na primeira rodada.
4. Use o comando de revisão e testes na branch de desenvolvimento; não mescle PRs nem publique no Ubuntu apenas por instalar diretrizes.

## Prompt inicial sugerido

> Leia `AGENTS.md`, as regras em `.agents/rules/` e os papéis em `.agents/agents/`. Atue como `hr-erp-architect`, solicitando revisões de `hr-stock-guardian`, `hr-production-engineer`, `hr-visual-director` e `hr-quality-guardian` quando pertinentes. Audite o ERP atual e compare com `docs/hr-architecture-blueprint.md`. Entregue um mapa `implementado / proposto / pendente`, inconsistências prioritárias, o contrato de fonte de verdade da Central de Estoque e uma sequência incremental para homologação. Não altere código, banco, migrations, PRs ou produção sem autorização explícita.

## Arquivos

- `AGENTS.md`: regras globais permanentes e roteamento para especialistas.
- `.agents/agents/hr-erp-architect.md`: coordenação e arquitetura.
- `.agents/agents/hr-stock-guardian.md`: fontes de saldo e importação.
- `.agents/agents/hr-production-engineer.md`: fabricação, planejamento e OPs.
- `.agents/agents/hr-visual-director.md`: UI/UX inspirada no Zion.
- `.agents/agents/hr-quality-guardian.md`: segurança, CI e deploy.
- `.agents/rules/*`: contratos não negociáveis do projeto.
- `docs/hr-architecture-blueprint.md`: design-alvo ainda não implementado.
- `docs/hr-open-decisions.md`: diferenças de regra pendentes de decisão.

**Importante:** nomes/cabeçalhos de agentes e regras seguem o padrão do pacote anterior. Se a versão do Antigravity usar outra convenção para ativação automática, adapte a configuração à documentação da versão instalada; os arquivos continuam válidos como instruções de projeto.
