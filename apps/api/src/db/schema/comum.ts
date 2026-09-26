import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Colunas, política de RLS e helpers comuns; `tenants` fica aqui porque toda tabela de negócio a referencia.

export const timestamps = {
  criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Coluna tenant_id preenchida pelo próprio banco a partir de app.tenant_id,
 * que é definido por withTenant() no início de cada transação.
 */
export const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id)
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`);

/**
 * Toda tabela de negócio DEVE usar esta política. Ela ativa o RLS na tabela e
 * restringe leitura e escrita às linhas da oficina corrente.
 */
export const isolamentoPorTenant = (tabela: string) =>
  pgPolicy(`${tabela}_isolamento_tenant`, {
    for: 'all',
    using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });

/**
 * Código sequencial por oficina, gerado pelo banco no INSERT (função `proximo_codigo`, migração 0018) a partir
 * da tabela `contadores`, na mesma transação: nunca se repete nem é reaproveitado. Um trigger impede alterá-lo.
 */
export const codigoAutomatico = (chave: string) =>
  integer()
    .notNull()
    .default(sql.raw(`proximo_codigo('${chave}')`));

// ---------- Global (sem RLS) ----------

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  cnpj: text(),
  plano: text().notNull().default('gratuito'),
  ...timestamps,
});

/**
 * Lista editável por oficina (Configurações, uma página por lista): código automático, nome, descrição e status.
 * Desativar tira da escolha sem mexer nos registros que já usam; excluir só o que nunca foi usado (FK RESTRICT).
 */
export const listaDeOpcoes = (tabela: string) =>
  pgTable(
    tabela,
    {
      id: uuid().primaryKey().defaultRandom(),
      tenantId: tenantId(),
      codigo: codigoAutomatico(tabela),
      nome: text().notNull(),
      descricao: text(),
      ativa: boolean().notNull().default(true),
      ...timestamps,
    },
    (t) => [
      unique().on(t.tenantId, t.id),
      uniqueIndex(`${tabela}_codigo_unico`).on(t.tenantId, t.codigo),
      uniqueIndex(`${tabela}_nome_unico`).on(t.tenantId, sql`lower(${t.nome})`),
      isolamentoPorTenant(tabela),
    ],
  );

export const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Quantidade com até 3 casas (litro, quilo, metro); devolvida como número pela API. */
export const quantidade = () => numeric({ precision: 14, scale: 3, mode: 'number' });
