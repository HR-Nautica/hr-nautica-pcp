# Permissões de importação Tiny por produto e coluna

Definição do usuário em 05/11/2026: substituir a opção única por uma seção Tiny no cadastro, com seleção independente de Entradas, Saídas previstas (vendido), Estoque físico, Estoque virtual, Saídas do período e Média mensal. Estoque 1 continua sendo calculado pelo ERP e não é importável.

A configuração fica em `master_items.source_metadata.tinyImportFields`, metadado da integração, validado pelo servidor. A atualização do cadastro mantém sua versão, bloqueio e auditoria vigentes. Não há migration nova. O booleano legado passa a resumir se existe alguma coluna selecionada. Sem configuração individual, um cadastro legado habilitado mantém as seis colunas permitidas; um cadastro desabilitado mantém nenhuma. Uma lista vazia explícita desabilita todas as importações do produto.

A sincronização consulta as permissões novamente sob bloqueio e registra quais campos foram aplicados. Só grava estoque físico/fonte Tiny quando físico está selecionado. Métricas desmarcadas mantêm a posição anteriormente persistida; marcar somente métricas não muda o estoque físico nem sua fonte. Um campo selecionado ausente no arquivo bloqueia a confirmação dos cadastros com seleção explícita. Produtos inativos continuam bloqueados. A prévia lista as colunas aplicáveis e uma alteração de permissão invalida o plano anterior.

Métricas efetivas permanecem no snapshot auditado transacional. A leitura usa o último snapshot do produto, inclusive quando a fonte do estoque físico é ERP e somente métricas são importadas do Tiny.
