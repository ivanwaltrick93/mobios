import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Aplica as migrações no banco de testes (mobios_test) antes da suíte. */
export default async function setup() {
  const client = postgres(process.env.DATABASE_MIGRATION_URL!, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: new URL('./drizzle', import.meta.url).pathname });
  // Falhas de login de execuções anteriores não podem bloquear o IP dos testes (127.0.0.1).
  await client`delete from login_tentativas`;
  await client.end();
}
