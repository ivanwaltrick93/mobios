import { hash, verify } from '@node-rs/argon2';
import { loginSchema, sessaoSchema, type Papel, type Sessao } from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, withTenant } from '../../db/client.js';
import { tenantLogos, tenants, users } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar contas cadastradas.
const HASH_FALSO = await hash('senha-inexistente');

type Credencial = { id: string; tenant_id: string; senha_hash: string; papel: Papel; ativo: boolean };

async function carregarSessao(userId: string, tenantId: string): Promise<Sessao | undefined> {
  const [linha] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        usuario: { id: users.id, nome: users.nome, email: users.email, papel: users.papel },
        oficina: { id: tenants.id, nome: tenants.nome, corPrimaria: tenants.corPrimaria, corMenu: tenants.corMenu },
        logoAtualizadoEm: tenantLogos.atualizadoEm,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(tenantLogos, eq(tenantLogos.tenantId, users.tenantId))
      .where(eq(users.id, userId)),
  );
  if (!linha) return undefined;
  const { corPrimaria, corMenu, ...oficina } = linha.oficina;
  const logoVersao = linha.logoAtualizadoEm ? String(linha.logoAtualizadoEm.getTime()) : null;
  return { usuario: linha.usuario, oficina: { ...oficina, tema: { corPrimaria, corMenu }, logoVersao } };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/login', { schema: { body: loginSchema, response: { 200: sessaoSchema } } }, async (req, reply) => {
    // users está sob RLS; a busca por e-mail passa pela função SECURITY DEFINER da migração 0001.
    const [cred] = (await db.execute(sql`select * from auth_usuario_por_email(${req.body.email})`)) as unknown as Credencial[];
    const senhaOk = await verify(cred?.senha_hash ?? HASH_FALSO, req.body.senha);
    if (!cred || !senhaOk) throw new ErroHttp(401, 'E-mail ou senha incorretos');
    if (!cred.ativo) throw new ErroHttp(401, 'Acesso desativado. Fale com o administrador.');

    await reply.iniciarSessao({ sub: cred.id, tid: cred.tenant_id });
    return (await carregarSessao(cred.id, cred.tenant_id))!;
  });

  app.post('/logout', async (_req, reply) => reply.encerrarSessao().code(204).send());

  app.get('/sessao', { onRequest: app.autenticar, schema: { response: { 200: sessaoSchema } } }, async (req) => {
    const sessao = await carregarSessao(req.user.sub, req.user.tid);
    if (!sessao) throw new ErroHttp(401, 'Sessão inválida');
    return sessao;
  });
};
