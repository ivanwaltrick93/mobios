import { ACESSO_TOTAL, combinarAcessos, funcaoInputSchema, funcaoSchema, idParamSchema, type Acessos, type Funcao } from '@mobios/shared';
import { asc, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { funcaoPermissoes, funcoes, usuarioFuncoes } from '../../db/schema.js';
import { gravarAcessos } from '../../lib/acessos.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

async function listar(tx: Tx, id?: string): Promise<Funcao[]> {
  const lista = await tx
    .select({ id: funcoes.id, nome: funcoes.nome, admin: funcoes.admin, ativa: funcoes.ativa, usuarios: count(usuarioFuncoes.usuarioId) })
    .from(funcoes)
    .leftJoin(usuarioFuncoes, eq(usuarioFuncoes.funcaoId, funcoes.id))
    .where(id ? eq(funcoes.id, id) : undefined)
    .groupBy(funcoes.id)
    .orderBy(asc(funcoes.nome));
  const niveis = await tx.select().from(funcaoPermissoes);
  // Administrador primeiro; as demais por nome.
  return lista
    .sort((a, b) => Number(b.admin) - Number(a.admin))
    .map((f) => ({
      ...f,
      // O Administrador não guarda níveis: tem acesso total por regra.
      acessos: f.admin ? ACESSO_TOTAL : combinarAcessos(niveis.filter((n) => n.funcaoId === f.id).map((n) => ({ [n.modulo]: n.nivel }) as Partial<Acessos>)),
    }));
}

/** Funções e permissões por módulo: exclusivo do Administrador. Funções não são excluídas, só desativadas. */
export const funcoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAdmin);

  app.get('/', { schema: { response: { 200: z.array(funcaoSchema) } } }, async (req) => withTenant(req.user.tid, (tx) => listar(tx)));

  app.post('/', { schema: { body: funcaoInputSchema, response: { 201: funcaoSchema } } }, async (req, reply) => {
    const funcao = await withTenant(req.user.tid, async (tx) => {
      const [criada] = await tx.insert(funcoes).values({ nome: req.body.nome, ativa: req.body.ativa }).returning({ id: funcoes.id });
      await gravarAcessos(tx, criada!.id, req.body.acessos);
      return (await listar(tx, criada!.id))[0]!;
    });
    return reply.code(201).send(funcao);
  });

  app.put('/:id', { schema: { params: idParamSchema, body: funcaoInputSchema, response: { 200: funcaoSchema } } }, async (req) =>
    withTenant(req.user.tid, async (tx) => {
      const [atual] = await tx.select({ admin: funcoes.admin }).from(funcoes).where(eq(funcoes.id, req.params.id));
      if (!atual) throw naoEncontrado('Função');
      if (atual.admin) throw new ErroHttp(400, 'A função Administrador é fixa: tem acesso total e não pode ser alterada.');
      // Desativar retira na hora o acesso que vinha desta função (decisão do produto).
      await tx.update(funcoes).set({ nome: req.body.nome, ativa: req.body.ativa, atualizadoEm: new Date() }).where(eq(funcoes.id, req.params.id));
      await gravarAcessos(tx, req.params.id, req.body.acessos);
      return (await listar(tx, req.params.id))[0]!;
    }),
  );
};
