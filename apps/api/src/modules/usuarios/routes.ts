import { hash } from '@node-rs/argon2';
import { idParamSchema, usuarioAtualizarSchema, usuarioCriarSchema, usuarioSchema, type Usuario } from '@mobios/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { funcoes, usuarioFotos, usuarioFuncoes, users } from '../../db/schema.js';
import { funcoesAtivasValidas } from '../../lib/acessos.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { versaoFoto } from '../fotos/routes.js';

// Nunca selecionar senha_hash aqui: ele não sai da API.
async function listar(tx: Tx, id?: string): Promise<Usuario[]> {
  const lista = await tx
    .select({
      id: users.id,
      nome: users.nome,
      email: users.email,
      ativo: users.ativo,
      criadoEm: users.criadoEm,
      fotoEm: usuarioFotos.atualizadoEm,
    })
    .from(users)
    .leftJoin(usuarioFotos, eq(usuarioFotos.usuarioId, users.id))
    .where(id ? eq(users.id, id) : undefined)
    .orderBy(asc(users.nome));
  const vinculos = lista.length
    ? await tx
        .select({
          usuarioId: usuarioFuncoes.usuarioId,
          id: funcoes.id,
          nome: funcoes.nome,
          admin: funcoes.admin,
          ativa: funcoes.ativa,
        })
        .from(usuarioFuncoes)
        .innerJoin(funcoes, eq(funcoes.id, usuarioFuncoes.funcaoId))
        .where(
          inArray(
            usuarioFuncoes.usuarioId,
            lista.map((u) => u.id),
          ),
        )
        .orderBy(asc(funcoes.nome))
    : [];
  return lista.map(({ fotoEm, ...u }) => ({
    ...u,
    fotoVersao: versaoFoto(fotoEm),
    funcoes: vinculos.filter((v) => v.usuarioId === u.id).map(({ usuarioId: _, ...f }) => f),
  }));
}

/**
 * Troca as funções ATIVAS do usuário. Vínculos com funções desativadas são mantidos:
 * não dão acesso agora, mas voltam a valer se a função for reativada.
 */
async function trocarFuncoes(tx: Tx, usuarioId: string, funcaoIds: string[]) {
  const { validas } = await funcoesAtivasValidas(tx, funcaoIds);
  if (!validas) throw new ErroHttp(400, 'Escolha apenas funções ativas desta oficina.');
  const ativas = tx.select({ id: funcoes.id }).from(funcoes).where(eq(funcoes.ativa, true));
  await tx
    .delete(usuarioFuncoes)
    .where(and(eq(usuarioFuncoes.usuarioId, usuarioId), inArray(usuarioFuncoes.funcaoId, ativas)));
  await tx.insert(usuarioFuncoes).values(funcaoIds.map((funcaoId) => ({ usuarioId, funcaoId })));
}

/** Gestão de usuários: exclusiva do Administrador. Não há exclusão, só desativação (preserva o histórico). */
export const usuariosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAdmin);

  app.get('/', { schema: { response: { 200: z.array(usuarioSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => listar(tx)),
  );

  app.post('/', { schema: { body: usuarioCriarSchema, response: { 201: usuarioSchema } } }, async (req, reply) => {
    const { senha, funcoes: funcaoIds, ...dados } = req.body;
    const senhaHash = await hash(senha);
    const usuario = await withTenant(req.user.tid, async (tx) => {
      const [criado] = await tx
        .insert(users)
        .values({ ...dados, senhaHash })
        .returning({ id: users.id });
      await trocarFuncoes(tx, criado!.id, funcaoIds);
      return (await listar(tx, criado!.id))[0]!;
    });
    return reply.code(201).send(usuario);
  });

  app.put(
    '/:id',
    { schema: { params: idParamSchema, body: usuarioAtualizarSchema, response: { 200: usuarioSchema } } },
    async (req) => {
      const { novaSenha, funcoes: funcaoIds, ...dados } = req.body;
      const senhaHash = novaSenha ? await hash(novaSenha) : undefined;
      return withTenant(req.user.tid, async (tx) => {
        // Evita que a oficina fique sem administrador: ninguém tira o próprio acesso de admin.
        if (req.params.id === req.user.sub) {
          const { incluiAdmin } = await funcoesAtivasValidas(tx, funcaoIds);
          if (!incluiAdmin || !dados.ativo)
            throw new ErroHttp(400, 'Você não pode desativar a sua conta nem retirar dela a função Administrador.');
        }
        const [atualizado] = await tx
          .update(users)
          .set({ ...dados, ...(senhaHash && { senhaHash }) })
          .where(eq(users.id, req.params.id))
          .returning({ id: users.id });
        if (!atualizado) throw naoEncontrado('Usuário');
        await trocarFuncoes(tx, atualizado.id, funcaoIds);
        return (await listar(tx, atualizado.id))[0]!;
      });
    },
  );
};
