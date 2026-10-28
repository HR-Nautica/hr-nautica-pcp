# Estoque Geral e BOM — evolução por etapas

## Estado atual e autoridade

| Origem | Cadastro/estrutura | Saldo físico | Leitura no Estoque Geral |
| --- | --- | --- | --- |
| Hélices | `hrn_modelos` | snapshot Excel de hélices (`analysis_temp`) | item final / hélice usinada, com referências técnicas do cadastro |
| Brutos | `hrn_fundicao_catalog`, `hrn_coquilhas_catalog` e códigos vinculados em `hrn_modelos` | movimentações internas de brutos | uma posição por código de coquilha, mesmo com várias aplicações |
| Buchas | `hrn_buchas` | entradas e saídas internas de buchas | bucha cadastrada com saldo final |
| Componentes | `hrn_estoque_arvore` (níveis 00/01/02) | snapshot Excel de componentes | item final, componente ou material conforme nível; linhas da árvore no detalhe |

O Estoque Geral é uma projeção de consulta. As linhas de saldo sem cadastro não criam itens automaticamente. Códigos relacionados são ligados apenas por correspondência exata normalizada; relações não resolvidas ficam visíveis como pendência. Quantidades de bruto, bucha, caixa, tubo e latão permanecem não informadas enquanto o cadastro não contiver consumo por unidade.

### Auditoria de contagens

A árvore de componentes contém **linhas de estrutura**, que podem repetir o mesmo SKU em produtos diferentes. O Estoque Geral agrupa essas linhas por SKU; portanto, o número de linhas da árvore não é o número de componentes distintos. O snapshot Excel de estoque contém posições por SKU e pode incluir itens fora da árvore. Essas posições são sinalizadas como **ausentes da árvore importada**, sem concluir que não existe cadastro em outra origem. A resposta da API expõe `summary.sourceCounts` por família e distingue linhas do catálogo, SKUs únicos da árvore, itens listados e posições de estoque. A conferência com os números operacionais informados (74 hélices, 77 brutos, 15 buchas, 1298 componentes) ainda depende de comparar essas métricas com as fontes reais no ambiente autenticado; não alterar saldos ou criar cadastros automaticamente para forçar igualdade.

## Decisão posterior: fonte do saldo por item

O operador quer escolher por item entre **Sincronizar Estoque** e **Gerenciado pelo ERP**, com efeito em todo o ERP e cópia do saldo físico vigente no momento da troca. Esta escolha substitui a autoridade fixa por família descrita na tabela acima somente depois de implementada a migração operacional. Uma checkbox isolada no Estoque Geral seria falsa: a importação, os planejadores, as OPs e as movimentações continuariam lendo ou gravando nas fontes antigas.

O recorte funcional precisa ser atômico e auditável:

1. Identificar o item por chave estável; bloquear a troca se houver SKU duplicado, saldo desconhecido ou vínculo não reconciliado.
2. Em transação, bloquear o item, conferir versão, capturar o saldo e a origem atuais, gravar o novo modo, o saldo inicial e um evento de transferência idempotente. Repetir a mesma requisição não pode copiar o saldo duas vezes.
3. Redirecionar todas as leituras de saldo para uma autoridade única. A sincronização só aplica posição física aos itens no modo Excel; lançamentos e OPs só alteram itens no modo ERP. Importações continuam preservando cadastros e históricos.
4. Na troca ERP → Excel, a cópia é uma posição provisória identificada como transferência; a próxima sincronização válida substitui apenas a posição daquele item. A interface deve mostrar claramente essa transição.
5. Testar concorrência entre troca de modo, importação e movimentação, além de falha de rede, zero/negativo, ausência de saldo, rollback e divergências entre telas.

Não publicar a seleção editável antes de os cinco pontos funcionarem. Até lá, a origem exibida permanece a autoridade atual por família.

## Sequência proposta

1. **Consulta consolidada (esta etapa).** Catálogos definem os itens, tipo e vínculos; fontes oficiais fornecem saldos. Validar contagens e relações com dados reais no 8444.
2. **Reconciliação de cadastros (fila de consulta implementada).** O Estoque Geral lista códigos da fonte sem catálogo, identidades ambíguas, saldos pendentes e vínculos técnicos sem destino, com filtros e paginação. A resolução, a atribuição de responsável e o vínculo persistente ao Item Mestre continuam pendentes; nenhum cadastro ou saldo é alterado pela fila.
3. **Cadastro mestre e BOM versionada.** Decidir identidade estável, unidade, quantidade por produto, alternativas e aprovação/vigência da BOM. Usar migrations V003–V005 apenas após revisão e autorização específica; separar relação técnica de linha de consumo. OPs existentes conservam estrutura histórica.
4. **Fluxo por família.** Organizar navegação em Estoque Geral e Hélices, Brutos, Buchas, Componentes com Catálogo, Planejamento e OPs onde o processo já existir. Mover edição de cadastro para um fluxo único somente depois de mapear permissões, rotas e dependências das telas atuais.
5. **Planejamento/execução integrados.** Consumir a BOM publicada para simulações e novas OPs. Definir antes o momento de reserva/consumo de bruto e bucha, estorno, parciais e deduplicação entre entradas previstas e OPs.

Cada etapa pede testes de domínio, regressão dos fluxos existentes, CI, publicação pelo pipeline e conferência do SHA no ambiente. Alterações de banco e de movimento físico exigem autorização própria.
