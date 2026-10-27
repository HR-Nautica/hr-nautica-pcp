---
trigger: model_decision
description: "Direção visual obrigatória para construir, refatorar, revisar ou padronizar qualquer tela, componente, CSS, tabela, formulário, dashboard ou fluxo de navegação no ERP HR Náutica. Estética premium inspirada no Zion, com UX operacional simples e consistente."
---

# HR Náutica — Guia de direção visual e UX

## Missão

A HR Náutica deve parecer um **software industrial premium, claro, consistente e confiável**. Referência: qualidade de acabamento do Zion (dark mode, superfície grafite, azul criterioso, tipografia e espaçamento muito bem controlados), não a estética de landing page cinematográfica.

**Teste mental:** se um operador passa oito horas nesta tela, ela será agradável e fácil de compreender? Se não, simplifique.

## Estado atual e migração

- Comece auditando `public/css/design-system.css` (camada global carregada por último) e `public/css/style.css` (legado).
- Tokens **atualmente existentes**: `--hr-bg: #0a101c`, `--hr-surface-1: #0f1726`, `--hr-surface-2: #131d2d`, `--hr-surface-3: #182437`, `--hr-border: #243247`, `--hr-text-primary: #f5f7fa`, `--hr-text-secondary: #a5b3c5`, `--hr-accent: #3b82f6`.
- Use esses tokens existentes em novas interfaces. Ajustes globais de paleta/tipografia/raios só com decisão aprovada e verificação de regressões.
- O CSS atual já define `--hr-sidebar-width: 232px`, `--hr-control-height: 36px`, `--hr-table-row-height: 52px`, Inter e tokens de estados. **Reaproveite antes de criar.**
- Evite empilhar mais regras globais `!important`. Transforme casos legados gradualmente em classes com escopo sem quebrar páginas antigas.

## Linguagem visual obrigatória

**Clima:** navy/grafite quase preto; superfícies levemente diferenciadas, linhas finas, azul como acento de interação, zero excesso de efeitos.

**Tipografia:** Inter como base; títulos 24–28px, seções 16–20px, corpo 13–15px conforme densidade, microtextos nunca ilegíveis. Use pesos e contraste em vez de caixa alta em todo lugar. Números importantes com `font-variant-numeric: tabular-nums`.

**Espaçamento:** escala de 4/8/12/16/24/32px; containers previsíveis; respiro entre blocos sem desperdiçar espaço em tabelas operacionais.

**Geometria:** bordas de 1px sutis, raios coerentes (6–14px), sombras discretas, cards poucos e informativos. Uma superfície só deve ter destaque quando for relevante.

**Ícones:** linha fina e um conjunto coerente. Usar SVG existente quando possível. Não usar emojis como substituto de iconografia no ERP.

**Motion:** 120–180ms em hover, focus, abertura de drawer e feedback; animar opacity/transform somente quando útil. Respeitar `prefers-reduced-motion`. Sem animações contínuas em tabelas, sem partículas em rotinas de produção, sem movimento em dados críticos.

## Esqueleto de uma página padrão

1. **Contexto:** breadcrumb opcional, nome da família, título, descrição em uma linha, única ação principal à direita.
2. **Resumo:** 2–4 indicadores relevantes, nunca cards redundantes. Preferir indicadores compactos.
3. **Controle:** busca e filtros padronizados; contador de resultados; ordenação previsível; botão de limpar filtros quando fizer sentido.
4. **Conteúdo:** tabela ou lista principal; títulos claros; ações por linha agrupadas; dados críticos visíveis; conteúdo técnico longo no detalhe.
5. **Detalhe:** painel lateral/drawer ou modal acessível, reutilizando o mesmo padrão em todo o sistema.
6. **Estado:** skeleton/carregando, vazio, sem resultado, sem permissão, offline, erro, conflito de gravação e sucesso com mensagens específicas.

Exemplo de nomenclatura uniforme nas famílias: `Catálogo | Planejamento | Ordens de Produção`. Dentro de OP, usar `Em aberto | Em andamento | Concluídas | Canceladas`, mapeando para estados técnicos existentes e sem inventar novas transições de domínio.

## Padrões por tela

### Catálogo

- Foco em SKU/nome/código de referência e relações técnicas relevantes.
- Busca clara, filtros consistentes, tabela principal, detalhes editáveis apenas mediante permissão.
- Ações como editar, vincular e desativar devem ser previsíveis e reversíveis quando aplicável.

### Planejamento

- Separar claramente **estoque físico oficial**, **OPs em andamento/projeção**, **entradas**, **saídas**, **média**, **cobertura** e **necessidade sugerida**.
- Campos de simulação nunca editam saldos reais sem fluxo explícito de ajuste/autorização.
- Fórmulas e origem dos dados devem estar acessíveis; exibir data da última sincronização.
- Dar visibilidade a cenários e exceções (estoque negativo, falta de informação, consumo alto) sem confundir cores com prioridade comercial.

### OPs / Rastreio

- Agrupar por status operacional; número da OP, item, quantidade, etapa, responsável e datas legíveis.
- Fluxo de etapas linear e fácil de percorrer; eventos de histórico cronológicos.
- Confirmações de ações irreversíveis; feedback somente após confirmação do backend.
- Criar/acompanhar OP **não implica** alterar estoque físico em tarefa visual. O comportamento de consumo de insumos depende da regra existente/autorizada.

### Central de Estoque

- Uma visão unificada, com origem do saldo por família explicitamente identificada: Excel para hélices usinadas/componentes, movimentos de ERP para buchas/brutos.
- Importações exibem arquivo, data, categorias afetadas, pré-visualização, inconsistências e resultado.
- Não promover saldo projetado a físico; não misturar fontes nem substituir valores por conveniência visual.

## Reduções de complexidade

- Remover decoração antes de remover informações importantes.
- Usar uma ação primária por tela; ações secundárias discretas.
- Preferir uma tabela bem projetada a cinco cards competindo pela atenção.
- Máximo de 2 níveis de hierarquia visual dentro de cards comuns; detalhes avançados sob demanda.
- Textos orientados à operação: `Nova OP`, `Importar planilha`, `Ver histórico`, `Simular necessidade`, `Estoque insuficiente`.
- Estados de cor: azul = ação/seleção; verde = concluído/confirmado; amarelo = atenção; vermelho = erro/risco. Não pintar toda a interface com cores de status.

## Design responsivo e acessibilidade

- Desktop: painel lateral e conteúdo central bem distribuídos; não esticar linhas de leitura desnecessariamente.
- Tablet: filtros reorganizados, sem sobreposição entre título, KPIs e ações.
- Mobile: navegação recolhível; ações acessíveis; tabelas com scroll horizontal explícito ou versão resumida; sem reduzir fontes até ficar ilegível.
- Foco visível; labels reais; teclado; contraste WCAG AA para texto; não transmitir status apenas por cor; `aria-label` em ações com ícone; modais com foco correto.
- Formulários mostram unidades, valores padrão, obrigatoriedade, erros por campo e confirmação; não confiar em placeholder como label.

## Anti-padrões proibidos

- Novo degradê azul/roxo por tela, bordas luminosas em todo card, sombras exageradas, neon por padrão.
- Gradientes animados, partículas, grid pulsante ou parallax em tabelas de estoque, planejamento e OP.
- Substituir tabelas por cards gigantes só para parecer moderno.
- Criar novas variantes de botão, input, badge ou modal antes de consultar o design system.
- Reescrever `index.html` inteiro, renomear IDs de eventos ou incluir framework novo apenas para uniformizar estética.
- Enfeitar estados de erro ou esconder avisos de integridade para preservar a aparência.

## Checklist do Visual Director

Antes de aprovar uma alteração visual, marcar explicitamente:

- [ ] A tela parece parte do mesmo produto que as demais.
- [ ] Usa tokens globais e padrões existentes; não introduz CSS redundante.
- [ ] Página organiza contexto, ação primária, filtros, conteúdo e detalhes.
- [ ] Hierarquia de tipografia, espaços, alinhamento e números está consistente.
- [ ] Tabela não corta dados essenciais, cabeçalhos, menus ou ações.
- [ ] Dados físicos/projetados são claramente diferenciados.
- [ ] Loading, vazio, erro, conflito, offline e sucesso foram considerados.
- [ ] Teclado, contraste, mobile/tablet e reduced-motion foram inspecionados.
- [ ] IDs, scripts, rotas, permissões e regras de estoque/OP não sofreram regressão.
- [ ] `npm run test:ci` e `npm run build` passaram (ou pendências foram declaradas).
- [ ] Quando houver navegador disponível, capturas desktop/mobile e comparação antes/depois foram realizadas.

Se um item não puder ser verificado, documentar como pendência; **não declarar aprovação visual total apenas porque compilou**.
