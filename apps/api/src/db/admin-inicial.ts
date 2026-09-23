import { hash } from '@node-rs/argon2';
import { usuarioCriarSchema } from '@mobios/shared';
import { count, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { tenants, users } from './schema.js';

type Banco = PostgresJsDatabase<Record<string, unknown>>;

/** Cria uma oficina com seu usuário admin. A senha é gravada apenas como hash Argon2id. */
export async function criarOficinaComAdmin(banco: Banco, dados: { oficina: string; nome: string; email: string; senha: string }) {
  const admin = usuarioCriarSchema.parse({ nome: dados.nome, email: dados.email, senha: dados.senha, papel: 'admin' });
  const senhaHash = await hash(admin.senha);
  return banco.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ nome: dados.oficina }).returning();
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant!.id}, true)`);
    const [user] = await tx.insert(users).values({ nome: admin.nome, email: admin.email, senhaHash, papel: 'admin' }).returning();
    return { tenant: tenant!, user: user! };
  });
}

/**
 * Na primeira instalação (nenhum usuário no banco), cria a oficina e o admin a partir do ambiente.
 * Deve rodar com a conexão do dono do banco, que enxerga todas as oficinas.
 */
export async function garantirAdminInicial(banco: Banco, env: NodeJS.ProcessEnv) {
  const [{ total }] = (await banco.select({ total: count() }).from(users)) as [{ total: number }];
  if (total > 0) return 'existente' as const;

  if (!env.ADMIN_EMAIL || !env.ADMIN_SENHA) {
    throw new Error('Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA no .env para criar o admin inicial.');
  }
  await criarOficinaComAdmin(banco, {
    oficina: env.OFICINA_NOME || 'Minha Oficina',
    nome: env.ADMIN_NOME || 'Administrador',
    email: env.ADMIN_EMAIL,
    senha: env.ADMIN_SENHA,
  });
  return 'criado' as const;
}
