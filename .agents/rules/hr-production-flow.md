---
trigger: model_decision
description: "Sempre que trabalhar com planejamento PCP, V.I.N.I., capacidade, roteiro de produção, ordens, rastreio, fundição ou buchas."
---

# Semântica operacional e OPs

## Separação obrigatória

`Catálogo` define o produto; `Planejamento` estima necessidade e permite simulação; `OP` acompanha produção; `Movimentação` é o fato que altera estoque interno. Não substituir uma entidade pela outra.

## Propostas padronizadas, não migrations automáticas

- Hélices: catálogo de hélices, planejador e OP de usinagem/rastreio.
- Buchas: catálogo, planejador e OP com estágios da produção real.
- Componentes: catálogo/árvore, planejador **V.I.N.I.**, OP de componentes.
- Fundição: catálogo de brutos/coquilhas, programação, OP de fundição.

## Invariantes

- Demanda calculada de snapshot deve preservar horizonte de média importado.
- A sugestão pode usar físico e OP ativa; ao concluir OP, ela sai da parcela pendente. Não é crédito automático em estoque físico de hélice ou componente.
- Fundição concluída pode creditar bruto uma vez, pela quantidade produzida, com validação e auditoria.
- Consumo de bucha e bruto de uma OP de usinagem **é decisão pendente** quanto ao momento e à reserva; não mude no backend sem validar a regra com o responsável.
- OP precisa de estado, histórico, origem, produto/SKU, quantidade, datas, responsável; sem apagar registros ao importar Excel.
- Simulação pode editar parâmetros de cálculo apenas em memória/escopo controlado; não alterar dados oficiais.
- Cadastros interligados por códigos estáveis e BOM; evitar inferência por descrição.

## Testar

Fluxos completos por família: cenário com/sem estoque; OP ativa, concluída, cancelada e parcial; reprocessamento após importação; duplicidade de callback/requests; dois operadores; retomada após falha de rede; auditoria de movimento.
