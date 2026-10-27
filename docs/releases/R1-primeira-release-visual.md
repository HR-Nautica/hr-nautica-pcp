# R1 — Primeira release visual

## Escopo consolidado

- P0: proteção de escrita do estado remoto e tratamento de concorrência.
- F2A: catálogo mestre, serviços, APIs e migrations V003–V004.
- F2B: identidade estável de hélices, vínculos relacionais, API e interface de identidade do produto, incluindo a migration V005.
- V.I.N.I.: planejamento de componentes, confirmação de OPs e pré-validação integral dos datasets antes da primeira gravação.
- Governança: constituição do ERP, regras permanentes e decisões abertas versionadas no repositório.

## Contrato de dados preservado

- Hélices usinadas e componentes continuam usando snapshots Excel como fonte do estoque físico.
- Buchas e brutos continuam usando movimentações transacionais do ERP.
- OP ativa, projeção, simulação e estoque físico permanecem conceitos separados.
- Concluir OP de hélice usinada não credita estoque físico.
- A regra vigente de consumo de bruto na criação da OP manual não foi alterada.

## Banco operacional

As migrations V003–V005 fazem parte do pacote, mas não foram aplicadas ao banco operacional. Operações dependentes dessas estruturas não devem ser habilitadas até a validação controlada do destino. O pipeline de deploy não executa migrations automaticamente.

## Validação local em 27/10/2026

- `npm.cmd run test:ci`: aprovado, 83 testes.
- `npm.cmd run build`: aprovado.
- Testes PostgreSQL descartáveis: não executados porque o Docker Desktop estava indisponível.
- Produção, push, deploy e migrations operacionais: não executados.

## Publicação

O fluxo oficial permanece GitHub Actions → teste → imagem Docker imutável por SHA → runner interno → validação de `/healthz` e `/release.json` → Caddy em `http://192.168.100.180:8444`.

Antes da publicação, executar os testes PostgreSQL direcionados com Docker disponível, confirmar o estado das migrations no destino por procedimento somente leitura e obter autorização explícita para push/deploy.

## Rollback

O script `scripts/deploy/deploy-production.sh` preserva a imagem anterior e reverte quando a validação do SHA/health falha. O procedimento manual está documentado em `docs/deploy-interno.md`.
