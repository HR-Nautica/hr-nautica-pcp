# Expansão da BOM na Análise de Hélices — 06/11/2026

Fluxo: usuário da análise → seta por produto → consulta somente leitura `/api/catalog/analysis/helices/:id/structure` → BOM real do catálogo + saldos centrais → detalhe em linha, recolhível. Não há migration, importação ou movimentação nesta consulta.

Botão Sincronizar Tiny da análise de Hélices passa a navegar para a tela existente de Suprimentos, selecionando o menu e expandindo a categoria. A tela central conserva a prévia e a confirmação da sincronização geral. As outras análises conservam seus atalhos por família.

Dados: produto raiz e filhos são identificados por ID; a árvore reutiliza `getProduct`/`buildBomTree`, com profundidade/ciclos limitados pela consulta existente. O detalhe carrega somente ao expandir; não cria uma requisição por componente. Estoque físico e fonte vêm da leitura central, saldo após vendido usa Estoque 1. Sem vendido informado, esse saldo continua não informado: não inferir disponibilidade física livre ou reservas.

Mostra quantidade da BOM por unidade do pai, unidade, produto inativo, físico, saldo após vendido, entradas e área de OP/etapa. Roteiro cadastrado é explicitamente separado de execução real. Decisão vigente do usuário: só futuras OPs da nova estrutura; entradas e etapa permanecem vazias até sua criação, sem consultar tabelas legadas ou fabricar progresso.

Falhas: mensagem e tentativa novamente na própria expansão; recolher/filtrar não grava dados; resultado de consulta tardia não troca a tela atual. Atualizar análise descarta o cache de detalhes. Setas têm nome acessível e aria-expanded/aria-controls; fichas continuam acessíveis pelo nome ou botão no detalhe.

Revisão pelos papéis Architect/Stock/Production/Visual/Quality: leitura e execução permanecem separadas. Testes PostgreSQL descartáveis verificam raiz/filho/neto, saldos por ID, ausência preservada, nenhuma importação criada e rejeição de tipo que não é usinado. Suíte geral, build e interação local de abrir/recolher e navegação. Rollback: reverter commit; nenhum dado persistido por esta funcionalidade.
