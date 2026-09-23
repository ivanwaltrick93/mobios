import {
  ajusteEstoqueSchema,
  estoqueAjusteSchema,
  estoqueFiltroSchema,
  saldoSchema,
  UNIDADES,
  type Saldo,
} from '@mobios/shared';
import { and, asc, count, desc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { depositos, estoqueAjustes, estoques, materiais } from '../../db/schema.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

const chaveParams = z.object({ materialId: z.uuid(), depositoId: z.uuid() });

const colunas = {
  materialId: materiais.id,
  sku: materiais.sku,
  descricao: materiais.descricao,
  unidade: materiais.unidade,
  materialAtivo: materiais.ativo,
  depositoId: depositos.id,
  depositoCodigo: depositos.codigo,
  depositoNome: depositos.nome,
  depositoAtivo: depositos.ativo,
  // Sem linha de saldo = zero.
  disponivel: sql<number>`coalesce(${estoques.disponivel}, 0)`.mapWith(Number),
  reservado: sql<number>`coalesce(${estoques.reservado}, 0)`.mapWith(Number),
  total: sql<number>`coalesce(${estoques.disponivel}, 0) + coalesce(${estoques.reservado}, 0)`.mapWith(Number),
  atualizadoEm: estoques.atualizadoEm,
  atualizadoPor: nomeUsuario('estoques', 'atualizado_por'),
  versao: estoques.versao,
};

async function carregar(tx: Tx, materialId: string, depositoId: string): Promise<Saldo> {
  const [s] = await tx
    .select(colunas)
    .from(materiais)
    .innerJoin(depositos, eq(depositos.id, depositoId))
    .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
    .where(eq(materiais.id, materialId));
  if (!s) throw naoEncontrado('Material ou depósito');
  return s;
}

/**
 * Estoque por material + depósito. Consultar = ver saldos; Editar = ajuste manual com motivo.
 * Cada ajuste grava o antes/depois em estoque_ajustes; o saldo nunca fica negativo (CHECK no banco).
 */
export const estoqueRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('estoque'));
  const editar = { onRequest: app.exigirAcesso('estoque', 'editar') };

  /**
   * Tabela de estoque: uma linha por SKU + depósito. Parte do produto cartesiano material × depósito
   * (só ativos e que controlam estoque) com o saldo gravado; combinações sem saldo aparecem zeradas.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: estoqueFiltroSchema,
        response: { 200: z.object({ itens: z.array(saldoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, depositoId, materialId, comSaldo, pagina, porPagina } = req.query;
      const filtros: (SQL | undefined)[] = [
        // Linha existe se já tem saldo gravado, ou se material e depósito estão ativos e o material controla estoque.
        or(
          sql`${estoques.materialId} is not null`,
          and(eq(materiais.ativo, true), eq(materiais.controlaEstoque, true), eq(depositos.ativo, true)),
        ),
        q
          ? or(
              ilike(materiais.sku, `${q.toUpperCase()}%`),
              ilike(materiais.descricao, `%${q}%`),
              ilike(materiais.codigoFabricante, `${q.toUpperCase()}%`),
              eq(materiais.codigoBarras, q),
            )
          : undefined,
        depositoId ? eq(depositos.id, depositoId) : undefined,
        materialId ? eq(materiais.id, materialId) : undefined,
        comSaldo === 'true' ? or(gt(estoques.disponivel, 0), gt(estoques.reservado, 0)) : undefined,
      ];
      const where = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx
          .select(colunas)
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(where)
          .orderBy(asc(materiais.sku), asc(depositos.codigo))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(where)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  /** Saldo do material em cada depósito ativo (zerado onde ainda não há saldo) e nos inativos que têm saldo. */
  app.get(
    '/material/:materialId',
    { schema: { params: z.object({ materialId: z.uuid() }), response: { 200: z.array(saldoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const lista = await tx
          .select(colunas)
          .from(materiais)
          .innerJoin(depositos, sql`true`)
          .leftJoin(estoques, and(eq(estoques.materialId, materiais.id), eq(estoques.depositoId, depositos.id)))
          .where(
            and(
              eq(materiais.id, req.params.materialId),
              or(eq(depositos.ativo, true), sql`${estoques.materialId} is not null`),
            ),
          )
          .orderBy(asc(depositos.codigo));
        if (!lista.length) {
          const [existe] = await tx
            .select({ id: materiais.id })
            .from(materiais)
            .where(eq(materiais.id, req.params.materialId));
          if (!existe) throw naoEncontrado('Material');
        }
        return lista;
      }),
  );

  /**
   * Ajuste manual: grava os novos valores de disponível e reservado, com motivo.
   * A linha é travada (FOR UPDATE) e a versão lida precisa bater, para um ajuste não apagar outro.
   */
  app.put(
    '/:materialId/:depositoId',
    { ...editar, schema: { params: chaveParams, body: estoqueAjusteSchema, response: { 200: saldoSchema } } },
    async (req) => {
      const { materialId, depositoId } = req.params;
      const { disponivel, reservado, motivo, versao } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const [material] = await tx
          .select({ ativo: materiais.ativo, controlaEstoque: materiais.controlaEstoque, unidade: materiais.unidade })
          .from(materiais)
          .where(eq(materiais.id, materialId));
        if (!material) throw naoEncontrado('Material');
        if (!material.controlaEstoque)
          throw new ErroHttp(400, 'Este material não controla estoque (veja os controles do cadastro).');
        if (!material.ativo)
          throw new ErroHttp(400, 'Material inativo não recebe ajuste de estoque. Reative-o primeiro.');
        if (!UNIDADES[material.unidade].fracionada && (!Number.isInteger(disponivel) || !Number.isInteger(reservado))) {
          throw new ErroHttp(400, `A unidade ${material.unidade} não aceita quantidade fracionada.`);
        }
        const [deposito] = await tx
          .select({ ativo: depositos.ativo })
          .from(depositos)
          .where(eq(depositos.id, depositoId));
        if (!deposito) throw naoEncontrado('Depósito');
        if (!deposito.ativo) throw new ErroHttp(400, 'Depósito inativo não recebe ajuste de estoque.');

        const [atual] = await tx
          .select()
          .from(estoques)
          .where(and(eq(estoques.materialId, materialId), eq(estoques.depositoId, depositoId)))
          .for('update');
        if (atual) {
          if (versao == null) throw new ErroHttp(400, 'Informe a versão do saldo (campo "versao").');
          if (versao !== atual.versao)
            throw new ErroHttp(
              409,
              'O saldo foi alterado por outra pessoa enquanto você editava. Recarregue e refaça o ajuste.',
            );
          if (atual.disponivel === disponivel && atual.reservado === reservado)
            throw new ErroHttp(400, 'Nenhuma quantidade foi alterada.');
          await tx
            .update(estoques)
            .set({ disponivel, reservado, atualizadoPor: req.user.sub, versao: atual.versao + 1 })
            .where(and(eq(estoques.materialId, materialId), eq(estoques.depositoId, depositoId)));
        } else {
          if (disponivel === 0 && reservado === 0) throw new ErroHttp(400, 'Nenhuma quantidade foi alterada.');
          await tx
            .insert(estoques)
            .values({ materialId, depositoId, disponivel, reservado, atualizadoPor: req.user.sub });
        }
        await tx.insert(estoqueAjustes).values({
          materialId,
          depositoId,
          disponivelAntes: atual?.disponivel ?? 0,
          disponivelDepois: disponivel,
          reservadoAntes: atual?.reservado ?? 0,
          reservadoDepois: reservado,
          motivo,
          usuarioId: req.user.sub,
        });
        return carregar(tx, materialId, depositoId);
      });
    },
  );

  /** Histórico de ajustes de um material num depósito (mais recente primeiro). */
  app.get(
    '/:materialId/:depositoId/ajustes',
    { schema: { params: chaveParams, response: { 200: z.array(ajusteEstoqueSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        tx
          .select({
            id: estoqueAjustes.id,
            disponivelAntes: estoqueAjustes.disponivelAntes,
            disponivelDepois: estoqueAjustes.disponivelDepois,
            reservadoAntes: estoqueAjustes.reservadoAntes,
            reservadoDepois: estoqueAjustes.reservadoDepois,
            motivo: estoqueAjustes.motivo,
            usuario: nomeUsuario('estoque_ajustes', 'usuario_id'),
            criadoEm: estoqueAjustes.criadoEm,
          })
          .from(estoqueAjustes)
          .where(
            and(
              eq(estoqueAjustes.materialId, req.params.materialId),
              eq(estoqueAjustes.depositoId, req.params.depositoId),
            ),
          )
          .orderBy(desc(estoqueAjustes.criadoEm))
          .limit(100),
      ),
  );
};
