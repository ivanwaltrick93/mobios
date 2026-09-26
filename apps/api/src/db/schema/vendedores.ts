import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codigoAutomatico, isolamentoPorTenant, tenantId, timestamps } from './comum.js';
import { fksAutoria, users } from './oficina.js';

// ---------- Vendedores (CAD-18) ----------
// Vão ser referenciados por clientes, oportunidades, orçamentos e O.S. pela chave (tenant_id, id).

/**
 * Vendedor = um usuário da oficina (1:1) com função ativa de parâmetro VENDEDOR. Nome e e-mail ficam só no
 * usuário. Não é excluído: inativa por botão ou automaticamente quando o usuário perde a condição.
 */
export const vendedores = pgTable(
  'vendedores',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    codigo: codigoAutomatico('vendedores'),
    usuarioId: uuid().notNull(),
    matricula: text(),
    whatsapp: text().notNull(),
    funcionarioDesde: date(),
    ativo: boolean().notNull().default(true),
    criadoPor: uuid(),
    atualizadoPor: uuid(),
    ...timestamps,
  },
  (t) => [
    unique().on(t.tenantId, t.id),
    uniqueIndex('vendedores_codigo_unico').on(t.tenantId, t.codigo),
    uniqueIndex('vendedores_usuario_unico').on(t.tenantId, t.usuarioId),
    // Matrícula sem diferenciar maiúsculas: "m-01" e "M-01" são a mesma.
    uniqueIndex('vendedores_matricula_unico')
      .on(t.tenantId, sql`upper(${t.matricula})`)
      .where(sql`${t.matricula} is not null`),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    ...fksAutoria(t),
    isolamentoPorTenant('vendedores'),
  ],
);

export const eventoVendedor = pgEnum('evento_vendedor', ['criado', 'alterado', 'inativado', 'reativado']);
export const origemEventoVendedor = pgEnum('origem_evento_vendedor', ['cadastro', 'importacao', 'automatica']);

/** Log de alterações do vendedor (só inclusão): campo, antes e depois, quem e quando. */
export const vendedoresEventos = pgTable(
  'vendedores_eventos',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    vendedorId: uuid().notNull(),
    evento: eventoVendedor().notNull(),
    origem: origemEventoVendedor().notNull(),
    motivo: text(),
    alteracoes: jsonb().$type<{ campo: string; antes: string | null; depois: string | null }[]>().notNull(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.vendedorId], foreignColumns: [vendedores.tenantId, vendedores.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.vendedorId, t.criadoEm.desc()),
    isolamentoPorTenant('vendedores_eventos'),
  ],
);
