import { hash, verify } from '@node-rs/argon2';
import { alterarSenhaSchema, loginSchema, sessaoSchema, type Sessao } from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, withTenant } from '../../db/client.js';
import { tenants, usuarioFotos, users } from '../../db/schema.js';
import { carregarAcesso } from '../../lib/acessos.js';
import { ErroHttp } from '../../lib/erros.js';
import { exigirLoginLiberado, limparFalhasDeLogin, registrarFalhaDeLogin } from '../../lib/limite-login.js';
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
      vendedorId: acesso.vendedorId,
      oficina: { ...linha.oficina, tema: await lerTema(tx), logoVersao: await lerVersaoLogo(tx) },
    };
  });
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/login', { schema: { body: loginSchema, response: { 200: sessaoSchema } } }, async (req, reply) => {
    const origem = { email: req.body.email, ip: req.ip };
    await exigirLoginLiberado(origem);
    // users está sob RLS; a busca por e-mail passa pela função SECURITY DEFINER da migração 0001.
    const [cred] = (await db.execute(
      sql`select * from auth_usuario_por_email(${req.body.email})`,
    )) as unknown as Credencial[];
    const senhaOk = await verify(cred?.senha_hash ?? HASH_FALSO, req.body.senha);
    if (!cred || !senhaOk) {
      await registrarFalhaDeLogin(origem);
      throw new ErroHttp(401, 'E-mail ou senha incorretos');
    }
    if (!cred.ativo) throw new ErroHttp(401, 'Acesso desativado. Fale com o administrador.');
    await limparFalhasDeLogin(origem);

    await reply.iniciarSessao({ sub: cred.id, tid: cred.tenant_id });
    return (await carregarSessao(cred.id, cred.tenant_id))!;
  });

  /** Troca da própria senha. Errar a senha atual conta no limite de tentativas, como no login. */
  app.post('/senha', { onRequest: app.autenticar, schema: { body: alterarSenhaSchema } }, async (req, reply) => {
    const { senhaAtual, novaSenha } = req.body;
    // Único ponto, além do login, que lê senha_hash: a senha atual precisa ser conferida.
    const [usuario] = await withTenant(req.user.tid, (tx) =>
      tx.select({ email: users.email, senhaHash: users.senhaHash }).from(users).where(eq(users.id, req.user.sub)),
    );
    if (!usuario) throw new ErroHttp(401, 'Sessão inválida');
    const origem = { email: usuario.email, ip: req.ip };
    await exigirLoginLiberado(origem);
    if (!(await verify(usuario.senhaHash, senhaAtual))) {
      await registrarFalhaDeLogin(origem);
      throw new ErroHttp(400, 'Senha atual incorreta.');
    }
    const senhaHash = await hash(novaSenha);
    await withTenant(req.user.tid, (tx) => tx.update(users).set({ senhaHash }).where(eq(users.id, req.user.sub)));
    return reply.code(204).send();
  });

  app.post('/logout', async (_req, reply) => reply.encerrarSessao().code(204).send());

  app.get('/sessao', { onRequest: app.autenticar, schema: { response: { 200: sessaoSchema } } }, async (req) => {
    const sessao = await carregarSessao(req.user.sub, req.user.tid);
    if (!sessao) throw new ErroHttp(401, 'Sessão inválida');
    return sessao;
  });
};
