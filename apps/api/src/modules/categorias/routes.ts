import { categoriaInputSchema, categoriaSchema, idParamSchema, statusInputSchema } from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { categorias } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  excluirSeNaoUsado,
  exigirVersao,
  validarReferencia,
} from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

// Correlação escrita à mão (o Drizzle não qualifica colunas dentro da subconsulta).
const colunas = {
  id: categorias.id,
  codigo: categorias.codigo,
  nome: categorias.nome,
  descricao: categorias.descricao,
  categoriaPaiId: categorias.categoriaPaiId,
  ativa: categorias.ativa,
  materiais: sql<number>`(select count(*) from materiais m where m.categoria_id = "categorias"."id")`.mapWith(Number),
  versao: categorias.versao,
};

async function carregar(tx: Tx, id: string) {
  const [c] = await tx.select(colunas).from(categorias).where(eq(categorias.id, id));
  if (!c) throw naoEncontrado('Categoria');
  return c;
}

/**
 * Categorias hierárquicas. A árvore vem "achatada" (cada item com o pai); a tela monta a hierarquia.
 * Ciclos são barrados no banco (trigger categorias_sem_ciclo); aqui só validamos que o pai existe e está ativo.
 */
export const categoriasRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };

  app.get('/', { schema: { response: { 200: z.array(categoriaSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => tx.select(colunas).from(categorias).orderBy(asc(categorias.nome))),
  );

  app.post(
    '/',
    { ...editar, schema: { body: categoriaInputSchema, response: { 201: categoriaSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const categoria = await withTenant(req.user.tid, async (tx) => {
        await validarReferencia(tx, categorias, categorias.ativa, dados.categoriaPaiId, null, 'Categoria pai');
        const [{ id }] = (await tx
          .insert(categorias)
          .values({ ...dados, criadoPor: req.user.sub, atualizadoPor: req.user.sub })
          .returning({ id: categorias.id })) as [{ id: string }];
        return carregar(tx, id);
      });
      return reply.code(201).send(categoria);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: categoriaInputSchema, response: { 200: categoriaSchema } } },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const atual = await carregar(tx, req.params.id);
        await validarReferencia(
          tx,
          categorias,
          categorias.ativa,
          dados.categoriaPaiId,
          atual.categoriaPaiId,
          'Categoria pai',
        );
        await atualizarVersionado(
          tx,
          categorias,
          req.params.id,
          exigirVersao(versao),
          { ...dados, atualizadoPor: req.user.sub },
          'Categoria',
        );
        return carregar(tx, req.params.id);
      });
    },
  );

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: categoriaSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, categorias, categorias.ativa, req.params.id, req.body.ativo, req.user.sub, 'Categoria');
        return carregar(tx, req.params.id);
      }),
  );

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        categorias,
        req.params.id,
        'Categoria',
        'Esta categoria tem subcategorias ou materiais e não pode ser excluída. Inative-a.',
      ),
    );
    return reply.code(204).send();
  });
};
