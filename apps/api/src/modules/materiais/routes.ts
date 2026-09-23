import {
  idParamSchema,
  materialFiltroSchema,
  materialInputSchema,
  materialResumoSchema,
  materialSchema,
  statusInputSchema,
  type Material,
} from '@mobios/shared';
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { categorias, marcas, materiais, tiposMaterial } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  buscaDeMaterial,
  excluirSeNaoUsado,
  exigirVersao,
  naCategoriaOuAbaixo,
  nomeUsuario,
  validarReferencia,
} from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunasResumo = {
  id: materiais.id,
  sku: materiais.sku,
  descricao: materiais.descricao,
  codigoFabricante: materiais.codigoFabricante,
  unidade: materiais.unidade,
  tipoNome: tiposMaterial.nome,
  categoriaNome: categorias.nome,
  marcaNome: marcas.nome,
  ativo: materiais.ativo,
};

/** "Peças › Motor › Filtros": sobe a hierarquia a partir da categoria do material. */
const caminhoCategoria = sql<string>`(with recursive acima(id, pai, nome, nivel) as (
    select c.id, c.categoria_pai_id, c.nome, 0 from categorias c where c.id = "materiais"."categoria_id"
    union all select c.id, c.categoria_pai_id, c.nome, a.nivel + 1 from categorias c join acima a on c.id = a.pai
  ) select string_agg(nome, ' › ' order by nivel desc) from acima)`;

async function carregar(tx: Tx, id: string): Promise<Material> {
  const [m] = await tx
    .select({
      ...colunasResumo,
      codigoBarras: materiais.codigoBarras,
      descricaoCurta: materiais.descricaoCurta,
      tipoId: materiais.tipoId,
      categoriaId: materiais.categoriaId,
      categoriaCaminho: caminhoCategoria,
      marcaId: materiais.marcaId,
      ncm: materiais.ncm,
      cest: materiais.cest,
      origem: materiais.origem,
      controlaEstoque: materiais.controlaEstoque,
      permiteVenda: materiais.permiteVenda,
      permiteCompra: materiais.permiteCompra,
      permiteUsoOs: materiais.permiteUsoOs,
      controlaLote: materiais.controlaLote,
      controlaSerie: materiais.controlaSerie,
      criadoEm: materiais.criadoEm,
      atualizadoEm: materiais.atualizadoEm,
      criadoPor: nomeUsuario('materiais', 'criado_por'),
      atualizadoPor: nomeUsuario('materiais', 'atualizado_por'),
      versao: materiais.versao,
    })
    .from(materiais)
    .innerJoin(tiposMaterial, eq(tiposMaterial.id, materiais.tipoId))
    .innerJoin(categorias, eq(categorias.id, materiais.categoriaId))
    .leftJoin(marcas, eq(marcas.id, materiais.marcaId))
    .where(eq(materiais.id, id));
  if (!m) throw naoEncontrado('Material');
  return m;
}

/** Tipo, categoria e marca precisam existir na oficina e estar ativos (exceto os que o material já usa). */
async function validarReferencias(
  tx: Tx,
  dados: { tipoId: string; categoriaId: string; marcaId: string | null },
  atual?: Material,
) {
  await validarReferencia(tx, tiposMaterial, tiposMaterial.ativa, dados.tipoId, atual?.tipoId, 'Tipo de material');
  await validarReferencia(tx, categorias, categorias.ativa, dados.categoriaId, atual?.categoriaId, 'Categoria');
  await validarReferencia(tx, marcas, marcas.ativa, dados.marcaId, atual?.marcaId, 'Marca');
}

export const materiaisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };

  /**
   * Busca: SKU, código de barras e código do fabricante por igualdade/prefixo (índices B-tree);
   * descrição por trecho (índice trigram). Categoria inclui as subcategorias.
   */
  app.get(
    '/',
    {
      schema: {
        querystring: materialFiltroSchema,
        response: { 200: z.object({ itens: z.array(materialResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, tipoId, categoriaId, marcaId, ativo, pagina, porPagina } = req.query;
      const filtros: (SQL | undefined)[] = [
        q ? buscaDeMaterial(q) : undefined,
        tipoId ? eq(materiais.tipoId, tipoId) : undefined,
        categoriaId ? naCategoriaOuAbaixo(materiais.categoriaId, categoriaId) : undefined,
        marcaId ? eq(materiais.marcaId, marcaId) : undefined,
        ativo ? eq(materiais.ativo, ativo === 'true') : undefined,
      ];
      const where = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        const itens = await tx
          .select(colunasResumo)
          .from(materiais)
          .innerJoin(tiposMaterial, eq(tiposMaterial.id, materiais.tipoId))
          .innerJoin(categorias, eq(categorias.id, materiais.categoriaId))
          .leftJoin(marcas, eq(marcas.id, materiais.marcaId))
          .where(where)
          .orderBy(asc(materiais.descricao), asc(materiais.sku))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx.select({ total: count() }).from(materiais).where(where)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: materialSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: materialInputSchema, response: { 201: materialSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const material = await withTenant(req.user.tid, async (tx) => {
        await validarReferencias(tx, dados);
        const [{ id }] = (await tx
          .insert(materiais)
          .values({ ...dados, criadoPor: req.user.sub, atualizadoPor: req.user.sub })
          .returning({ id: materiais.id })) as [{ id: string }];
        return carregar(tx, id);
      });
      return reply.code(201).send(material);
    },
  );

  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: materialInputSchema, response: { 200: materialSchema } } },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const atual = await carregar(tx, req.params.id);
        await validarReferencias(tx, dados, atual);
        await atualizarVersionado(
          tx,
          materiais,
          req.params.id,
          exigirVersao(versao),
          { ...dados, atualizadoPor: req.user.sub },
          'Material',
        );
        return carregar(tx, req.params.id);
      });
    },
  );

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: materialSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, materiais, materiais.ativo, req.params.id, req.body.ativo, req.user.sub, 'Material');
        return carregar(tx, req.params.id);
      }),
  );

  /** Só material nunca precificado nem movimentado no estoque pode ser excluído (o histórico não se perde). */
  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        materiais,
        req.params.id,
        'Material',
        'Este material já tem preços ou saldo de estoque e não pode ser excluído (o histórico é mantido). Inative-o.',
      ),
    );
    return reply.code(204).send();
  });
};
