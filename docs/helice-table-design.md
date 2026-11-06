# Refinamento da tabela de análise — 06/11/2026

Apresentação apenas: sem alteração de API, saldo, fórmulas, OP, autorização ou banco.

- Visão inicial Essenciais: nove colunas. SKU aparece junto do produto quando sua coluna está oculta. Todas restaura as 15 colunas na ordem original. Controle individual preserva Prioridade e Produto. Preferência fica na URL, não é dado oficial nem configuração global.
- Prioridade e Produto fixos na rolagem horizontal em desktop; cabeçalho fixo na rolagem vertical. Em tela estreita, desativa fixação das células para não ocupar toda a largura. Região tem rolagem própria.
- Parâmetros de cálculo ficam em seção expansível; meta e horizonte continuam identificados.
- Alertas usam exclusivamente o dado e os parâmetros existentes: físico ausente → saldo não informado; físico ≤ 0 → sem estoque/negativo; Estoque 1 < 0 → vendido acima do físico; fontes incompletas → cobertura não informada; média zero → sem consumo médio; cobertura virtual abaixo dos meses-alvo → abaixo da meta; demais → cobertura na meta. A regra mensal zero não é interpretada como risco de ruptura.
- Situações exclusivas evitam dupla contagem nos filtros. Os totais de cada situação referem-se ao conjunto completo; busca e filtro de situação se combinam. Prioridade global continua inalterada ao filtrar.
- Alertas usam texto, cor e sinal na borda; números negativos ficam destacados. Coluna oculta que estava sendo ordenada retorna à prioridade para não haver ordenação invisível.

Arquivos: `public/js/helice-analysis-ui.js`, `public/js/helice-table-view.js`, `public/css/new-erp.css`, `index.html`, testes de classificação/visibilidade e inclusão na suíte CI.

Validação: testes de situações, limites da meta, ausência, média zero e não mutação; teste manual local com dados fictícios de seleção de colunas, presets, recarga da preferência, filtro de sem estoque e rolagem em largura 390. Testes gerais e build. Sem teste transacional adicional porque nenhuma escrita de domínio mudou.

Revisão Visual/Quality: acabamento e dados coerentes com o produto; risco restrito à apresentação. Rollback: reverter o commit, preservando todos os dados. A URL com preferência de colunas é ignorada pela versão anterior.
