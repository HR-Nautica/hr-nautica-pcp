---
trigger: model_decision
description: "Sempre que alterar funcionalidades, navegação de ERP, cadastro, estoque, planejamento, produção, OP, catálogo ou integrações da HR Náutica."
---

# Regras permanentes de domínio HR Náutica

## Glossário não intercambiável

- **Catálogo**: produto/SKU, atributos técnicos e relações de fabricação; não é lançamento de saldo.
- **Snapshot Excel**: retrato datado que substitui exclusivamente a posição da categoria designada.
- **Estoque físico**: saldo oficial da fonte definida por família.
- **Movimentação**: evento confirmado que altera saldo interno com razão, autor, data e vínculo operacional.
- **OP**: registro de execução e rastreio; abertura/conclusão não define, sozinha, movimentação de produto final.
- **Em andamento / projetado / virtual**: quantidade usada em cálculos de planejamento; não saldo físico.
- **Simulação**: cenário editável para testar cálculo, nunca uma alteração silenciosa de saldo/OP.
- **V.I.N.I.**: planejador da família Componentes com base nas fontes de estoque centralizadas.

## Semântica das famílias

Hélices usinadas e componentes: físico pelo Excel oficial. Buchas e fundidos/brutos: físico por ledger/ERP. Central de Estoque agrega, identifica fonte e hora da atualização; não redistribui uma linha Excel como movimentação interna de bucha/bruto.

Cada família deve oferecer `Catálogo → Planejamento → OPs`, com UX consistente e fluxo de fabricação próprio. A ligação entre hélices, buchas e brutos deve ser explícita via código e quantidade unitária.

## Restrições

- Não deduzir classificações só por prefixos de SKU sem cadastro/mapeamento validado.
- Não somar entradas previstas de Excel e OPs ativas sem regra de deduplicação aprovada.
- Não recalcular uma média mensal explícita do arquivo usando horizonte presumido.
- Não atualizar dado oficial ao simular.
- Não permitir que importação delete cadastro/OP/histórico/movimentação.
- **Ponto aberto:** evento que consome bruto e bucha na OP de hélices. Código existente e intenção nova divergem; decisão explícita é requisito antes de mudar.
- Não renomear status técnicos ou rotas sem mapear transições/permissões existentes.

## Saída esperada de análise de impacto

Produza `Origem → Entidade → Evento → Persistência → Leituras → Visualizações`, marque o que existe vs o que é proposta, e enumere decisões não resolvidas antes de alterar domínio.
