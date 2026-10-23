# V.I.N.I. e planejamento de componentes

## Fontes persistidas

- `hrn_earv_estoque`: snapshot completo do estoque fisico importado.
- `hrn_earv_saidas_periodo`: snapshot das saidas no periodo da mesma planilha de estoque.
- `hrn_earv_saidas_previstas`: snapshot completo das saidas previstas.
- `hrn_vini_necessidades`: itens atuais da planilha de planejamento; nao e cadastro mestre.
- `hrn_vini_entradas`: entradas previstas presentes no workbook, mantidas separadas das OPs.
- `hrn_vini_fornecedores_map`: snapshot dos vinculos SKU/fornecedor.
- `hrn_vini_fabri_data`: snapshot da estrutura de fabricacao importada.
- `hrn_prod_comp_ops`: OPs de componentes e seus estados operacionais.

Cadastros, inativacoes e configuracoes usam chaves proprias. A ausencia de um SKU
em um snapshot diario nao remove esses dados nem altera estoques de brutos ou buchas.

## Confirmacao e atomicidade

Todas as abas e colunas obrigatorias sao validadas antes da primeira gravacao. A
interface somente informa sucesso quando todas as gravacoes solicitadas foram
confirmadas pelo servidor.

O armazenamento de estado oferece controle de versao por chave, mas nao uma
transacao envolvendo varias chaves. Portanto, as seguintes importacoes ainda podem
ter confirmacao parcial caso a conexao falhe entre respostas:

- planejamento: `hrn_vini_necessidades` e `hrn_vini_entradas`;
- estoque: `hrn_earv_estoque`, `hrn_earv_saidas_periodo` e `hrn_earv_meta`;
- demais snapshots da Arvore: chave de dados e `hrn_earv_meta`.

Nesses casos a sincronizacao e apresentada como falha, e as pendencias permanecem
disponiveis para revisao consciente. Uma nova importacao completa e idempotente e
substitui somente os snapshots pertencentes ao seu tipo.

## OPs e resposta perdida

Alteracoes de OP sao montadas como rascunho. A tela promove o rascunho somente
depois da confirmacao. Em falha sem resposta, a tela restaura o ultimo snapshot
confirmado e conserva o rascunho na fila pendente. Novas alteracoes ficam bloqueadas
ate o usuario recuperar ou descartar essa pendencia. Se o servidor tiver gravado a
operacao mas a resposta tiver sido perdida, a proxima reconciliacao detecta a mudanca
de versao e evita criar ou reenviar outra OP silenciosamente.
