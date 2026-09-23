import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

export const sqlClient = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(sqlClient, { schema, casing: 'snake_case' });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Executa `fn` numa transação com app.tenant_id definido. Toda leitura e escrita
 * em tabelas de negócio precisa passar por aqui: fora dela o RLS devolve zero linhas.
 */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
