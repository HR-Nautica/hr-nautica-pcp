# Etapa 03B — preparação local

SKU segue a normalização ASCII e remoção de espaços externos da V003. Espaços internos diferentes não são fundidos; equivalências suspeitas bloqueiam a carga.

O importador exige Unidade ou Unidade_Medida (texto de 1 a 32 caracteres sem controles). Não há lista canônica de unidades no domínio; KG, UN e M são preservados, sem conversão. Arquivos antigos sem unidade passam a ser rejeitados para revisão explícita. Status aceita ATIVO/INATIVO e active/inactive; outros valores são rejeitados.

A pré-validação agora lê o banco e pode retornar canImport=false, classificações por registro e conflitos. A importação repete a análise sob lock transacional. Não sobrescreve campos de produtos existentes. Aliases ativos inequívocos reaproveitam UUID; namespaces ambíguos ou divergências cadastrais bloqueiam. Repetição do mesmo checksum conserva a idempotência existente.

Tipos adicionais cabem no varchar atual, porém exigem decisão sobre família e significado industrial antes de ampliar API e formulário. Natureza operacional não foi adicionada. Produto acabado / componente permanece inalterado.

Pendências: auditoria produtiva autenticada; integração PostgreSQL real da nova pré-validação/locks; testes de navegador do fluxo de confirmação; validação de unidades contra vocabulário aprovado; detecção de ciclos indiretos de BOM. A importação em massa não está homologada por esta entrega.

Etapa 03C: obter arquivo e extrato autenticado; aprovar tipos e unidades; resolver todos os conflitos e aliases; validar prévia sem escrita; testar carga e repetição em PostgreSQL descartável; comparar UUIDs, contagens e relacionamentos antes/depois; só então autorizar carga operacional.
