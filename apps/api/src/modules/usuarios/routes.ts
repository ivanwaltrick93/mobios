import { hash } from '@node-rs/argon2';
import { idParamSchema, usuarioAtualizarSchema, usuarioCriarSchema, usuarioSchema } from '@mobios/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

// Nunca selecionar senha_hash aqui: ele não sai da API.
const colunas = { id: users.id, nome: users.nome, email: users.email, papel: users.papel, ativo: users.ativo, criadoEm: users.criadoEm };

/** Gestão de usuários: exclusiva do admin. Não há exclusão, só desativação (preserva o histórico). */
export const usuariosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirPapel('admin'));

  app.get('/', { schema: { response: { 200: z.array(usuarioSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => tx.select(colunas).from(users).orderBy(asc(users.nome))),
  );

  app.post('/', { schema: { body: usuarioCriarSchema, response: { 201: usuarioSchema } } }, async (req, reply) => {
    const { senha, ...dados } = req.body;
    const senhaHash = await hash(senha);
    const [usuario] = await withTenant(req.user.tid, (tx) => tx.insert(users).values({ ...dados, senhaHash }).returning(colunas));
    return reply.code(201).send(usuario!);
  });

  app.put('/:id', { schema: { params: idParamSchema, body: usuarioAtualizarSchema, response: { 200: usuarioSchema } } }, async (req) => {
    const { novaSenha, ...dados } = req.body;
    // Evita que o sistema fique sem admin: ninguém remove o próprio acesso de admin.
    if (req.params.id === req.user.sub && (dados.papel !== 'admin' || !dados.ativo)) {
      throw new ErroHttp(400, 'Você não pode desativar nem remover o acesso de administrador da sua própria conta.');
    }
    const senhaHash = novaSenha ? await hash(novaSenha) : undefined;
    const [usuario] = await withTenant(req.user.tid, (tx) =>
      tx.update(users).set({ ...dados, ...(senhaHash && { senhaHash }) }).where(eq(users.id, req.params.id)).returning(colunas),
    );
    if (!usuario) throw naoEncontrado('Usuário');
    return usuario;
  });
};
