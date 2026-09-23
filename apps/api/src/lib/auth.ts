import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { Papel } from '@mobios/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { ErroHttp } from './erros.js';

export const COOKIE_SESSAO = 'mobios_sessao';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // um turno de trabalho

export type Token = { sub: string; tid: string; papel: Papel };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Token;
    user: Token;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest) => Promise<void>;
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
    try {
      await req.jwtVerify();
    } catch {
      throw new ErroHttp(401, 'Sessão expirada. Entre novamente.');
    }
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
