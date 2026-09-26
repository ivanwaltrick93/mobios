import {
  COLUNAS_IMPORTACAO_MATERIAIS,
  idParamSchema,
  materialFiltroSchema,
  materialInputSchema,
  materialResumoSchema,
  materialSchema,
  pmcInputSchema,
  pmcSchema,
  resultadoImportacaoSchema,
  statusInputSchema,
  temAcesso,
  type Material,
  type MaterialDados,
} from '@mobios/shared';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { categorias, marcas, materiais, materiaisPmcEventos, tiposMaterial, users } from '../../db/schema.js';
import {
  alterarAtivo,
  atualizarVersionado,
  buscaDeMaterial,
  excluirSeNaoUsado,
  exigirVersao,
  MapaDeCategorias,
  naCategoriaOuAbaixo,
  nomeUsuario,
  validarReferencia,
} from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  aceitarUploadDeCsv,
  colunaDoCampo,
  comparavel,
  exigirPrimeiraVez,
  importarLinhas,
  lerPlanilhaEnviada,
  lerReaisEmCentavos,
  lerSimNao,
  validarLinha,
} from '../../lib/importacao.js';

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
      multiplo: materiais.multiplo,
      leadtimeDias: materiais.leadtimeDias,
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
  if (!m) throw naoEncontrado('Produto');
  return m;
}

/** Tipo, categoria e marca precisam existir na oficina e estar ativos (exceto os que o material já usa). */
async function validarReferencias(
  tx: Tx,
  dados: { tipoId: string; categoriaId: string; marcaId: string | null },
  atual?: Material,
) {
  await validarReferencia(tx, tiposMaterial, tiposMaterial.ativa, dados.tipoId, atual?.tipoId, 'Tipo de produto');
  await validarReferencia(tx, categorias, categorias.ativa, dados.categoriaId, atual?.categoriaId, 'Categoria');
  await validarReferencia(tx, marcas, marcas.ativa, dados.marcaId, atual?.marcaId, 'Marca');
}

type DadosMaterial = Omit<MaterialDados, 'versao'>;

/** Novo material (mesmas regras na tela e na importação): tipo, categoria e marca ativos. */
async function criarMaterial(tx: Tx, dados: DadosMaterial, usuarioId: string) {
  await validarReferencias(tx, dados);
  const [{ id }] = (await tx
    .insert(materiais)
    .values({ ...dados, criadoPor: usuarioId, atualizadoPor: usuarioId })
    .returning({ id: materiais.id })) as [{ id: string }];
  return id;
}

/**
 * Grava o PMC do material e o histórico (só quando muda). Trava a linha: duas alterações ao mesmo tempo não se
 * perdem. `anterior` (o que a tela leu): diferente do gravado = 409. undefined = sem conferência (importação).
 */
async function gravarPmc(
  tx: Tx,
  materialId: string,
  pmcCentavos: number | null,
  usuarioId: string,
  anterior?: number | null,
) {
  const [atual] = await tx
    .select({ pmcCentavos: materiais.pmcCentavos })
    .from(materiais)
    .where(eq(materiais.id, materialId))
    .for('update');
  if (!atual) throw naoEncontrado('Produto');
  if (anterior !== undefined && atual.pmcCentavos !== anterior)
    throw new ErroHttp(409, 'O PMC deste produto foi alterado por outra pessoa. Recarregue a página e refaça a ação.');
  if (atual.pmcCentavos === pmcCentavos) return;
  await tx.update(materiais).set({ pmcCentavos }).where(eq(materiais.id, materialId));
  await tx.insert(materiaisPmcEventos).values({
    materialId,
    antesCentavos: atual.pmcCentavos,
    depoisCentavos: pmcCentavos,
    usuarioId,
  });
}

/** Alteração com concorrência otimista; manter tipo/categoria/marca atuais é permitido mesmo se inativados. */
async function atualizarMaterial(tx: Tx, atual: Material, versao: number, dados: DadosMaterial, usuarioId: string) {
  await validarReferencias(tx, dados, atual);
  await atualizarVersionado(tx, materiais, atual.id, versao, { ...dados, atualizadoPor: usuarioId }, 'Produto');
}

export const materiaisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('materiais'));
  const editar = { onRequest: app.exigirAcesso('materiais', 'editar') };
  aceitarUploadDeCsv(app);

  /**
   * PMC (preço médio de compra) e histórico: informação interna, só com "Custos e margem" (Consultar para ver,
   * Editar para alterar). Fica fora do cadastro (GET /:id) para não chegar a quem só tem Materiais.
   */
  app.get(
    '/:id/pmc',
    { onRequest: app.exigirAcesso('custos'), schema: { params: idParamSchema, response: { 200: pmcSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [m] = await tx
          .select({ pmcCentavos: materiais.pmcCentavos })
          .from(materiais)
          .where(eq(materiais.id, req.params.id));
        if (!m) throw naoEncontrado('Produto');
        const historico = await tx
          .select({
            antesCentavos: materiaisPmcEventos.antesCentavos,
            depoisCentavos: materiaisPmcEventos.depoisCentavos,
            usuario: users.nome,
            criadoEm: materiaisPmcEventos.criadoEm,
          })
          .from(materiaisPmcEventos)
          .leftJoin(users, eq(users.id, materiaisPmcEventos.usuarioId))
          .where(eq(materiaisPmcEventos.materialId, req.params.id))
          .orderBy(desc(materiaisPmcEventos.criadoEm), desc(materiaisPmcEventos.id))
          .limit(50);
        return { pmcCentavos: m.pmcCentavos, historico };
      }),
  );

  app.put(
    '/:id/pmc',
    {
      onRequest: app.exigirAcesso('custos', 'editar'),
      schema: { params: idParamSchema, body: pmcInputSchema },
    },
    async (req, reply) => {
      await withTenant(req.user.tid, (tx) =>
        gravarPmc(tx, req.params.id, req.body.pmcCentavos, req.user.sub, req.body.anteriorCentavos),
      );
      return reply.code(204).send();
    },
  );

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
      const material = await withTenant(req.user.tid, async (tx) =>
        carregar(tx, await criarMaterial(tx, dados, req.user.sub)),
      );
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
        await atualizarMaterial(tx, atual, exigirVersao(versao), dados, req.user.sub);
        return carregar(tx, req.params.id);
      });
    },
  );

  /**
   * Materiais em massa por CSV (colunas em COLUNAS_IMPORTACAO_MATERIAIS). SKU já cadastrado atualiza o
   * material; colunas ausentes do arquivo não mudam o existente. Grava as válidas e relata as demais.
   */
  app.post('/importar', { ...editar, schema: { response: { 200: resultadoImportacaoSchema } } }, async (req) => {
    const linhas = lerPlanilhaEnviada(req.body, COLUNAS_IMPORTACAO_MATERIAIS);
    // A coluna pmc é informação interna: exige "Custos e margem" em Editar (senão, as linhas com ela são recusadas).
    const podePmc = temAcesso(req.user.acessos, 'custos', 'editar');
    return withTenant(req.user.tid, async (tx) => {
      // Referências lidas uma vez (não uma consulta por linha).
      const categoriasDaOficina = await MapaDeCategorias.carregar(tx);
      const tipos = new Map(
        (await tx.select({ id: tiposMaterial.id, nome: tiposMaterial.nome }).from(tiposMaterial)).map((t) => [
          comparavel(t.nome),
          t.id,
        ]),
      );
      const todasMarcas = await tx.select({ id: marcas.id, nome: marcas.nome, codigo: marcas.codigo }).from(marcas);
      const skus = [...new Set(linhas.map((l) => (l.valores.sku ?? '').trim().toUpperCase()).filter(Boolean))];
      const existentes = new Map(
        skus.length
          ? (
              await tx
                .select({ id: materiais.id, sku: materiais.sku })
                .from(materiais)
                .where(inArray(materiais.sku, skus))
            ).map((m) => [m.sku, m.id])
          : [],
      );
      const vistos = new Map<string, number>();

      return importarLinhas(tx, linhas, async (savepoint, { numero, valores }) => {
        const valor = (coluna: string) => valores[coluna] ?? '';
        const temColuna = (coluna: string) => coluna in valores;
        const sku = valor('sku').toUpperCase();
        exigirPrimeiraVez(vistos, sku, numero, `SKU ${sku}`);
        const idExistente = existentes.get(sku);
        const atual = idExistente ? await carregar(savepoint, idExistente) : undefined;

        const tipoId = tipos.get(comparavel(valor('tipo')));
        if (!tipoId) throw new ErroHttp(400, `tipo: "${valor('tipo')}" não está na lista de tipos de produto.`);
        const categoriaId = categoriasDaOficina.achar(valor('categoria'), 'categoria').id;
        let marcaId = atual?.marcaId ?? null;
        if (temColuna('marca')) {
          const marca = valor('marca')
            ? todasMarcas.find(
                (m) => comparavel(m.nome) === comparavel(valor('marca')) || m.codigo === valor('marca').toUpperCase(),
              )
            : null;
          if (marca === undefined) throw new ErroHttp(400, `marca: "${valor('marca')}" não encontrada.`);
          marcaId = marca?.id ?? null;
        }
        /** Coluna presente = valor da planilha (vazio limpa); ausente = mantém o do material existente. */
        const texto = (coluna: string, atualValor: string | null | undefined) =>
          temColuna(coluna) ? valor(coluna) : (atualValor ?? '');
        const simNao = (coluna: string, atualValor: boolean | undefined) =>
          lerSimNao(valor(coluna), coluna) ?? atualValor;

        const { versao: _v, ...dados } = validarLinha(
          materialInputSchema,
          {
            sku,
            descricao: valor('descricao'),
            tipoId,
            categoriaId,
            marcaId,
            unidade: valor('unidade').toUpperCase(),
            descricaoCurta: texto('descricao_curta', atual?.descricaoCurta),
            codigoFabricante: texto('codigo_fabricante', atual?.codigoFabricante),
            codigoBarras: texto('codigo_barras', atual?.codigoBarras),
            ncm: texto('ncm', atual?.ncm),
            cest: texto('cest', atual?.cest),
            origem: texto('origem', atual?.origem == null ? '' : String(atual.origem)),
            controlaEstoque: simNao('controla_estoque', atual?.controlaEstoque),
            permiteVenda: simNao('permite_venda', atual?.permiteVenda),
            permiteCompra: simNao('permite_compra', atual?.permiteCompra),
            permiteUsoOs: simNao('permite_uso_os', atual?.permiteUsoOs),
            controlaLote: simNao('controla_lote', atual?.controlaLote),
            controlaSerie: simNao('controla_serie', atual?.controlaSerie),
            // Presente e vazio = padrão (1 e 30); ausente = mantém o do material existente.
            multiplo: temColuna('multiplo') ? valor('multiplo') : atual?.multiplo,
            leadtimeDias: temColuna('leadtime_dias') ? valor('leadtime_dias') : atual?.leadtimeDias,
          },
          ([campo]) => colunaDoCampo(campo === 'tipoId' ? 'tipo' : campo === 'categoriaId' ? 'categoria' : campo!),
        );
        if (temColuna('pmc') && !podePmc)
          throw new ErroHttp(400, 'pmc: você não tem permissão para informar o PMC (Custos e margem em Editar).');
        const pmcCentavos = temColuna('pmc') && valor('pmc') ? lerReaisEmCentavos(valor('pmc'), 'PMC') : null;
        let id = atual?.id;
        if (atual) await atualizarMaterial(savepoint, atual, atual.versao, dados, req.user.sub);
        else id = await criarMaterial(savepoint, dados, req.user.sub);
        if (temColuna('pmc')) await gravarPmc(savepoint, id!, pmcCentavos, req.user.sub);
        return 'importada';
      });
    });
  });

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: materialSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(tx, materiais, materiais.ativo, req.params.id, req.body.ativo, req.user.sub, 'Produto');
        return carregar(tx, req.params.id);
      }),
  );

  /** Só material nunca precificado, movimentado no estoque nem com PMC alterado pode ser excluído (o histórico fica). */
  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        materiais,
        req.params.id,
        'Produto',
        'Este produto já tem preços, saldo de estoque ou histórico de PMC e não pode ser excluído (o histórico é mantido). Inative-o.',
      ),
    );
    return reply.code(204).send();
  });
};
