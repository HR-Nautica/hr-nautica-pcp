# Análise e Ordens de Produção — definição do fluxo

Registro da orientação do usuário em 05/11/2026. Este documento define o comportamento desejado para a próxima implementação. Não representa funcionalidade já implementada nem autoriza mudanças de saldo por si só.

## Fluxo definido

1. A **Análise de Produção** é o local onde o usuário analisa a necessidade e abre a ordem de produção, nas famílias Hélices, Brutos, Buchas e Componentes.
2. Ao analisar/abrir uma OP, a tela apresenta o produto pai e sua árvore BOM expansível, com os itens corretamente vinculados aos respectivos pais.
3. Ao lado de cada item da árvore, exibir seu estoque atual e a quantidade disponível. A disponibilidade precisa de definição de cálculo antes da implementação; não presumir que seja igual ao estoque físico.
4. Exibir as etapas de produção cadastradas para os produtos envolvidos, distinguindo etapas concluídas e não concluídas e suas quantidades.
5. Em cada etapa, registrar quantas peças foram aprovadas para seguir à próxima etapa.
6. As peças que não avançarem devem ser identificadas por destino: **refugo** ou **aguardando em estoque temporário**. A quantidade por destino deve ficar visível e rastreável.
7. No fracionamento descrito pelo usuário, criar subordem vinculada à OP de origem para acompanhar a parcela separada. Exemplos solicitados: OP `1` → subordem `1.1`; ou OP `1A` → fragmento `1B`. O padrão definitivo de numeração ainda precisa ser escolhido.
8. A área **Ordens de Produção** reunirá as ordens abertas pela Análise para acompanhamento da execução, mantendo origem, vínculos e histórico.

## Informações a apresentar

- Produto pai e componentes/materiais da BOM por nível.
- Estoque atual e disponibilidade de cada item, identificando a fonte e a data da posição.
- Ordem original, subordens e vínculo entre elas.
- Etapas concluídas e pendentes.
- Quantidade aprovada para a próxima etapa.
- Quantidade em refugo.
- Quantidade aguardando em estoque temporário.

## Pontos que precisam ser definidos antes de implementar

- **Numeração:** escolher entre hierarquia (`1`, `1.1`, `1.1.1`) e sequência com letras (`1A`, `1B`), incluindo fragmentos de fragmentos. O identificador interno da ordem e o vínculo pai/filho devem permanecer inequívocos.
- **Fracionamento:** confirmar quais destinos geram subordem, como tratar múltiplos destinos na mesma etapa e se o refugo gera uma ordem de acompanhamento ou somente um registro de perda vinculado.
- **Estoque temporário:** definir local/estado, responsável, retorno à produção e regra para liberar peças que estavam aguardando. Não presumir que peças aguardando sejam refugadas.
- **Disponibilidade:** definir reservas, materiais em processamento, estoque temporário e OPs em andamento. Não somar essas parcelas ao físico automaticamente.
- **Quantidades:** definir quantidade de entrada por etapa, aprovação parcial, encerramento de saldo pendente e consistência entre peças aprovadas, refugadas e aguardando.
- **Consumo e movimentação:** definir os eventos que reservam, consomem ou transferem os insumos. A abertura da OP e a aprovação da etapa não autorizam, isoladamente, crédito ou débito automático de estoque.
- **Permissões e correções:** definir quem aprova, informa refugo, libera estoque temporário, fraciona e estorna apontamentos.

## Integridade para a implementação futura

Preservar os cadastros, BOMs, roteiros e fontes de estoque vigentes. Quantidades físicas, disponíveis, em processamento e temporárias devem ser identificadas separadamente. Fracionamentos e apontamentos precisam de transação, idempotência, controle de concorrência e auditoria; não podem duplicar peças ou apagar o histórico da ordem original.

Consultar também `docs/hr-open-decisions.md`, em especial D-001 e D-006. Este registro não resolve implicitamente decisões antigas sobre consumo ou reservas.

## Execução de hélices

- O administrador aponta toda a quantidade da etapa entre aprovadas, refugo e espera. As aprovadas seguem à etapa seguinte. Se a etapa for a última, são registradas como concluídas.
- A espera exige um local e gera um lote filho com numeração hierárquica, como `OPH-000001.1`. A liberação retoma a mesma etapa. O refugo é registrado no apontamento.
- Apenas peças dos lotes em produção entram na previsão. A quantidade aguardando fica visível no lote e volta à previsão após liberação.
- O acompanhamento usa o roteiro registrado na abertura da ordem. A BOM e os saldos são os atuais do cadastro e o saldo após vendido é apresentado como referência antes de reservas.
- Os apontamentos são versionados e auditados. O consumo de bruto ocorre na abertura da OP e a execução da hélice não movimenta o físico. As demais famílias e os fluxos de correção, cancelamento e estorno continuam fora desta implementação.
