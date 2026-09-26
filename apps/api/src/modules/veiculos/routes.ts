import {
  idParamSchema,
  normalizarPlaca,
  pendenciasVeiculo,
  sugestoesVeiculoSchema,
  veiculoAtualizarSchema,
  veiculoFiltroSchema,
  veiculoInputSchema,
  veiculoListaSchema,
  veiculoSchema,
  veiculoTransferirSchema,
} from '@mobios/shared';
import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { clientes, veiculos } from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

const colunas = {
  id: veiculos.id,
  clienteId: veiculos.clienteId,
  placa: veiculos.placa,
  renavam: veiculos.renavam,
  chassi: veiculos.chassi,
  marca: veiculos.marca,
  modelo: veiculos.modelo,
  versao: veiculos.versao,
  anoFabricacao: veiculos.anoFabricacao,
  anoModelo: veiculos.anoModelo,
  cor: veiculos.cor,
  combustivel: veiculos.combustivel,
  kmAtual: veiculos.kmAtual,
  ultimaVisita: veiculos.ultimaVisita,
  principal: veiculos.principal,
  status: veiculos.status,
};

type Linha = { anoFabricacao: number | null; anoModelo: number | null };
const comPendencias = <T extends Linha>(v: T) => ({ ...v, pendencias: pendenciasVeiculo(v) });

async function carregarVeiculo(tx: Tx, id: string) {
  const [veiculo] = await tx.select(colunas).from(veiculos).where(eq(veiculos.id, id));
  if (!veiculo) throw naoEncontrado('Veículo');
  return comPendencias(veiculo);
}

/**
 * Cliente com veículos tem sempre um principal. `veiculoId` marcado: ele vira o principal.
 * Senão, se o cliente ficou sem principal, o veículo mais antigo (de preferência outro) assume.
 */
async function ajustarPrincipal(tx: Tx, clienteId: string, veiculoId?: string, marcado = false) {
  if (veiculoId && marcado) {
    // Desmarca antes de marcar: o índice único parcial permite um só principal por cliente.
    await tx
      .update(veiculos)
      .set({ principal: false })
      .where(and(eq(veiculos.clienteId, clienteId), eq(veiculos.principal, true), ne(veiculos.id, veiculoId)));
    await tx.update(veiculos).set({ principal: true }).where(eq(veiculos.id, veiculoId));
    return;
  }
  const [atual] = await tx
    .select({ id: veiculos.id })
    .from(veiculos)
    .where(and(eq(veiculos.clienteId, clienteId), eq(veiculos.principal, true)));
  if (atual) return;
  const [candidato] = await tx
    .select({ id: veiculos.id })
    .from(veiculos)
    .where(eq(veiculos.clienteId, clienteId))
    .orderBy(...(veiculoId ? [sql`${veiculos.id} = ${veiculoId}`] : []), asc(veiculos.criadoEm), asc(veiculos.id))
    .limit(1);
  if (candidato) await tx.update(veiculos).set({ principal: true }).where(eq(veiculos.id, candidato.id));
}

export const veiculosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('clientes'));
  const editar = { onRequest: app.exigirAcesso('clientes', 'editar') };

  app.get(
    '/',
    {
      schema: { querystring: z.object({ clienteId: z.uuid().optional() }), response: { 200: z.array(veiculoSchema) } },
    },
    async (req) => {
      const { clienteId } = req.query;
      const lista = await withTenant(req.user.tid, (tx) =>
        tx
          .select(colunas)
          .from(veiculos)
          .where(clienteId ? eq(veiculos.clienteId, clienteId) : undefined)
          .orderBy(desc(veiculos.principal), asc(veiculos.placa)),
      );
      return lista.map(comPendencias);
    },
  );

  /** Frota da oficina (página Veículos): busca por placa, marca, modelo ou dono; paginada. */
  app.get(
    '/lista',
    {
      schema: {
        querystring: veiculoFiltroSchema,
        response: { 200: z.object({ itens: z.array(veiculoListaSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, status, pagina, porPagina } = req.query;
      const placa = q ? normalizarPlaca(q) : '';
      const filtro = and(
        // Placa, marca, modelo ou nome do dono, pela função busca_veiculos (migração 0028).
        q
          ? sql`${veiculos.id} in (select busca_veiculos(${placa ? `%${placa}%` : null}::text, ${`%${q}%`}::text))`
          : undefined,
        status ? eq(veiculos.status, status) : undefined,
      );
      return withTenant(req.user.tid, async (tx) => {
        // Pagina só os ids (os filtros são todos de veiculos) e junta o dono depois, só nas linhas da página.
        const daPagina = tx
          .select({ id: veiculos.id })
          .from(veiculos)
          .where(filtro)
          .orderBy(asc(veiculos.placa))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina)
          .as('da_pagina');
        const linhas = await tx
          .select({ ...colunas, clienteNome: clientes.nome })
          .from(veiculos)
          .innerJoin(daPagina, eq(daPagina.id, veiculos.id))
          .innerJoin(clientes, eq(clientes.id, veiculos.clienteId))
          .orderBy(asc(veiculos.placa));
        // Todo veículo tem dono (FK): a contagem dispensa a junção.
        const [{ total }] = (await tx.select({ total: count() }).from(veiculos).where(filtro)) as [{ total: number }];
        return { itens: linhas.map(comPendencias), total };
      });
    },
  );

  /** Marcas e modelos já cadastrados na oficina, para sugerir no formulário (sem serviço externo). */
  app.get(
    '/sugestoes',
    {
      schema: {
        querystring: z.object({ marca: z.string().trim().optional() }),
        response: { 200: sugestoesVeiculoSchema },
      },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const marcas = await tx.selectDistinct({ v: veiculos.marca }).from(veiculos).orderBy(veiculos.marca).limit(300);
        const modelos = req.query.marca
          ? await tx
              .selectDistinct({ v: veiculos.modelo })
              .from(veiculos)
              .where(sql`lower(${veiculos.marca}) = lower(${req.query.marca})`)
              .orderBy(veiculos.modelo)
              .limit(300)
          : [];
        return { marcas: marcas.map((m) => m.v), modelos: modelos.map((m) => m.v) };
      }),
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: veiculoSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregarVeiculo(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: veiculoInputSchema, response: { 201: veiculoSchema } } },
    async (req, reply) => {
      const { principal, ...dados } = req.body;
      const veiculo = await withTenant(req.user.tid, async (tx) => {
        const [{ id }] = (await tx
          .insert(veiculos)
          .values({ ...dados, principal: false })
          .returning({ id: veiculos.id })) as [{ id: string }];
        await ajustarPrincipal(tx, dados.clienteId, id, principal);
        return carregarVeiculo(tx, id);
      });
      return reply.code(201).send(veiculo);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: veiculoAtualizarSchema, response: { 200: veiculoSchema } } },
    async (req) => {
      const { principal, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const [atualizado] = await tx
          .update(veiculos)
          // Desmarcar o principal: outro veículo do cliente assume (ajustarPrincipal).
          .set({ ...dados, ...(principal ? {} : { principal: false }) })
          .where(eq(veiculos.id, req.params.id))
          .returning({ clienteId: veiculos.clienteId });
        if (!atualizado) throw naoEncontrado('Veículo');
        await ajustarPrincipal(tx, atualizado.clienteId, req.params.id, principal);
        return carregarVeiculo(tx, req.params.id);
      });
    },
  );

  /**
   * Venda para outro cliente da oficina: o mesmo veículo (placa e chassi únicos) muda de dono
   * e volta a ficar ativo. As O.S. guardam o cliente da época, então o histórico do ex-dono continua dele.
   */
  app.post(
    '/:id/transferir',
    { ...editar, schema: { params: idParamSchema, body: veiculoTransferirSchema, response: { 200: veiculoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [atual] = await tx
          .select({ clienteId: veiculos.clienteId })
          .from(veiculos)
          .where(eq(veiculos.id, req.params.id))
          .for('update');
        if (!atual) throw naoEncontrado('Veículo');
        if (atual.clienteId === req.body.clienteId) throw new ErroHttp(400, 'O veículo já é deste cliente');
        const [novoDono] = await tx
          .select({ id: clientes.id })
          .from(clientes)
          .where(eq(clientes.id, req.body.clienteId));
        if (!novoDono) throw naoEncontrado('Cliente');

        await tx
          .update(veiculos)
          .set({ clienteId: req.body.clienteId, principal: false, status: 'ativo' })
          .where(eq(veiculos.id, req.params.id));
        await ajustarPrincipal(tx, atual.clienteId);
        await ajustarPrincipal(tx, req.body.clienteId);
        return carregarVeiculo(tx, req.params.id);
      }),
  );

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, async (tx) => {
      const [removido] = await tx
        .delete(veiculos)
        .where(eq(veiculos.id, req.params.id))
        .returning({ clienteId: veiculos.clienteId });
      if (!removido) throw naoEncontrado('Veículo');
      await ajustarPrincipal(tx, removido.clienteId);
    });
    return reply.code(204).send();
  });
};
