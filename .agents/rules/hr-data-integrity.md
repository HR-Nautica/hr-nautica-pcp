---
trigger: model_decision
description: "Aplicar a importações Excel, saldos, tabelas, versões, concorrência, transações de estoque e mudanças em banco/API." 
---

# Fonte de verdade, persistência e integridade

## Leituras oficiais

1. Hélices acabadas/usinadas: snapshot de estoque por Excel.
2. Componentes: snapshot de estoque por Excel.
3. Buchas: transações e movimentos no ERP.
4. Brutos de fundição: transações e movimentos no ERP.

Na Central de Estoque, todo saldo deve carregar `origem`, `data da posição`, `SKU/item vinculado`, `unidade`, `tipo`, `status da atualização`; não tratar projeções como saldo físico.

## Regras de importação

- Detectar abas por cabeçalhos/layout; nomes preferenciais são dica, não condição exclusiva.
- Os arquivos operacionais usados na homologação incluem: `necessidade.xlsx` (aba `Sheet1`, Produto, Código (SKU), Entradas previstas, Saídas previstas, Estoque físico, Saídas do período, Média mensal, Comprar) e `saidas previstas.xls` (aba `Vendas`, Código (SKU), Quantidade). Não converter um subconjunto de saídas em snapshot de estoque.
- Pré-validar **todos** os datasets envolvidos antes de escrever qualquer um.
- Registrar `import_id`, autor, data, checksum/versão e contagem para rastreabilidade, quando houver projeto de persistência aprovado.
- Se escrever várias chaves sem transação, identificar risco de confirmação parcial, evitar sucesso falso e fornecer recuperação/reimportação consistente.
- Negativos e zeros podem ocorrer no Excel; preservar valor, sem corrigir silenciosamente.
- Fórmulas de negócio são configuráveis/versionadas no futuro, mas não devem ser mudadas em refatoração visual.

## Concorrência e confirmação

- Controlar versão por agregado; não confiar em armazenamento local para autoridade do banco.
- Conflitos 409: informar, recuperar, comparar e exigir reconciliação explícita.
- Escrita pendente: manter rascunho recuperável; não declarar sucesso.
- Ações físicas: transações com isolamento/bloqueio necessário, evento idempotente, saldo e movimento atômicos.
- Estorno é evento compensatório; não apagar movimento já confirmado.

## Testes críticos

- Parse real ou fixture anônima dos dois layouts `.xls` e `.xlsx`.
- Planilha inválida após uma válida no mesmo workbook → nenhuma escrita na pré-validação.
- Saldo zero, negativo, SKU ausente, duplicado, cabeçalho deslocado.
- Importação repetida não duplica registros; não altera dados de outra família.
- Simulação e OP ativa não lançam movimento físico.
- Dois usuários e resposta HTTP perdida preservam integridade e pendência recuperável.
