import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { garantirAdminInicial } from './admin-inicial.js';

// Executar a partir de apps/api (dev) ou /app (container), onde fica a pasta drizzle/.
// Migrações rodam como dono do banco (DDL); a aplicação usa um usuário sem privilégios.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL não definida');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  const banco = drizzle(client, { casing: 'snake_case' });
  await migrate(banco, { migrationsFolder: resolve('drizzle') });
  console.log('Migrações aplicadas.');
  const admin = await garantirAdminInicial(banco, process.env);
  console.log(
    admin === 'criado'
      ? `Admin inicial criado: ${process.env.ADMIN_EMAIL}`
      : 'Usuários já existentes; admin inicial não foi criado.',
  );
} finally {
  await client.end();
}
