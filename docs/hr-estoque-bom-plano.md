# Estoque Geral e BOM — evolução por etapas

## Estado atual e autoridade

| Origem | Cadastro/estrutura | Saldo físico | Leitura no Estoque Geral |
| --- | --- | --- | --- |
| Hélices | `hrn_modelos` | snapshot Excel de hélices (`analysis_temp`) | item final / hélice usinada, com referências técnicas do cadastro |
| Brutos | `hrn_fundicao_catalog`, `hrn_coquilhas_catalog` e códigos vinculados em `hrn_modelos` | movimentações internas de brutos | uma posição por código de coquilha, mesmo com várias aplicações |
| Buchas | `hrn_buchas` | entradas e saídas internas de buchas | bucha cadastrada com saldo final |
| Componentes | `hrn_estoque_arvore` (níveis 00/01/02) | snapshot Excel de componentes | item final, componente ou material conforme nível; linhas da árvore no detalhe |

O Estoque Geral é uma projeção de consulta. As linhas de saldo sem cadastro não criam itens automaticamente. Códigos relacionados são ligados apenas por correspondência exata normalizada; relações não resolvidas ficam visíveis como pendência. Quantidades de bruto, bucha, caixa, tubo e latão permanecem não informadas enquanto o cadastro não contiver consumo por unidade.

## Sequência proposta

1. **Consulta consolidada (esta etapa).** Catálogos definem os itens, tipo e vínculos; fontes oficiais fornecem saldos. Validar contagens e relações com dados reais no 8444.
2. **Reconciliação de cadastros.** Criar uma fila para códigos de planilha/ledger sem catálogo, duplicidades e vínculos técnicos sem destino. Definir responsáveis e decisões de cadastro antes de qualquer vínculo automático.
3. **Cadastro mestre e BOM versionada.** Decidir identidade estável, unidade, quantidade por produto, alternativas e aprovação/vigência da BOM. Usar migrations V003–V005 apenas após revisão e autorização específica; separar relação técnica de linha de consumo. OPs existentes conservam estrutura histórica.
4. **Fluxo por família.** Organizar navegação em Estoque Geral e Hélices, Brutos, Buchas, Componentes com Catálogo, Planejamento e OPs onde o processo já existir. Mover edição de cadastro para um fluxo único somente depois de mapear permissões, rotas e dependências das telas atuais.
5. **Planejamento/execução integrados.** Consumir a BOM publicada para simulações e novas OPs. Definir antes o momento de reserva/consumo de bruto e bucha, estorno, parciais e deduplicação entre entradas previstas e OPs.

Cada etapa pede testes de domínio, regressão dos fluxos existentes, CI, publicação pelo pipeline e conferência do SHA no ambiente. Alterações de banco e de movimento físico exigem autorização própria.
