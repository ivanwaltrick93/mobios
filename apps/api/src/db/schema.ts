import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, unique, integer, pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
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
const tenantId = () =>
  uuid()
    .notNull()
    .references(() => tenants.id)
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`);

/**
 * Toda tabela de negócio DEVE usar esta política. Ela ativa o RLS na tabela e
 * restringe leitura e escrita às linhas da oficina corrente.
 */
const isolamentoPorTenant = (tabela: string) =>
  pgPolicy(`${tabela}_isolamento_tenant`, {
    for: 'all',
    using: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });

// ---------- Globais (sem RLS: lidas antes de o tenant ser conhecido) ----------

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  cnpj: text(),
  plano: text().notNull().default('gratuito'),
  ...timestamps,
});

export const papel = pgEnum('papel', ['dono', 'atendente', 'mecanico', 'financeiro']);

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    nome: text().notNull(),
    email: text().notNull(),
    senhaHash: text().notNull(),
    papel: papel().notNull(),
    ativo: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.email), index().on(t.tenantId)],
);

// ---------- Negócio (com RLS) ----------

export const tipoPessoa = pgEnum('tipo_pessoa', ['PF', 'PJ']);

export const clientes = pgTable(
  'clientes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tipo: tipoPessoa().notNull().default('PF'),
    nome: text().notNull(),
    cpfCnpj: text(),
    telefone: text(),
    email: text(),
    observacoes: text(),
    ...timestamps,
  },
  (t) => [
    // Alvo das FKs compostas: garante que filhos só apontem para linhas do mesmo tenant.
    unique().on(t.tenantId, t.id),
    uniqueIndex().on(t.tenantId, t.cpfCnpj).where(sql`${t.cpfCnpj} is not null`),
    index().on(t.tenantId, t.nome),
    isolamentoPorTenant('clientes'),
  ],
);

export const veiculos = pgTable(
  'veiculos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    clienteId: uuid().notNull(),
    placa: text().notNull(),
    marca: text().notNull(),
    modelo: text().notNull(),
    ano: integer(),
    cor: text(),
    chassi: text(),
    kmAtual: integer(),
    ...timestamps,
  },
  (t) => [
    // FK composta: checagens de FK ignoram o RLS, então sem o tenant_id aqui uma
    // oficina poderia vincular um veículo ao cliente de outra (conhecendo o UUID).
    foreignKey({ columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    uniqueIndex().on(t.tenantId, t.placa),
    index().on(t.clienteId),
    isolamentoPorTenant('veiculos'),
  ],
);
