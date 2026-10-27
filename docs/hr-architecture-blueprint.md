# HR Náutica — Blueprint de evolução (PROPOSTA, não implementada)

Este documento guia conversas e entregas futuras. Não autoriza mudança de regra, migration, merge nem deploy.

## 1. Domínios e dependências

```text
                  Arquivos Excel (oficiais p/ categorias importadas)
                              ↓
                    Ingestão/Prévia/Validação
                              ↓
                        Snapshot versionado
                              ↓
   ┌──────────────── Central de Estoque (visão/API) ───────────────┐
   │  Hélices usinadas  Componentes  Buchas     Brutos fundidos    │
   │  Excel             Excel        Ledger     Ledger             │
   └───────────────┬──────────────┬───────────┬────────────────────┘
                   ↓              ↓           ↓
               Catálogos por família / vínculos BOM
                   ↓
                 Planejadores / simulação (não alteram físico)
                   ↓
              Criação e acompanhamento de OPs
                   ↓
                Eventos de produção autorizados
                   ↓
            Movimentações em ledger interno (quando aplicável)
```

A Central de Estoque é uma **interface unificada de consulta**, não uma tabela que recebe e substitui indiscriminadamente todos os saldos.

## 2. Contratos esperados de visualização

Separar colunas: família, SKU, descrição, unidade, `estoque_fisico`, `fonte_oficial`, `data_referencia`, `ops_ativas`, `producao_prevista`, `reserva` (se aprovada), `estoque_virtual`, `necessidade_planejada`, `ultima_atualizacao`. Campos derivados não devem ser gravados como saldo físico.

Usar contratos de leitura versionados; não atrelar o planejador à forma interna da planilha. Catalogação por IDs/SKUs estáveis, com vínculos de consumo explícitos.

## 3. Modelo repetível de navegação

- **Central de Estoque**: resumo, importações, posições e origem.
- **Hélices**: Catálogo | Planejamento | OPs.
- **Buchas**: Catálogo | Planejamento | OPs.
- **Componentes**: Catálogo | V.I.N.I. | OPs.
- **Fundição**: Catálogo | Planejamento | OPs.
- **Expedição, Manutenção, Administração**: manter integrações/permissões vigentes.

Reutilizar shells, tabelas, filtros, modais e estados visuais; não forçar a mesma máquina de estados para todos os processos industriais.

## 4. Sequência segura de implementação

**Etapa A: descoberta e inventário** — mapear chaves, endpoints, fórmulas, estados e fontes. Documentar conflitos de regra de OP. Não mexer no layout global ainda.

**Etapa B: Central de Estoque leitura (read-only)** — uma UI consolidada com indicação de fonte, último snapshot e ledger, usando contratos existentes. Nada de gravação/consumo neste marco.

**Etapa C: pipeline de importação oficial** — suportar layouts reais `necessidade.xlsx` e `saidas previstas.xls`, pré-visualização, validação integral, publicação atômica aprovada, histórico e rollback de snapshots. Isolar fontes por categoria.

**Etapa D: planejadores** — migrar um por vez (Componentes/V.I.N.I., depois Hélices, Buchas, Fundição) para ler contratos centrais. Preservar fórmulas até decisão de negócio.

**Etapa E: OPs integradas** — normalizar rastreabilidade, estados e vínculos; implementar consumo/reservas somente após aprovação da regra operacional e testes de banco.

**Etapa F: padronização UI** — após cada recorte funcional, tornar o padrão visual replicável. Não deixar para uma migração CSS gigante.

Em todas as etapas: branch isolada, CI, homologação funcional e comparação com comportamento atual. Nunca modificar produção por padrão.

## 5. Arquivos reais existentes

- `index.html` — app shell, páginas e menu.
- `public/js/vini.js` — planejador Componentes.
- `public/js/analise.js` — análise de Hélices.
- `public/js/producaoComponentes.js` — OPs de componentes.
- `public/js/syncManagerPage.js` — sincronizações.
- `public/js/estoqueArvore.js` — estrutura/snapshot componentes.
- `public/js/db.js` — acessos client legados e cadastros.
- `public/js/remote-storage.js` — estado remoto versionado.
- `server/database.js`, `server/routes/` — persistência/API e transações.
- `public/css/design-system.css` — padrão visual atual; `public/css/style.css` — legado.

Verificar o estado do repositório antes de cada trabalho — este documento não se atualiza sozinho.
