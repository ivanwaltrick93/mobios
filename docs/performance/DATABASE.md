# Banco de dados, performance e escalabilidade

Como o MobiOS usa o PostgreSQL de forma eficiente sob RLS, como medir, o que monitorar e quando mudar a
arquitetura. Os números citados estão em [RESULTADOS.md](RESULTADOS.md) (Fase 8, set/2026).

## 1. Como medir

Nada de otimizar por opinião: toda mudança de consulta ou índice passa por plano (`EXPLAIN`) e medição.

| Ferramenta | Para quê |
|---|---|
| `sh infra/bench/preparar.sh` | Recria o banco **mobios_bench** (separado de `mobios` e `mobios_test`) com dados sintéticos: 1 oficina grande (200 mil clientes, 300 mil orçamentos, 1,5 milhão de itens), 5 médias e 100 pequenas. ~2,5 min, ~2 GB. |
| `pnpm --filter @mobios/api bench` | Mede ~27 telas críticas (p50/p95 da requisição inteira e quantos comandos SQL cada uma faz). `--saida x.json` guarda o resultado para comparar; `--filtro texto` roda só alguns cenários. |
| `pnpm --filter @mobios/api bench:carga` | Carga concorrente: N usuários da oficina grande sem pausa + 1 de uma oficina pequena. Mostra vazão, p50/p95/p99, erros e o efeito de uma oficina sobre a outra. |
| `sh infra/bench/explicar.sh < consulta.sql` | `EXPLAIN (ANALYZE, BUFFERS)` de uma consulta **como a aplicação a executa**: usuário `mobios_app`, RLS ativo e `app.tenant_id` da oficina grande. Explicar como dono (sem RLS) engana: o plano é outro. |
| `pg_stat_statements` | Consultas mais caras e mais chamadas, em uso real (§8). |

O admin do benchmark e a senha ficam em `infra/bench/.credenciais` (fora do git). Limitações: dados sintéticos
(distribuições uniformes), API em processo (sem rede nem HTTP) e Postgres no Docker Desktop (VM com 2 GB). Os tempos
servem para comparar antes e depois, não como promessa para produção.

## 2. Regras para consultas sob RLS

A aplicação conecta como `mobios_app`, sujeita ao RLS. Isso muda o que o planejador pode fazer. Armadilhas
encontradas (e corrigidas) na Fase 8:

1. **Só operador "leakproof" vira condição de índice.** O Postgres não aplica um filtro não leakproof antes da política
   de RLS, então não o usa no índice. `ILIKE`, `LIKE`, `extract()` e funções em geral não são leakproof; `=`, `<`,
   `>` em tipos básicos são. Consequência: `nome ILIKE '%silva%'` na rota **lê a oficina inteira**, mesmo com índice
   de trigramas. Busca por trecho usa as funções de §3; filtro por expressão usa coluna gerada (ex.:
   `clientes.aniversario`).
2. **Índice decrescente do Drizzle é `NULLS LAST`.** `ORDER BY x DESC` é `NULLS FIRST`, e o Postgres não usa um índice
   com outra ordem de nulos para ordenar. Para ordenar por índice: `t.coluna.desc().nullsFirst()`.
3. **`exists (...)` na lista de colunas pode virar uma tabela hash da oficina inteira** (para responder só as 20 linhas
   da página), e o Postgres descarta `limit` dentro de `exists`. Use subconsulta escalar:
   `coalesce((select true from t where ... limit 1), false)`.
4. **Filtro de data compara instantes, não converte a coluna.** `coluna >= $inicio::date::timestamp at time zone
   'America/Sao_Paulo'` usa índice; `(coluna at time zone ...)::date between ...` calcula linha a linha.
5. **Lista com junções: pagine os ids e junte depois.** Com filtros só da tabela principal, pagine
   `select id ... order by ... limit/offset` numa subconsulta e junte cliente, veículo e vendedor só nas linhas da
   página (orçamentos, veículos). Numa busca ampla, a junção não corre sobre todos os resultados.
6. **Contagem sem junção desnecessária.** O `count(*)` da paginação usa só as tabelas que os filtros exigem.
7. **`not exists` fora de `count(*) filter (...)`.** Dentro do filtro de agregação vira uma subconsulta por linha; numa
   consulta própria vira junção anti (uma passada em cada tabela). Ex.: alertas do Painel.

Toda consulta nova de lista, busca ou painel: rode `explicar.sh` no banco de benchmark antes de dar por pronta.

## 3. Busca por trecho

Funções `SECURITY DEFINER` (migração 0028) rodam como dono das tabelas (fora do RLS), filtram a oficina
**explicitamente** por `app.tenant_id` e devolvem só ids:

| Função | Critérios |
|---|---|
| `busca_clientes(nome, documento, telefone, placa)` | nome, CPF/CNPJ, telefone/WhatsApp (trecho) e placa de veículo do cliente |
| `busca_veiculos(placa, trecho)` | placa, marca, modelo e nome do dono |
| `busca_materiais(prefixo, codigo_barras, trecho)` | SKU e código do fabricante pelo começo, código de barras exato, descrição |
| `busca_servicos(trecho, codigo)` | nome e código exato |
| `busca_vendedores(trecho, codigo)` | nome do usuário, matrícula e código |
| `busca_orcamentos(numero, cliente, placa)` | número exato, nome do cliente, placa exata |

Na rota: `sql\`${clientes.id} in (select busca_clientes(${padrao}::text, ...))\``. Parâmetro `NULL` = critério não
usado; os padrões (`%texto%`, `TEXTO%`) continuam montados na API.

**Segurança.** A consulta da rota continua sob RLS: mesmo que uma função errasse o filtro de oficina, nenhum dado de
outra oficina seria lido (o id é filtrado de novo pela política). Sem `app.tenant_id`, o filtro é `NULL` e nada volta.
As funções têm `search_path` fixo (`public, pg_temp`) e só `mobios_app` pode executá-las. Testes em
`apps/api/src/rls.test.ts`: isolamento, propriedades das funções e um teste que falha se uma rota voltar a usar
`ILIKE` direto (exceção consciente: aprovações comerciais, no nome do cliente guardado no pedido).

**Índices.** GIN compostos `(tenant_id, coluna gin_trgm_ops)` (extensão `btree_gin`). O GIN só de trigramas cobria
todas as oficinas: numa oficina pequena, "silva" percorria as ocorrências das outras (medido: 2,2 ms → 0,4 ms).
Trigramas só ajudam a partir de 3 caracteres; com 1 ou 2, a busca lê a oficina (as telas de escolha exigem 2+).

**Busca nova:** acrescente o critério na função do cadastro (nova migração com `CREATE OR REPLACE`) ou crie outra no
mesmo molde, com `REVOKE ... FROM PUBLIC` e `GRANT EXECUTE ... TO mobios_app`, e inclua no teste de propriedades.

## 4. Índices

Auditoria da Fase 8 (catálogo em `pg_indexes`; uso em `pg_stat_user_indexes`):

- **Nenhum B-tree redundante.** Os pares "prefixo de outro índice" encontrados são índices únicos parciais
  (`..._principal_unico WHERE principal`), que não substituem o índice completo da FK.
- **13 GIN de trigramas** (0019, 0012, 0023) não eram usados pela aplicação (§2, regra 1) e só custavam gravação:
  trocados pelos compostos de §3.
- **Criados:** `orcamentos_lista (tenant_id, criado_em DESC, numero DESC)`, a ordem da lista (substitui
  `(tenant_id, criado_em DESC NULLS LAST)`, que o planejador não usava para ordenar); `clientes_aniversario
  (tenant_id, aniversario)`, para os aniversariantes.
- **Avaliados e não criados** (sem ganho medido): `(tenant_id, vendedor_id, criado_em)` em orçamentos (a lista do
  vendedor leva 18 ms pelo `orcamentos_lista`); `(tenant_id, criado_em)` em clientes e veículos (relatórios e novos
  do Painel são agregações da oficina inteira).
- **Pendentes de baixo impacto:** os demais índices `.desc()` do schema são `NULLS LAST` (eventos de vendedor,
  preço, PMC, estoque e alçada; aprovações). Servem para filtrar pelo prefixo; a ordenação é de poucas linhas.
  Corrigir quando uma dessas listas crescer.

Índice grande em produção: o migrador do Drizzle roda cada migração numa transação, e `CREATE INDEX CONCURRENTLY`
não roda em transação. Com tabelas grandes, crie o índice à mão com `CONCURRENTLY` antes do deploy e deixe a
migração com `CREATE INDEX IF NOT EXISTS`.

## 5. Paginação e contagens

- Todas as listas usam `pagina`/`porPagina` (máx. 100) com `OFFSET` e `count(*)` separado, porque a tela mostra o
  total de páginas. Medido na oficina grande: página 1 000 de orçamentos em 25 ms; contagem de 300 mil orçamentos
  em ~30 ms.
- **Cursor** (`(criado_em, id) < (...)`) só quando uma lista passar de ~1 milhão de linhas numa oficina ou a página
  profunda passar de 300 ms (p95). Aí o total vira aproximado ou some ("mais resultados").

## 6. Painel, relatórios e estoque

- **Painel:** 12 a 14 comandos, todos agregações da oficina (clientes, veículos, orçamentos do período, alertas).
  Na oficina grande: 385 ms (vendedor: 285 ms) calculado; **em cache no Redis por até 60 s** (3 ms no acerto,
  [ADR 0001](../decisoes/0001-redis-cache-de-leitura.md)). Sem materialized view. Reavaliar o cálculo se passar de
  1 s (p95) sem cache.
- **Relatórios:** prévia de 50 linhas; CSV de até 50 000 linhas montado em memória, na mesma transação. O
  `statement_timeout` de 30 s protege o pool. Relatório mais pesado: gerar num worker (job assíncrono) e baixar
  depois.
- **Estoque:** o saldo atual é gravado (`estoques`, com `FOR UPDATE` e versão) e o histórico fica à parte
  (`estoque_ajustes`); o saldo nunca é recalculado pelos movimentos. A lista (produto × depósito) leva 86 ms com
  30 mil produtos e 3 depósitos; reescrever só se passar de 300 ms.

## 7. Conexões, transações e escala horizontal

- **Pool por instância:** `DB_POOL_MAX` (padrão 10), conexão ociosa fecha em 60 s, renovada a cada 30 min, sem
  banco em 10 s falha. **Regra:** `instâncias × DB_POOL_MAX + ~10 (migração, backup, administração) ≤
  max_connections` (padrão 100). Com 10: até ~9 instâncias. Mais que isso: PgBouncer em modo transaction na frente
  do Postgres (compatível: o `set_config(..., true)` do `withTenant` vale só na transação).
- **Limites de tempo** (parâmetros da conexão da API): `DB_STATEMENT_TIMEOUT_MS` (30 s) cancela consulta
  descontrolada; `DB_IDLE_TX_TIMEOUT_MS` (60 s) encerra transação esquecida aberta.
- **Transações curtas:** uma por requisição (`withTenant`), mais uma curta para autenticar (uma consulta: usuário,
  funções, permissões e vendedor). Nunca chamar serviço externo dentro de `withTenant`.
- **Sem estado na API:** sessão em JWT, limite de login no banco, arquivos no banco. Qualquer instância atende
  qualquer requisição. `GET /api/saude` só responde 200 com o banco respondendo (prontidão para balanceador).
- **Concorrência:** travas de linha (`FOR UPDATE`) e versão otimista nos cadastros, orçamentos e estoque; contadores
  por oficina em `contadores`. O log do Postgres registra esperas por trava (`log_lock_waits`).

### Oficina grande × oficinas pequenas (tenant skew)

Medido (`bench:carga`, 20 usuários da oficina grande sem pausa, 1 instância): a oficina pequena vai de 9 ms (p50,
sozinha) para 249 ms com pool de 10; 82 ms com 20; 368 ms com 5. A vazão total não muda (~50 req/s): o limite é o
banco, e as requisições esperam conexão livre. Sem erros depois do ajuste de `shm_size` (§10).

Com o Painel em cache no Redis (pool de 10): vazão 48 → 158 req/s, p95 da oficina grande 1 112 → 319 ms e mediana da
oficina pequena durante a carga 262 → 80 ms ([RESULTADOS.md](RESULTADOS.md#cache-do-painel-redis)).

Mitigações, na ordem: (1) consultas baratas e o Painel em cache (feito); (2) pool dimensionado para o banco de produção (medir
com `bench:carga` no servidor real); (3) mais instâncias + PgBouncer; (4) limite de requisições simultâneas por
oficina, com estado compartilhado (Redis ou `pg_try_advisory_lock`), se uma oficina ainda degradar as outras.

## 8. Observabilidade

- **`pg_stat_statements`** (migração 0027 + `shared_preload_libraries` no compose), `track_io_timing` e log de
  consultas acima de `DB_LOG_LENTAS_MS` (500 ms). Consultas mais caras:

  ```sql
  select round(total_exec_time) total_ms, calls, round(mean_exec_time::numeric, 1) media_ms,
         shared_blks_read, left(query, 120)
  from pg_stat_statements order by total_exec_time desc limit 20;
  ```

- **Tabelas e índices:** tamanho (`pg_total_relation_size`), linhas mortas e último autovacuum
  (`pg_stat_user_tables`), índices nunca usados (`pg_stat_user_indexes where idx_scan = 0`).
- **Cache (Redis):** taxa de acerto por `redis-cli info stats` (`keyspace_hits`/`keyspace_misses`), memória e
  descartes (`used_memory_human`, `evicted_keys`); na API, `cache: acerto | falta | gravado` (debug) e `cache: erro`
  (warn). Ver o ADR 0001, §Operação.
- **API:** o log do Fastify registra cada requisição com `responseTime` (JSON no stdout). Métricas p50/p95/p99,
  4xx/5xx e conexões do pool por instância ficam para quando houver coletor (Prometheus/OpenTelemetry, fase 4).
- **Negócio:** orçamentos e aprovações por minuto saem de `orcamentos_eventos`/`aprovacoes_comerciais_eventos`.

## 9. Metas iniciais (SLO)

Calibradas no benchmark; revisar com o tráfego real.

| Tipo | p95 |
|---|---:|
| Consulta simples (detalhe, autenticação) | < 100 ms |
| Lista e busca | < 300 ms |
| Operação transacional (gravar orçamento, emitir) | < 500 ms |
| Painel | < 1 s |

Regressão: rode `pnpm bench --saida` antes e depois de mudar lista, busca, índice ou Painel e compare.

## 10. Infraestrutura do Postgres (docker compose)

- `shm_size: 256mb`: com o padrão do Docker (64 MB), consultas paralelas simultâneas falham com "could not resize
  shared memory segment" (83 erros 500 em 30 s no teste de carga; zero depois).
- `shared_buffers`, `work_mem` e `effective_cache_size` estão no padrão: ajustar no servidor de produção conforme a
  memória dele (referência: `shared_buffers` ≈ 25% da RAM), medindo com `bench:carga`.
- **Autovacuum:** padrão, sem ajuste por tabela (nenhuma evidência de linhas mortas acumuladas). Candidatas a ajuste
  se crescerem com muita alteração: `orcamento_itens` e `orcamentos` (rascunho gravado automaticamente) e
  `estoques`. Sinal: `n_dead_tup` alto e `last_autovacuum` antigo.

## 11. Crescimento e decisões futuras

Tamanho medido no benchmark (com índices): ~290 bytes por item de orçamento, ~1 KB por orçamento. As tabelas que
mais crescem: `orcamento_itens`, `orcamentos_eventos`, `orcamentos`, `precos_eventos`/`precos_padrao_eventos`,
`estoque_ajustes`, `aprovacoes_comerciais_eventos` e `materiais_pmc_eventos`.

| Recurso | Quando adotar |
|---|---|
| Particionamento `RANGE (criado_em)` (tabelas de eventos e movimentos) | Dezenas de milhões de linhas, consultas predominantemente por período e vacuum/índices problemáticos. Nunca uma partição por oficina. |
| Redis | **Adotado como cache de leitura** (Painel), [ADR 0001](../decisoes/0001-redis-cache-de-leitura.md). Próximo uso: limite de requisições por oficina com várias instâncias. Cadastros auxiliares não entram (menos de 1 ms de banco). O Postgres continua a fonte da verdade. |
| Réplica de leitura | Leitura dominante e primário saturado; relatórios e Painel primeiro (aceitam atraso), com estratégia para o atraso de replicação. |
| PgBouncer | Instâncias × pool maior que a capacidade segura do Postgres (§7). |
| UUID v7 | Não migrar: o Postgres 17 não gera v7 nativo, a troca afeta FKs compostas e não há gargalo de inserção medido. Reavaliar com o Postgres 18 (`uuidv7()`) para tabelas novas de eventos. |
| Armazenamento de objetos (S3) | Arquivos grandes/numerosos (fotos do checklist, PDFs), ver ARQUITETURA §9.1. |
| Rate limit das demais rotas | Pendente (próxima fase): o Redis do cache já está disponível para o estado compartilhado. Proteção atual: `statement_timeout`, pool por instância e limite de login. |

## 12. Backup e restauração

- `sh infra/db/backup.sh`: `pg_dump` no formato custom em `backups/` (fora do git), retenção de 14 dias
  (`BACKUP_RETENCAO_DIAS`). Agende no cron do servidor (exemplo no script) e copie para armazenamento externo
  **criptografado** (tem CPF e telefone).
- `sh infra/db/restaurar.sh <arquivo>`: ensaio de restauração num banco separado (`mobios_restauracao`), comparando
  tabelas e linhas com o banco de uso. Faça pelo menos uma vez por mês: backup que não restaura não é backup.
- **Desastre:** pare a API (`docker compose stop api`), crie o banco vazio com o dono `mobios`, rode nele os
  `GRANT`/`ALTER DEFAULT PRIVILEGES` do `infra/db/init.sh` (valem por banco: as tabelas que migrações futuras criarem
  precisam deles), restaure com `pg_restore --no-owner -d mobios <arquivo>` (os `GRANT` das tabelas e funções
  existentes vêm no backup), confira com a contagem de linhas e suba a API.
