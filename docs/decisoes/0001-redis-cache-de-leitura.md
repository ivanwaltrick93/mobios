# 0001 — Redis como cache de leitura

- **Situação:** aceita (26/09/2026)
- **Onde está:** `apps/api/src/lib/cache.ts`, serviço `redis` do `docker-compose.yml`, `GET /api/painel`
- **Relacionadas:** [ARQUITETURA §3.1](../ARQUITETURA.md), [DATABASE.md](../performance/DATABASE.md),
  [RESULTADOS.md](../performance/RESULTADOS.md)

As decisões de arquitetura ficam nesta pasta, numeradas, uma por arquivo: contexto, decisão, alternativas e
consequências. Decisão revista vira outro arquivo, que aponta para a anterior.

## Contexto

Depois da Fase 8 (índices, busca sob RLS, Painel reescrito), a medição na oficina grande do banco de benchmark
mostrou onde ainda se gastava tempo de banco em leituras:

| Rota | Requisição (p50) | Tempo no banco |
|---|---:|---:|
| Painel | 451 ms | 422 ms (12 a 14 comandos) |
| Produtos, 1ª página | 19 ms | 10 ms |
| Tabelas de preço | 17 ms | 8,6 ms |
| Categorias, marcas, depósitos, vendedores, aparência, alçada, sessão | 4,4 a 6,1 ms | 0,06 a 1 ms |

Nos cadastros auxiliares, quase todo o tempo é fixo (autenticação, transação, serialização): um cache economizaria
menos de 1 ms e ainda traria dado desatualizado. O Painel é a exceção: é a página inicial, a mais aberta, e só ela
custa centenas de milissegundos. Sob carga (20 usuários simultâneos), ele era o que mais ocupava o pool e fazia uma
oficina grande atrasar as pequenas.

## Decisão

1. **Redis 8 como cache de leitura, com o PostgreSQL como única fonte da verdade.** Nada é gravado só no Redis;
   perder o Redis perde só velocidade.
2. **Cache-aside por uma função única**, `obterOuCarregar(chave, prazo, carregar, log)` em `lib/cache.ts`. Nenhuma
   rota usa o cliente Redis direto.
3. **Só o Painel em cache nesta fase**, por até 60 s (`CACHE_TTL_PAINEL_S`, com variação de ±10%), **só por prazo**:
   ele agrega clientes, veículos, orçamentos e aprovações, e invalidar a cada gravação nesses módulos seria a parte
   mais complexa e a mais fácil de esquecer. A tela mostra "atualizado às HH:MM".
4. **Chave** `mobios:{NODE_ENV}:t:{tenantId}:painel:v1:{hoje}:{período}:{perfil}`:
   - `tenantId` vem da sessão, nunca de parâmetro;
   - `perfil` é um resumo (SHA-256, 16 caracteres) de admin, acessos efetivos e vendedor: o Painel monta blocos
     conforme a permissão, e nenhum perfil recebe o de outro; mudar a função de alguém muda a chave na hora;
   - `hoje` evita o Painel de ontem depois da meia-noite; `v1` muda quando o formato da resposta mudar.
5. **Autorização nunca vem do cache.** A sessão, as permissões e a alçada são relidas do banco a cada requisição, e o
   cache só é consultado depois da autenticação e da checagem de acesso.
6. **Fora do caminho crítico:** conexão em até 100 ms, 50 ms por comando, sem fila de comandos com o Redis fora do
   ar (a leitura falha na hora e cai no Postgres), reconexão em segundo plano, aviso no log no máximo a cada 30 s.
   Sem `REDIS_URL`, o cache fica desligado. O `/api/saude` não depende do Redis.
7. **Redis sem persistência** (`--save ""`, `appendonly no`), com `maxmemory 128mb` e `allkeys-lru`, senha
   (`REDIS_PASSWORD`), só na rede interna do Docker (a porta é publicada só em `127.0.0.1`, para o dev e os testes).
   Redis gerenciado fora da rede privada: `rediss://` (TLS).

## Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Cachear cadastros auxiliares, produtos e buscas (como sugeria a proposta inicial) | Menos de 1 ms de banco nos auxiliares; nas buscas, a chave muda a cada tecla (acerto baixo). Risco de dado velho sem ganho medível. O navegador já guarda esses dados (TanStack Query). |
| Invalidar o Painel a cada gravação | Ganho pequeno (60 s de atraso é aceitável para indicadores) e custo alto: todo módulo que grava teria de lembrar do Painel. |
| Materialized view no Postgres | Atualização em lote para todas as oficinas, com atraso maior, e o custo continua no banco. |
| Cache em memória da API | Diferente entre réplicas e perdido a cada deploy; a regra de escalabilidade (ARQUITETURA §9) pede estado fora da instância. |
| Valkey (fork BSD) | Compatível e viável; a escolha foi o Redis 8, cuja opção de licença AGPLv3 combina com o projeto. Trocar a imagem é só configuração. |
| `redis` (node-redis) em vez de `ioredis` | O `ioredis` já tem tempo por comando e falha imediata sem fila (`commandTimeout`, `enableOfflineQueue: false`), o que o fallback exige. |

## Consequências

- **Medido** (banco de benchmark, oficina grande): Painel 397 ms → 3,1 ms no acerto (14 → 3 comandos SQL, só os da
  autenticação). Sob carga (`bench:carga`, 20 usuários): vazão 48 → 158 req/s, p95 da oficina grande 1 112 → 319 ms e
  mediana da oficina pequena durante a carga 262 → 80 ms.
- O Painel pode mostrar até ~66 s de atraso depois de uma gravação. As telas de destino (listas, aprovações) continuam
  lendo o banco.
- Mais um serviço para operar (memória, senha, rede). Como é descartável, não entra no backup.
- Não há prevenção de "estouro" (muitas faltas simultâneas da mesma chave): com o Painel por oficina e perfil, o pior
  caso é algumas leituras repetidas no banco. Rever se `bench:carga` mostrar picos na expiração.

## Governança: toda leitura nova avalia o cache

Não é "usar Redis"; é **decidir explicitamente**. Antes de criar uma leitura (rota GET, consulta de apoio, painel,
relatório):

1. **É cara?** Tempo de banco medido (`pnpm --filter @mobios/api bench`, `sh infra/bench/explicar.sh`). Sem custo
   relevante (dezenas de ms, repetido muitas vezes), **não cachear**.
2. **Tolera atraso? Quanto?** Autorização, sessão, alçada, aprovação, estoque, saldo, preço do dia, PMC, margem,
   orçamento em edição e qualquer dado que decida uma gravação: **nunca** do cache.
3. **Como se invalida?** Só por prazo (dados agregados) ou apagando a chave depois do COMMIT (dado de uma entidade:
   `await withTenant(...)` e só então apagar a chave). Sem invalidação clara, não cachear.
4. **A resposta depende de quem pede?** Então o perfil de acesso (ou o usuário) entra na chave.
5. **A chave tem o tenant da sessão?** Sempre. Nunca parâmetro vindo da requisição.
6. **Dado pessoal ou sensível?** Minimize o que vai para o cache e o prazo; custos, PMC e margem ficam fora.

Registre a decisão na documentação do módulo quando o cache for usado, ou quando parecer óbvio e não for (ex.:
"lista de preços sem cache: preço do dia decide o orçamento"). Leitura simples e barata não precisa de registro.
Novo dado em cache: prazo em `PRAZOS_CACHE` (`lib/cache.ts`), linha na tabela abaixo, testes de acerto, falta,
isolamento entre oficinas e perfis, e medição antes/depois.

| Dado em cache | Chave | Prazo | Invalidação |
|---|---|---|---|
| Painel | `…:t:{tenant}:painel:v1:{hoje}:{período}:{perfil}` | 60 s (±10%) | Só prazo |

## Operação

- Memória e descartes: `docker compose exec redis redis-cli info memory` (`used_memory_human`) e `info stats`
  (`evicted_keys`, `keyspace_hits`, `keyspace_misses` para a taxa de acerto).
- Log da API (nível debug): `cache: acerto | falta | gravado`, com a chave (sem dado pessoal) e a duração; `cache: erro`
  (nível warn, no máximo a cada 30 s) quando o Redis falha.
- Desligar o cache: remover `REDIS_URL` (ou `CACHE_TTL_PAINEL_S=0`) e reiniciar a API.
- Limpar tudo (ex.: após mudança de formato sem trocar a versão da chave): `redis-cli flushdb`. Seguro: é só cache.
