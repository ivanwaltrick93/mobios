# Fase 8: resultados medidos

Antes → alteração → depois → ganho, no banco de benchmark (`mobios_bench`, [DATABASE.md §1](DATABASE.md)), em
26/09/2026. Oficina grande: 200 mil clientes, 240 mil veículos, 30 mil produtos, 300 mil orçamentos (1,5 milhão de
itens); mais 5 oficinas médias e 100 pequenas (2,35 milhões de itens no total, ~2 GB). Postgres 17 no Docker
Desktop (12 CPUs, 2 GB), API em processo, 15 repetições por cenário depois de 3 de aquecimento.

## Por tela (oficina grande, salvo indicação)

| Cenário | p50 antes | p50 depois | p95 antes | p95 depois | Ganho (p50) |
|---|---:|---:|---:|---:|---:|
| Painel (mês) | 1 764 | 383 | 1 856 | 390 | 4,6× |
| Painel do vendedor | 1 085 | 286 | 1 186 | 292 | 3,8× |
| Clientes: busca por telefone | 809 | 19 | 817 | 21 | 42× |
| Clientes: busca "mariana prado" | 519 | 17 | 524 | 19 | 30× |
| Clientes: busca "silva" (17 mil resultados) | 484 | 70 | 514 | 79 | 6,9× |
| Clientes: 1ª página | 137 | 13 | 152 | 15 | 10× |
| Orçamentos: busca pelo número | 505 | 8 | 551 | 10 | 60× |
| Orçamentos: busca "silva" (15 mil resultados) | 494 | 152 | 507 | 167 | 3,2× |
| Orçamentos: página 1000 | 390 | 25 | 415 | 28 | 15× |
| Orçamentos: 1ª página | 198 | 15 | 225 | 17 | 13× |
| Orçamentos: situação aprovado | 177 | 16 | 186 | 18 | 11× |
| Orçamentos: do vendedor | 47 | 18 | 51 | 19 | 2,7× |
| Relatório de clientes (prévia, 1 ano) | 213 | 41 | 218 | 45 | 5,2× |
| Veículos: busca "onix" (24 mil resultados) | 180 | 136 | 186 | 139 | 1,3× |
| Produtos: busca "pastilha" | 53 | 26 | 53 | 27 | 2× |
| Produtos: busca por SKU | 52 | 16 | 53 | 18 | 3,3× |
| Estoque: busca "amortecedor" | 75 | 50 | 82 | 51 | 1,5× |
| Orçamento: busca de itens "filtro" | 32 | 23 | 35 | 25 | 1,4× |
| Orçamento: detalhe | 14 | 11 | 16 | 12 | — |
| Autenticação (rota mínima) | 5 | 5 | 8 | 6 | — (7 → 6 comandos) |
| Estoque: 1ª página | 87 | 87 | 89 | 92 | sem mudança |
| Preços: 1ª página / busca | 91 / 116 | 80 / 118 | 98 / 125 | 93 / 129 | sem mudança |
| Aprovações: pendentes | 17 | 16 | 18 | 20 | sem mudança |
| Oficina pequena: orçamentos / busca / preços | 7,6 / 7,4 / 8,9 | 7,4 / 8,4 / 9,0 | — | — | sem mudança |

Tempos em ms, da requisição inteira (autenticação, consultas e serialização). A oficina pequena já era rápida antes:
o índice começa por `tenant_id`, e o RLS a isola da grande.

## O que mudou e por quê

| Alteração | Evidência (EXPLAIN como `mobios_app`) | Efeito |
|---|---|---|
| Busca por trecho em funções `SECURITY DEFINER` + GIN `(tenant_id, coluna)` (migração 0028) | Com RLS, `ILIKE` virava filtro linha a linha sobre as 200 mil linhas da oficina, mesmo com `enable_seqscan = off`: os 13 índices de trigramas nunca eram usados pela aplicação | Buscas de clientes, orçamentos, produtos e serviços 3× a 60× mais rápidas; 13 índices sem uso substituídos |
| Índice `orcamentos_lista (tenant_id, criado_em DESC, numero DESC)` (0029) | A ordem `criado_em, numero` não casava com o índice `(tenant_id, criado_em DESC NULLS LAST)`: ordenação externa em disco das 300 mil linhas (~27 MB) a cada página | 1ª página 118 → 0,6 ms na consulta |
| Paginar ids e juntar depois (orçamentos, veículos) | Busca "silva": junção de cliente, veículo e vendedor para 15 mil linhas antes de cortar em 20 | 594 → 152 ms |
| Contagem sem junções (orçamentos, veículos) | `count(*)` com junção de clientes e veículos: 114 ms; sem: 32 ms | — |
| Subconsulta escalar no lugar de `exists` na lista de colunas (clientes) | `exists` virava uma tabela hash com os 200 mil endereços da oficina para responder 20 linhas (106 ms) | Lista de clientes 133 → 13 ms |
| Painel: alertas em consultas próprias (junção anti) | `not exists` dentro de `count(*) filter` = 400 mil buscas por índice (712 ms) | 843 → 40 + 86 + 64 ms (3 consultas) |
| Painel: aniversariantes pela coluna gerada `clientes.aniversario` (0029) | `dias_ate_aniversario()` calculada para 200 mil clientes (433 ms); `extract()` não é leakproof, então índice de expressão não servia | 433 → 3 ms |
| Períodos por intervalo de instantes (Painel, relatórios) | `(coluna at time zone ...)::date` calculado por linha e sem índice | Situação dos orçamentos do Painel 95 → 7 ms; prévia do relatório 213 → 41 ms |
| Autenticação numa consulta (usuário, funções, permissões, vendedor) | 4 consultas por requisição autenticada | 1 ida ao banco a menos por consulta, em toda requisição |
| Busca no front com pausa de 300 ms e cancelamento | 1 requisição por tecla ("fernando" = 8 buscas + 8 contagens + 8 autenticações) | 1 requisição por busca; a anterior é cancelada |

## Carga concorrente

`pnpm bench:carga` (20 usuários da oficina grande sem pausa, na mistura mais pesada, + 1 usuário de uma oficina
pequena, 30 s, 1 instância):

| Situação | Oficina grande (req/s, p95) | Oficina pequena p50 (sozinha → durante) | Erros |
|---|---|---|---:|
| Antes do `shm_size` (pool 10) | 61,8 req/s, 881 ms | 9 → 211 ms | 83 (HTTP 500) |
| `shm_size: 256mb`, pool 5 | 42,6 req/s, 882 ms | 9 → 368 ms | 0 |
| `shm_size: 256mb`, pool 10 (padrão) | 48,6 req/s, 1 146 ms | 8,5 → 249 ms | 0 |
| `shm_size: 256mb`, pool 20 | 50,6 req/s, 1 937 ms | 9 → 82 ms | 0 |

- Os 83 erros eram do Postgres sem memória compartilhada para consultas paralelas (`/dev/shm` de 64 MB do Docker):
  aconteceriam em produção com o compose anterior.
- Com o banco saturado, a vazão não passa de ~50 req/s nesta máquina; o pool maior reduz a espera da oficina pequena
  e aumenta a cauda da grande. Decisão: pool padrão 10, ajustável (`DB_POOL_MAX`), e medir no servidor real
  ([DATABASE.md §7](DATABASE.md)).

## Limitações

- Dados sintéticos (nomes e datas uniformes); a oficina real pode ter outra distribuição de buscas.
- A medição "antes" é do código anterior (commit `433a4db`) no mesmo banco; o antes da carga concorrente não foi
  medido com o código anterior (só a sequencial).
- Postgres com a configuração padrão de memória, no Docker Desktop: os valores absolutos no servidor de produção
  serão outros. Compare sempre antes e depois no mesmo ambiente.
