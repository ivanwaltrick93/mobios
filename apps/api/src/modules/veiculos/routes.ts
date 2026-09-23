import { idParamSchema, veiculoInputSchema, veiculoSchema } from '@mobios/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { veiculos } from '../../db/schema.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunas = {
  id: veiculos.id,
  clienteId: veiculos.clienteId,
  placa: veiculos.placa,
  marca: veiculos.marca,
  modelo: veiculos.modelo,
  ano: veiculos.ano,
  cor: veiculos.cor,
  chassi: veiculos.chassi,
  kmAtual: veiculos.kmAtual,
};

export const veiculosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  app.get(
    '/',
    { schema: { querystring: z.object({ clienteId: z.uuid().optional() }), response: { 200: z.array(veiculoSchema) } } },
    async (req) => {
      const { clienteId } = req.query;
      return withTenant(req.user.tid, (tx) =>
        tx
          .select(colunas)
          .from(veiculos)
          .where(clienteId ? eq(veiculos.clienteId, clienteId) : undefined)
          .orderBy(asc(veiculos.placa)),
      );
    },
  );

  app.post('/', { schema: { body: veiculoInputSchema, response: { 201: veiculoSchema } } }, async (req, reply) => {
    const [veiculo] = await withTenant(req.user.tid, (tx) => tx.insert(veiculos).values(req.body).returning(colunas));
    return reply.code(201).send(veiculo!);
  });

  app.put('/:id', { schema: { params: idParamSchema, body: veiculoInputSchema, response: { 200: veiculoSchema } } }, async (req) => {
    const [veiculo] = await withTenant(req.user.tid, (tx) =>
      tx.update(veiculos).set(req.body).where(eq(veiculos.id, req.params.id)).returning(colunas),
    );
    if (!veiculo) throw naoEncontrado('Veículo');
    return veiculo;
  });

  app.delete('/:id', { schema: { params: idParamSchema } }, async (req, reply) => {
    const removidos = await withTenant(req.user.tid, (tx) => tx.delete(veiculos).where(eq(veiculos.id, req.params.id)).returning({ id: veiculos.id }));
    if (removidos.length === 0) throw naoEncontrado('Veículo');
    return reply.code(204).send();
  });
};
