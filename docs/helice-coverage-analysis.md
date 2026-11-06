# Análise de Hélices — 06/11/2026

## Recorte implementado

Ator: administrador, preservando a permissão atual do catálogo. Somente produtos ativos cujo tipo cadastrado é `Hélice usinada`; não classificar por prefixos do SKU.

Plano e revisão de domínio: consulta central → cálculos fiéis à referência → controles persistidos com versão → sincronização por família → validação. Revisão pelos papéis de Architect, Production, Stock, Visual e Quality: projeção não movimenta estoque; importação mantém permissões por coluna; não reconectar OPs legadas implicitamente.

Origem → entidade → evento → persistência → leitura → visualização:

- Tiny → métricas autorizadas do produto → confirmação de prévia → último snapshot auditado em `product_catalog_imports`/físico em `product_stock_balances` → `attachTinyStockMetrics` → estoque e análise.
- Cadastro/BOM → produto e bruto → consulta sem escrita → `master_items`/`product_bom_lines` → vínculo direto pelo identificador do bruto → Código Bruto na análise. Múltiplos brutos são mostrados, não se escolhe um silenciosamente.
- Parâmetros da análise → salvar explicitamente → `app_state` na chave exclusiva `hrn_helice_coverage_v1` + `audit_log` → consulta atual → recálculo. A chave não é liberada pela API genérica de estado. Versão concorrente gera 409, sem sobrescrita.

Estoque Geral passa a mostrar SKU, Produto, Estoque físico e Fonte. Planejamento fica na análise; valores e fontes continuam centrais. Sincronização geral continua disponível; cada uma das quatro análises oferece o mesmo fluxo de prévia/confirmação com escopo de família aplicado no servidor. Alterar escopo invalida a prévia; reenvio confirmado é idempotente. SKUs desconhecidos do arquivo são informados, nunca cadastrados automaticamente.

## Referência e fórmulas

Arquivo `21.10.26_CONTROLE_ATUALIZADO_CODAN.xlsx`, aba `3-Cobertura`, tabela `Tabela112` A6:Y81. Cabeçalhos úteis mantidos na ordem da referência, sem a coluna auxiliar redundante `prio`. A coluna entre virtual e média é `Saídas do período (máximo histórico)`.

Controles B3:B5: estoque futuro 2 meses; fator da média 1; horizonte de produção 3 meses. A média original do Tiny é preservada no snapshot; fator afeta apenas a projeção desta análise.

- I7: Estoque 1 = físico − vendido.
- J7: Virtual = Estoque 1 + produção aberta.
- K7: máximo histórico = Estoque mínimo Tiny ÷ 3 (regra já existente, por cabeçalho).
- L7: média Tiny × fator B4.
- M7: Estoque 1 negativo → −1; virtual negativo → virtual/média; descrição contendo `max.` → zero; média < 2 → 5; demais → Estoque 1/média. Truncar em uma casa como ROUNDDOWN.
- N7: virtual/média; média zero → 6, preservando `1 + 5` da fórmula Excel. Ausência de fonte fica não informada.
- O7: máximo entre zero e a falta para média × meses de produção, arredondada para cima em dezenas. Prefixo `COQ` preserva a exceção zero da referência, embora brutos não façam parte desta análise.
- P7: máximo entre zero e (média × meses de estoque − Estoque 1), sem arredondamento comercial adicional.

Orientação do usuário: Prioridade GERAL é a ordenação crescente de Prio2, desempate por SKU e ID. Prio2 ausente fica por último e sem prioridade numérica. Classificar/filtrar a tabela não recalcula a prioridade global sobre um subconjunto.

## OPs e dependências

As novas telas de OP ainda não têm execução implementada. Não reutilizar as tabelas legadas por conveniência. Decisão explícita do usuário em 06/11/2026: somente futuras OPs da nova estrutura. Entradas previstas fica vazia, produção contribui zero e a UI informa a limitação. Quando o fluxo for criado, mostrar ordens/etapas da mais avançada para a menos avançada. `Colocar OP` é quantidade sugerida, sem criar ordem ou consumir bruto/bucha.

Para o fluxo completo de OP, permanecem as decisões em `production-analysis-orders-flow.md`: disponibilidade, destinos de parcelas, numeração, consumo e permissões. Ordenação das OPs por avanço depende de etapas efetivamente apontadas, não do roteiro cadastrado apenas.

## Verificação e entrega

- Comparação somente leitura contra o arquivo original: 444 resultados numéricos em 74 linhas (I/J/M/N/O/P), sem divergências. Arquivo não alterado nem importado no banco.
- Testes unitários: fórmulas, zero, negativos, ausência, exceção `max.`, horizonte, ranking, validação e classificação por tipo.
- PostgreSQL 17 descartável: seleção apenas de usinadas ativas; parâmetros persistidos/auditados; conflito de versão; isolamento da importação por família; prévia com escopo trocado; idempotência e regressões da sincronização.
- Interface local com dados fictícios: alteração de 2→4 meses, cabeçalho/resultado, busca e ordenação; largura estreita sem transbordamento da página, tabela com rolagem própria.
- Sem nova migration. Defaults são lidos sem gravar; parâmetros só persistem ao salvar. Não importar prioridades nem saldos da planilha de referência.

Rollback: reverter o commit de UI/API. A chave de parâmetros pode permanecer preservada e não afeta a versão anterior; snapshots/históricos não são apagados.
