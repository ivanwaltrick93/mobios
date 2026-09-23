import { hash, verify } from '@node-rs/argon2';
import { loginSchema, sessaoSchema, type Sessao } from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, withTenant } from '../../db/client.js';
import { tenants, usuarioFotos, users } from '../../db/schema.js';
import { carregarAcesso } from '../../lib/acessos.js';
import { ErroHttp } from '../../lib/erros.js';
import { lerTema, lerVersaoLogo } from '../../lib/marca.js';
import { versaoFoto } from '../fotos/routes.js';

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar contas cadastradas.
const HASH_FALSO = await hash('senha-inexistente');

type Credencial = { id: string; tenant_id: string; senha_hash: string; ativo: boolean };

async function carregarSessao(userId: string, tenantId: string): Promise<Sessao | undefined> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({
        usuario: { id: users.id, nome: users.nome, email: users.email },
        oficina: { id: tenants.id, nome: tenants.nome },
        fotoEm: usuarioFotos.atualizadoEm,
      })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .leftJoin(usuarioFotos, eq(usuarioFotos.usuarioId, users.id))
      .where(eq(users.id, userId));
    const acesso = await carregarAcesso(tx, userId);
    if (!linha || !acesso) return undefined;
    return {
      usuario: { ...linha.usuario, fotoVersao: versaoFoto(linha.fotoEm), admin: acesso.admin, funcoes: acesso.funcoes },
      acessos: acesso.acessos,
      oficina: { ...linha.oficina, tema: await lerTema(tx), logoVersao: await lerVersaoLogo(tx) },
    };
  });
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/login', { schema: { body: loginSchema, response: { 200: sessaoSchema } } }, async (req, reply) => {
    // users está sob RLS; a busca por e-mail passa pela função SECURITY DEFINER da migração 0001.
    const [cred] = (await db.execute(
      sql`select * from auth_usuario_por_email(${req.body.email})`,
    )) as unknown as Credencial[];
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
