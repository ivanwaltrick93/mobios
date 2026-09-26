import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { temAcesso, type Acessos, type ModuloId, type Nivel } from '@mobios/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { withTenant } from '../db/client.js';
import { env } from '../env.js';
import { carregarAcesso } from './acessos.js';
import { ErroHttp } from './erros.js';

export const COOKIE_SESSAO = 'mobios_sessao';
const DURACAO_SEGUNDOS = 60 * 60 * 12; // um turno de trabalho

/** O token só identifica o usuário; funções, permissões e status vêm do banco a cada requisição. */
export type Token = { sub: string; tid: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Token;
    user: Token & { admin: boolean; acessos: Acessos; vendedorId: string | null; mecanico: boolean };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest) => Promise<void>;
    /** Nível mínimo no módulo (editar inclui consultar). */
    exigirAcesso: (modulo: ModuloId, nivel?: Nivel) => (req: FastifyRequest) => Promise<void>;
    /** Exclusivo da função Administrador: usuários, funções e configurações. */
    exigirAdmin: (req: FastifyRequest) => Promise<void>;
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
    // Lido do banco a cada requisição: desativar alguém ou mudar funções e permissões vale na hora.
    const acesso = await withTenant(token.tid, (tx) => carregarAcesso(tx, token.sub));
    if (!acesso?.ativo) throw new ErroHttp(401, 'Acesso desativado. Fale com o administrador.');
    req.user = {
      sub: token.sub,
      tid: token.tid,
      admin: acesso.admin,
      acessos: acesso.acessos,
      vendedorId: acesso.vendedorId,
      mecanico: acesso.mecanico,
    };
  });

  // Usar depois de `autenticar`. Níveis configurados em Configurações → Funções e permissões.
  app.decorate('exigirAcesso', (modulo: ModuloId, nivel: Nivel = 'consultar') => async (req: FastifyRequest) => {
    if (!temAcesso(req.user.acessos, modulo, nivel)) throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
  });

  app.decorate('exigirAdmin', async (req: FastifyRequest) => {
    if (!req.user.admin) throw new ErroHttp(403, 'Apenas o Administrador pode fazer isto.');
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
