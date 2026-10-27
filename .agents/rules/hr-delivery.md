---
trigger: model_decision
description: "Aplicar a qualquer alteração de código, dados, migrations, testes, pull requests, infraestrutura ou implantação HR Náutica."
---

# Entrega segura e qualidade

1. Ler `AGENTS.md` e os agentes relacionados ao domínio.
2. Confirmar base/PR/branch reais antes de editar; nunca presumir que PR em homologação já foi mesclado.
3. Planear diff mínimo e registrar o que não será alterado.
4. Antes de editar dados: checar fonte da verdade, impactos cruzados e reversibilidade.
5. Rodar `npm run test:ci` e `npm run build`, além de testes de domínio quando aplicável; integração real com PostgreSQL descartável para mudanças transacionais.
6. Declarar o que foi executado e o que **não** foi testado. Validar UX em resolução ampla e estreita e diferentes estados, quando houver mudança visual.
7. Criar branch/PR; **não fazer merge, deploy, migration, SSH remoto ou push em `main`** sem instrução explícita.
8. Jobs GitHub Actions: `test=success` e `deploy=skipped` para PR é normal. Deploy só é confirmado depois de execução autorizada e SHA da release no runtime.
9. Não tocar n8n, Supabase de outros projetos, Sistema JM, containers/volumes de terceiros ou segredos em `.env`.
10. Resultado: mudanças, arquivos, testes, riscos, decisões pendentes, plano de rollback e endereço do PR se houver.

## Política de revisão

- **Bloqueadores:** estoque errado/duplicado, importação destrutiva, mudança implícita de consumo de insumos, sem rollback para migração crítica, conflito multiusuário ignorado, sucesso falso, quebra de auth.
- **Necessário antes de merge:** contrato de API regressivo, planilha real não reconhecida, cálculo da UI diferente do CSV/export, testes insuficientes do fluxo modificado.
- **Melhoria planejável:** pequenos ajustes cosméticos sem impacto em acessibilidade, dívida técnica não relacionada.
