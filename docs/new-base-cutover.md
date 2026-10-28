# Corte para a nova base do ERP

O corte autorizado substitui a aplicacao de negocio antiga pelos modulos Produtos, Estoque Geral, Etapas de Producao e Fornecedores.

## Preservado

- usuarios e sessoes de autenticacao;
- historico Git e migrations aplicadas;
- infraestrutura de proxy, banco e deploy;
- backups externos exportados em 2026-10-28.

## Removido pela V007

- estado generico legado;
- ordens, analises e auditoria operacionais antigos;
- cadastros mestre e vinculos produzidos pela logica anterior;
- dados da fundacao V006, para que a planilha normalizada seja a primeira carga limpa.

## Ativacao

O workflow manual `Reset and activate new ERP base` exige a confirmacao literal `RESET-HR-NAUTICA`. Ele constroi uma imagem imutavel, executa V006/V007 dentro da rede do PostgreSQL e so entao publica e verifica o mesmo SHA em `/healthz` e `/release.json`.

Depois do corte, o administrador importa `BOMs_normalizadas_unificadas.xlsx` pela tela Produtos. A importacao e transacional e idempotente: 577 produtos sao a base inicial; vinculos pendentes continuam fora da BOM ativa.
