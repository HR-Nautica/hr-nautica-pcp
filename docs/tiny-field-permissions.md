# Permissões de importação Tiny por produto e coluna

Definição vigente do usuário em 05/11/2026: o cadastro contém uma seção Tiny com quatro seleções independentes: Saídas previstas (vendido), Estoque físico, Saídas do período e Média mensal.

Entradas previstas (em Produção) é exclusiva das OPs. Estoque 1 e Estoque virtual são calculados no ERP. Essas três colunas não são importáveis. Os valores de Entradas e Estoque virtual existentes em planilhas ou snapshots antigos do Tiny são ignorados.

A configuração fica em `master_items.source_metadata.tinyImportFields`, validada pelo servidor. O booleano legado resume se existe alguma coluna selecionada. Sem configuração individual, um cadastro legado habilitado permite os quatro campos externos; um desabilitado não permite nenhum. Configurações antigas são filtradas para a lista vigente, sem alterar saldos.

A sincronização revalida permissões sob bloqueio. Só grava estoque físico/fonte Tiny quando físico está selecionado. Métricas desmarcadas mantêm a posição anterior; selecionar somente métricas não muda o físico nem sua fonte. Um campo selecionado ausente bloqueia a confirmação de cadastros com seleção explícita. Produtos inativos continuam bloqueados. Mudanças de permissão invalidam a prévia anterior.

Métricas efetivas ficam no snapshot auditado transacional. A leitura usa o último snapshot do produto. Fórmulas e regra transitória de produção zero estão em `stock-planning-columns.md`. Não há migration nem modificação automática de saldos nesta revisão das fontes.
