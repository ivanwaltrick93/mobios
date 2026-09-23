import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';

// Executar a partir de apps/api (dev) ou /app (container), onde fica a pasta drizzle/.
// Migrações rodam como dono do banco (DDL); a aplicação usa um usuário sem privilégios.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL não definida');

const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: resolve('drizzle') });
await client.end();
console.log('Migrações aplicadas.');
