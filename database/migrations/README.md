# Migrations PostgreSQL

Este diretório contém as alterações versionadas do schema PostgreSQL. O runner é
uma ferramenta administrativa separada da API e nunca é executado no startup do
Express.

## Formato

Cada arquivo deve seguir exatamente:

```text
VNNN__descricao_em_snake_case.sql
```

Exemplo: `V002__adiciona_indice_de_consulta.sql`.

- A versão é numérica, positiva e possui ao menos três dígitos.
- A descrição aceita letras minúsculas, números e `_`.
- As versões são únicas e executadas em ordem numérica crescente.
- Um arquivo aplicado é imutável. Qualquer correção deve ser uma nova migration.
- O SHA-256 é calculado sobre os bytes exatos do arquivo.
- Migrations são transacionais por padrão.

`V001__baseline.sql` é a estrutura inicial. Em banco vazio ela é executada pelo
runner normal. Em banco existente, seu SQL nunca deve ser executado: use o
procedimento de adoção descrito abaixo.

## Migration não transacional

Um arquivo que não possa executar dentro de uma transação deve começar, antes de
qualquer SQL, com a diretiva:

```sql
-- migration:non-transactional
```

O runner identifica e lista esse tipo, mas sua execução está intencionalmente
bloqueada nesta versão. `CREATE INDEX CONCURRENTLY`, `VACUUM` e comandos
equivalentes só poderão ser usados após a definição de um processo de recuperação.

## Configuração

O runner exige configuração explícita no processo que o invoca:

```text
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
MIGRATION_OPERATOR=nome.do.operador
```

`MIGRATION_OPERATOR` é obrigatório apenas para uma aplicação real. Não coloque
credenciais em argumentos, arquivos versionados ou logs.

## Comandos

```bash
npm run db:migrate:status
npm run db:migrate:validate
npm run db:migrate:dry-run
npm run db:migrate
npm run db:migrate:test
npm run db:migrate:test:integration
```

- `status`: mostra migrations locais e registros do banco, sem alterar o banco.
- `validate`: verifica nomes, duplicidade, arquivos ausentes e checksums.
- `migrate --dry-run`: valida e mostra o plano, sem criar tabela ou executar SQL.
- `migrate`: adquire lock consultivo, valida novamente e aplica pendências.

O lock é mantido na mesma conexão durante toda a operação. Se outra execução já
possuir o lock, o comando falha imediatamente.

## Estados e recuperação

`schema_migrations.status` pode ser `running`, `applied` ou `failed`. Uma falha
transacional causa `ROLLBACK` e registra `failed`. Registros `running` ou `failed`
bloqueiam novas aplicações para impedir retomada automática sem investigação.

O histórico e os checksums continuam sendo validados pelo runner. A verificação
estrutural desta etapa é específica para a adoção de V001; drift contínuo após o
baseline permanece fora do escopo.

## Baseline

### Banco vazio

Use o fluxo normal:

```bash
npm run db:migrate:dry-run
npm run db:migrate
```

O runner cria `schema_migrations`, executa `V001__baseline.sql` em transação e
registra seu checksum. V001 não insere dados operacionais.

### Banco existente

Nunca execute V001 diretamente. Primeiro faça backup validado e execute somente
a inspeção:

```bash
npm run db:baseline:dry-run
```

O dry-run consulta PostgreSQL 17 e compara a estrutura de `public` com
`database/baseline-structure.json`. Nenhuma tabela ou histórico é criado. A
comparação cobre tabelas, colunas, tipos, defaults, nulabilidade, sequências e
ownership, constraints, índices, views, funções, triggers e policies. Owners,
ACLs, estatísticas e valores correntes de sequências são ignorados.

Depois de revisar o hash e confirmar que o backup pode ser restaurado:

```bash
npm run db:baseline -- --confirm=ADOPT_BASELINE_V001
```

`MIGRATION_OPERATOR` é obrigatório. O comando adquire o mesmo advisory lock do
runner, repete toda a validação e, em uma transação, cria somente a tabela de
controle e registra V001 como `applied`. O SQL de V001 não é executado.

Qualquer divergência ou histórico preexistente bloqueia a adoção. Não existe
correção automática de drift.

### Falha e rollback operacional

- Antes do `COMMIT`, uma falha reverte a criação/registro de
  `schema_migrations`; tabelas existentes não são tocadas.
- Depois de sucesso, o rollback normal é restaurar o backup validado. Não remova
  manualmente V001 do histórico sem investigação e aprovação.
- Se a estrutura divergir, interrompa o procedimento, preserve o relatório e
  trate a diferença em uma migration futura revisada; não altere o manifesto para
  fazer um banco divergente passar.
- `running` ou `failed` no histórico exige intervenção manual; a adoção nunca
  tenta reparar ou sobrescrever esses estados.

## Teste real com PostgreSQL 17

`db:migrate:test:integration` exige Docker. O comando cria uma rede com nome
aleatório, um `postgres:17-bookworm` com credenciais aleatórias e um executor
Node 22, todos descartáveis. O repositório é montado somente para leitura e o
executor recusa URLs que não tenham o nome e o banco exclusivos da suíte. Os
containers e a rede são removidos ao final, inclusive quando os testes falham.

A suíte não lê `DATABASE_URL`; ela injeta somente
`MIGRATIONS_TEST_DATABASE_URL`, criada em memória para aquele container.
