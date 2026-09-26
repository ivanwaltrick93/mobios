import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { isolamentoPorTenant, quantidade, tenantId, timestamps } from './comum.js';
import { depositos, materiais } from './materiais.js';
import { users } from './oficina.js';

// ---------- Estoque (saldo por material + depósito) ----------
// Por enquanto o saldo só muda por ajuste manual (estoque_ajustes). Entradas de compra, venda no balcão
// e O.S. virão depois e movimentarão estas mesmas linhas.

/**
 * Saldo de um material num depósito. Chave de negócio = chave primária: (material, depósito).
 * Disponível = tudo o que há no depósito; reservado = parte dele separada para O.S./pedido (CHECK: nunca maior);
 * saldo = disponível − reservado (livre), calculado na consulta.
 */
export const estoques = pgTable(
  'estoques',
  {
    tenantId: tenantId(),
    materialId: uuid().notNull(),
    depositoId: uuid().notNull(),
    disponivel: quantidade().notNull().default(0),
    reservado: quantidade().notNull().default(0),
    atualizadoPor: uuid(),
    versao: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.depositoId] }),
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.depositoId], foreignColumns: [depositos.tenantId, depositos.id] }),
    foreignKey({ columns: [t.tenantId, t.atualizadoPor], foreignColumns: [users.tenantId, users.id] }),
    check('estoques_disponivel_positivo', sql`${t.disponivel} >= 0`),
    check('estoques_reservado_positivo', sql`${t.reservado} >= 0`),
    // Disponível = tudo o que há no depósito; reservado é parte dele. Saldo livre = disponível − reservado.
    check('estoques_reservado_ate_disponivel', sql`${t.reservado} <= ${t.disponivel}`),
    index().on(t.depositoId),
    isolamentoPorTenant('estoques'),
  ],
);

/** Histórico de ajustes manuais: antes/depois, motivo, quem e quando. */
export const estoqueAjustes = pgTable(
  'estoque_ajustes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: tenantId(),
    materialId: uuid().notNull(),
    depositoId: uuid().notNull(),
    disponivelAntes: quantidade().notNull(),
    disponivelDepois: quantidade().notNull(),
    reservadoAntes: quantidade().notNull(),
    reservadoDepois: quantidade().notNull(),
    motivo: text().notNull(),
    usuarioId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.materialId], foreignColumns: [materiais.tenantId, materiais.id] }),
    foreignKey({ columns: [t.tenantId, t.depositoId], foreignColumns: [depositos.tenantId, depositos.id] }),
    foreignKey({ columns: [t.tenantId, t.usuarioId], foreignColumns: [users.tenantId, users.id] }),
    index().on(t.materialId, t.depositoId, t.criadoEm.desc()),
    index().on(t.depositoId),
    isolamentoPorTenant('estoque_ajustes'),
  ],
);
