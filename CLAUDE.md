# MobiOS — convenções

Leia `docs/ARQUITETURA.md` antes de mudanças estruturais.

## Multi-tenancy (não negociável)
- Toda tabela de negócio tem `tenantId: tenantId()` e `isolamentoPorTenant('<tabela>')` em `apps/api/src/db/schema.ts`.
- Toda FK entre tabelas de negócio é composta `(tenant_id, x_id)`: checagem de FK ignora RLS.
- Todo acesso a tabelas de negócio passa por `withTenant(req.user.tid, tx => ...)`. Não filtre por tenant_id à mão; o RLS faz isso.
- A API conecta como `mobios_app` (sem superuser/BYPASSRLS). Migrações rodam como `mobios`.
- O teste "toda tabela com tenant_id tem RLS ativo" em `apps/api/src/app.test.ts` precisa continuar passando.

## Banco de dados
- Toda tabela tem PK `id uuid` (`uuid().primaryKey().defaultRandom()`), chave natural com índice único quando existir, e índice em toda FK e em colunas de filtro/ordenação frequentes.
- Nunca selecione `senha_hash` fora do login. Usuários não são excluídos: `ativo = false`.
- Rotas restritas: `app.addHook('onRequest', app.autenticar)` e depois `app.exigirPapel('admin', ...)`.

## Escalabilidade horizontal (não negociável)
A API deve funcionar com N réplicas atrás de um balanceador (futuro Kubernetes + HPA). Detalhes em `docs/ARQUITETURA.md` §9.
- Nenhum arquivo no disco do container. Todos os dados ficam no PostgreSQL, inclusive arquivos pequenos (ex.: logo em `tenant_logos.conteudo bytea`, limite 1 MB, tipo validado pelos bytes). Arquivos grandes: ver `docs/ARQUITETURA.md` §9.1.
- Nenhum dado de negócio fixo no front, em `localStorage` ou em memória: tudo é lido do banco pela API.
- Nenhum estado compartilhado em memória (cache, contadores, rate limit, travas): usar Postgres ou Redis.
- Sequências de negócio (número da O.S.) geradas no banco via tabela `contadores`, dentro da transação.
- Nada de `setInterval`/cron dentro da API: tarefas periódicas vão para um worker separado ou usam `pg_try_advisory_lock`.
- Configuração só por variável de ambiente, validada em `apps/api/src/env.ts`.

## Código
- Domínio em português (clientes, veiculos, ordens_servico); termos técnicos podem ficar em inglês.
- Dinheiro sempre em centavos (integer). Nunca float.
- Schemas de entrada e saída ficam em `packages/shared` e são usados pela API e pelo front.
- Campos numéricos opcionais vindos de formulário: string vazia vira null, nunca 0.
- Novo módulo: `apps/api/src/modules/<nome>/routes.ts`, registrado em `src/app.ts`.
- Não retorne `reply` de funções async (ele é thenable e trava o await).
- Schemas usados em `response` não podem ter `.transform()` (o serializador do fastify-type-provider-zod v7 falha com "unidirectional transform"). Separe o schema de entrada (`xInputSchema`, com normalização) do de saída.

## Interface
- Toda cor vem dos tokens de `apps/web/src/index.css` (ver `docs/STYLE_GUIDE.md`). Proibido `slate-*`, `blue-*`, `bg-white`, `text-white` ou hex nas telas.
- Telas usam os componentes de `apps/web/src/components/ui.tsx`.

## Verificação
`pnpm typecheck && pnpm test` (os testes usam o banco `mobios_test`, nunca o de uso). Para mudança de schema: `pnpm db:generate`, revise o SQL e depois `pnpm db:migrate`.
