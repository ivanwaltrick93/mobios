import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { garantirAdminInicial } from './admin-inicial.js';

// Executar a partir de apps/api (dev) ou /app (container), onde fica a pasta drizzle/.
// Migrações rodam como dono do banco (DDL); a aplicação usa um usuário sem privilégios.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL não definida');

// Uma conexão só: a trava abaixo vale para a sessão, e as migrações rodam nela.
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  // Duas execuções ao mesmo tempo (Job repetido, deploys sobrepostos) esperariam uma pela outra em vez de aplicar a
  // mesma migração em paralelo: o migrador do Drizzle não trava sozinho. Solta ao fechar a conexão.
  await client`select pg_advisory_lock(hashtext('mobios:migracoes'))`;
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
