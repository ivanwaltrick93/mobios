import { clienteInputSchema, clienteSchema, idParamSchema, paginacaoSchema } from '@mobios/shared';
import { asc, count, eq, ilike, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { clientes } from '../../db/schema.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunas = {
  id: clientes.id,
  tipo: clientes.tipo,
  nome: clientes.nome,
  cpfCnpj: clientes.cpfCnpj,
  telefone: clientes.telefone,
  email: clientes.email,
  observacoes: clientes.observacoes,
  criadoEm: clientes.criadoEm,
};

// O tenant_id não aparece em nenhum filtro abaixo: quem garante o isolamento é o RLS via withTenant().
export const clientesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('clientes'));
  const editar = { onRequest: app.exigirAcesso('clientes', 'editar') };

  app.get(
    '/',
    { schema: { querystring: paginacaoSchema, response: { 200: z.object({ itens: z.array(clienteSchema), total: z.number() }) } } },
    async (req) => {
      const { q, pagina, porPagina } = req.query;
      const filtro = q ? or(ilike(clientes.nome, `%${q}%`), ilike(clientes.cpfCnpj, `%${q.replace(/\D/g, '') || q}%`), ilike(clientes.telefone, `%${q}%`)) : undefined;
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx.select(colunas).from(clientes).where(filtro).orderBy(asc(clientes.nome)).limit(porPagina).offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(filtro)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: clienteSchema } } }, async (req) => {
    const [cliente] = await withTenant(req.user.tid, (tx) => tx.select(colunas).from(clientes).where(eq(clientes.id, req.params.id)));
    if (!cliente) throw naoEncontrado('Cliente');
    return cliente;
  });

  app.post('/', { ...editar, schema: { body: clienteInputSchema, response: { 201: clienteSchema } } }, async (req, reply) => {
    const [cliente] = await withTenant(req.user.tid, (tx) => tx.insert(clientes).values(req.body).returning(colunas));
    return reply.code(201).send(cliente!);
  });

  app.put('/:id', { ...editar, schema: { params: idParamSchema, body: clienteInputSchema, response: { 200: clienteSchema } } }, async (req) => {
    const [cliente] = await withTenant(req.user.tid, (tx) =>
      tx.update(clientes).set(req.body).where(eq(clientes.id, req.params.id)).returning(colunas),
    );
    if (!cliente) throw naoEncontrado('Cliente');
    return cliente;
  });

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    const removidos = await withTenant(req.user.tid, (tx) => tx.delete(clientes).where(eq(clientes.id, req.params.id)).returning({ id: clientes.id }));
    if (removidos.length === 0) throw naoEncontrado('Cliente');
    return reply.code(204).send();
  });
};
