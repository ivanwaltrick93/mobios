import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Aplica as migrações no banco de testes (mobios_test) antes da suíte. */
export default async function setup() {
  const client = postgres(process.env.DATABASE_MIGRATION_URL!, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: new URL('./drizzle', import.meta.url).pathname });
  await client.end();
}
