import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { Papel } from '@mobios/shared';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { withTenant } from '../db/client.js';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { ErroHttp } from './erros.js';

export const COOKIE_SESSAO = 'mobios_sessao';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // um turno de trabalho

/** O token só identifica o usuário; papel e status vêm do banco a cada requisição. */
export type Token = { sub: string; tid: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Token;
    user: Token & { papel: Papel };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest) => Promise<void>;
    exigirPapel: (...papeis: Papel[]) => (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyReply {
    iniciarSessao: (token: Token) => Promise<void>;
    encerrarSessao: () => FastifyReply;
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_SESSAO, signed: false },
    sign: { expiresIn: DURACAO_SEGUNDOS },
  });

  app.decorate('autenticar', async (req: FastifyRequest) => {
    let token: Token;
    try {
      token = await req.jwtVerify<Token>();
    } catch {
      throw new ErroHttp(401, 'Sessão expirada. Entre novamente.');
    }
    // Consulta pela PK a cada requisição: desativar ou trocar a função de alguém vale na hora.
    const [usuario] = await withTenant(token.tid, (tx) =>
      tx.select({ papel: users.papel, ativo: users.ativo }).from(users).where(eq(users.id, token.sub)),
    );
    if (!usuario?.ativo) throw new ErroHttp(401, 'Acesso desativado. Fale com o administrador.');
    req.user = { sub: token.sub, tid: token.tid, papel: usuario.papel };
  });

  // Usar depois de `autenticar` (que preenche req.user.papel).
  app.decorate('exigirPapel', (...papeis: Papel[]) => async (req: FastifyRequest) => {
    if (!papeis.includes(req.user.papel)) throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
  });

  app.decorateReply('iniciarSessao', async function (this: FastifyReply, token: Token) {
    const assinado = await this.jwtSign(token);
    // Não retornar o reply: ele é thenable e o `await` do chamador travaria até a resposta ser enviada.
    this.setCookie(COOKIE_SESSAO, assinado, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      maxAge: DURACAO_SEGUNDOS,
    });
  });

  app.decorateReply('encerrarSessao', function (this: FastifyReply) {
    return this.clearCookie(COOKIE_SESSAO, { path: '/' });
  });
});
