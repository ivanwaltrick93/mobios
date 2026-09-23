import { hash, verify } from '@node-rs/argon2';
import { cadastroOficinaSchema, loginSchema, sessaoSchema, type Sessao } from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../../db/client.js';
import { tenants, users } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar contas cadastradas.
const HASH_FALSO = await hash('senha-inexistente');

async function carregarSessao(userId: string): Promise<Sessao | undefined> {
  const [linha] = await db
    .select({ usuario: { id: users.id, nome: users.nome, email: users.email, papel: users.papel }, oficina: { id: tenants.id, nome: tenants.nome } })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, userId));
  return linha;
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/cadastro', { schema: { body: cadastroOficinaSchema, response: { 201: sessaoSchema } } }, async (req, reply) => {
    const { nomeOficina, cnpj, nome, email, senha } = req.body;
    const senhaHash = await hash(senha);

    const { tenant, user } = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ nome: nomeOficina, cnpj }).returning();
      const [user] = await tx.insert(users).values({ tenantId: tenant!.id, nome, email, senhaHash, papel: 'dono' }).returning();
      return { tenant: tenant!, user: user! };
    });

    await reply.iniciarSessao({ sub: user.id, tid: tenant.id, papel: user.papel });
    return reply.code(201).send({
      usuario: { id: user.id, nome: user.nome, email: user.email, papel: user.papel },
      oficina: { id: tenant.id, nome: tenant.nome },
    });
  });

  app.post('/login', { schema: { body: loginSchema, response: { 200: sessaoSchema } } }, async (req, reply) => {
    const [user] = await db.select().from(users).where(eq(users.email, req.body.email));
    const senhaOk = await verify(user?.senhaHash ?? HASH_FALSO, req.body.senha);
    if (!user || !senhaOk || !user.ativo) throw new ErroHttp(401, 'E-mail ou senha incorretos');

    await reply.iniciarSessao({ sub: user.id, tid: user.tenantId, papel: user.papel });
    return (await carregarSessao(user.id))!;
  });

  app.post('/logout', async (_req, reply) => reply.encerrarSessao().code(204).send());

  app.get('/sessao', { onRequest: app.autenticar, schema: { response: { 200: sessaoSchema } } }, async (req) => {
    const sessao = await carregarSessao(req.user.sub);
    if (!sessao) throw new ErroHttp(401, 'Sessão inválida');
    return sessao;
  });
};
