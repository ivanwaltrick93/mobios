import { idParamSchema, marcaInputSchema, marcaSchema, statusInputSchema } from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { marcas } from '../../db/schema.js';
import { alterarAtivo, atualizarVersionado, excluirSeNaoUsado, exigirVersao } from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunas = {
  id: marcas.id,
  codigo: marcas.codigo,
  nome: marcas.nome,
  descricao: marcas.descricao,
  ativa: marcas.ativa,
  materiais: sql<number>`(select count(*) from materiais m where m.marca_id = "marcas"."id")`.mapWith(Number),
  versao: marcas.versao,
};

async function carregar(tx: Tx, id: string) {
  const [m] = await tx.select(colunas).from(marcas).where(eq(marcas.id, id));
  if (!m) throw naoEncontrado('Marca');
  return m;
}

export const marcasRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };

  app.get('/', { schema: { response: { 200: z.array(marcaSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => tx.select(colunas).from(marcas).orderBy(asc(marcas.nome))),
  );

  app.post('/', { ...editar, schema: { body: marcaInputSchema, response: { 201: marcaSchema } } }, async (req, reply) => {
    const { versao: _v, ...dados } = req.body;
    const marca = await withTenant(req.user.tid, async (tx) => {
      const [{ id }] = (await tx.insert(marcas).values({ ...dados, criadoPor: req.user.sub, atualizadoPor: req.user.sub }).returning({ id: marcas.id })) as [{ id: string }];
      return carregar(tx, id);
    });
    return reply.code(201).send(marca);
  });

  app.put('/:id', { ...editar, schema: { params: idParamSchema, body: marcaInputSchema, response: { 200: marcaSchema } } }, async (req) => {
    const { versao, ...dados } = req.body;
    return withTenant(req.user.tid, async (tx) => {
      await atualizarVersionado(tx, marcas, req.params.id, exigirVersao(versao), { ...dados, atualizadoPor: req.user.sub }, 'Marca');
      return carregar(tx, req.params.id);
    });
  });

  app.patch('/:id/status', { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: marcaSchema } } }, async (req) =>
    withTenant(req.user.tid, async (tx) => {
      await alterarAtivo(tx, marcas, marcas.ativa, req.params.id, req.body.ativo, req.user.sub, 'Marca');
      return carregar(tx, req.params.id);
    }),
  );

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) => excluirSeNaoUsado(tx, marcas, req.params.id, 'Marca', 'Esta marca está em uso por materiais e não pode ser excluída. Inative-a.'));
    return reply.code(204).send();
  });
};
