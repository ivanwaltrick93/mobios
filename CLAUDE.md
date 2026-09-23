# MobiOS — convenções

Leia `docs/ARQUITETURA.md` antes de mudanças estruturais.

## Multi-tenancy (não negociável)
- Toda tabela de negócio tem `tenantId: tenantId()` e `isolamentoPorTenant('<tabela>')` em `apps/api/src/db/schema.ts`.
- Toda FK entre tabelas de negócio é composta `(tenant_id, x_id)`: checagem de FK ignora RLS.
- Todo acesso a tabelas de negócio passa por `withTenant(req.user.tid, tx => ...)`. Não filtre por tenant_id à mão; o RLS faz isso.
- A API conecta como `mobios_app` (sem superuser/BYPASSRLS). Migrações rodam como `mobios`.
- O teste "toda tabela com tenant_id tem RLS ativo" em `apps/api/src/app.test.ts` precisa continuar passando.

## Código
- Domínio em português (clientes, veiculos, ordens_servico); termos técnicos podem ficar em inglês.
- Dinheiro sempre em centavos (integer). Nunca float.
- Schemas de entrada e saída ficam em `packages/shared` e são usados pela API e pelo front.
- Campos numéricos opcionais vindos de formulário: string vazia vira null, nunca 0.
- Novo módulo: `apps/api/src/modules/<nome>/routes.ts`, registrado em `src/app.ts`.
- Não retorne `reply` de funções async (ele é thenable e trava o await).

## Verificação
`pnpm typecheck && pnpm test`. Para mudança de schema: `pnpm db:generate`, revise o SQL e depois `pnpm db:migrate`.
