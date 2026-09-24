import {
  COLUNAS_IMPORTACAO_LINHAS_PRECO,
  COLUNAS_IMPORTACAO_PRECOS,
  eventoPrecoPadraoSchema,
  hojeIso,
  idParamSchema,
  precoAtualizarSchema,
  precoCancelarSchema,
  precoEncerrarSchema,
  precoInputSchema,
  PRECO_MAXIMO,
  precoPadraoInputSchema,
  precoPadraoSchema,
  precoSchema,
  precoVigenteQuerySchema,
  precoVigenteSchema,
  linhaPrecoSchema,
  linhasPrecoQuerySchema,
  resultadoImportacaoSchema,
  situacaoPreco,
  type EventoPrecoPadrao,
  type LinhaPreco,
  type Preco,
} from '@mobios/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  materiais,
  materiaisPrecos,
  precosEventos,
  precosPadrao,
  precosPadraoEventos,
  tabelasPreco,
} from '../../db/schema.js';
import { buscaDeMaterial, nomeUsuario } from '../../lib/cadastro.js';
import { lerData, lerNumero } from '../../lib/csv.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { aceitarUploadDeCsv, importarLinhas, lerPlanilhaEnviada } from '../../lib/importacao.js';
import {
  criarVigencia,
  definirPrecoPadrao,
  registrar,
  removerPrecoPadrao,
  resolverMaterial,
  retrato,
  travar,
  vigenteEm,
} from './regras.js';

const colunas = {
  id: materiaisPrecos.id,
  materialId: materiaisPrecos.materialId,
  tabelaPrecoId: materiaisPrecos.tabelaPrecoId,
  tabelaCodigo: tabelasPreco.codigo,
  tabelaNome: tabelasPreco.nome,
  moeda: sql<string>`${tabelasPreco.moeda}`,
  precoCentavos: materiaisPrecos.precoCentavos,
  dataInicio: materiaisPrecos.dataInicio,
  dataFim: materiaisPrecos.dataFim,
  cancelado: materiaisPrecos.cancelado,
  motivoCancelamento: materiaisPrecos.motivoCancelamento,
  criadoEm: materiaisPrecos.criadoEm,
  criadoPor: nomeUsuario('materiais_precos', 'criado_por'),
  canceladoEm: materiaisPrecos.canceladoEm,
  canceladoPor: nomeUsuario('materiais_precos', 'cancelado_por'),
};

type Linha = { cancelado: boolean; dataInicio: string; dataFim: string | null };
const comSituacao = <T extends Linha>({ cancelado, ...p }: T, data = hojeIso()) => ({
  ...p,
  situacao: situacaoPreco({ ...p, cancelado }, data),
});

const consulta = (tx: Tx) =>
  tx.select(colunas).from(materiaisPrecos).innerJoin(tabelasPreco, eq(tabelasPreco.id, materiaisPrecos.tabelaPrecoId));

async function carregar(tx: Tx, id: string): Promise<Preco> {
  const [p] = await consulta(tx).where(eq(materiaisPrecos.id, id));
  if (!p) throw naoEncontrado('Preço');
  return comSituacao(p);
}

async function buscarPreco(tx: Tx, id: string) {
  const [p] = await tx.select().from(materiaisPrecos).where(eq(materiaisPrecos.id, id));
  if (!p) throw naoEncontrado('Preço');
  return p;
}

export const precosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('precos'));
  const editar = { onRequest: app.exigirAcesso('precos', 'editar') };
  aceitarUploadDeCsv(app);

  /**
   * "Qual o preço do SKU X na tabela Y na data Z?" A vigência que cobre a data ou, sem ela, o preço padrão.
   * Material/tabela inativos ainda respondem (o histórico continua consultável), com `ativo`/`ativa` informando.
   */
  app.get(
    '/vigente',
    { schema: { querystring: precoVigenteQuerySchema, response: { 200: precoVigenteSchema } } },
    async (req) => {
      const { materialId, sku, tabelaPrecoId, tabela, data = hojeIso() } = req.query;
      return withTenant(req.user.tid, async (tx) => {
        const [material] = await tx
          .select({ id: materiais.id, sku: materiais.sku, descricao: materiais.descricao, ativo: materiais.ativo })
          .from(materiais)
          .where(materialId ? eq(materiais.id, materialId) : eq(materiais.sku, sku!));
        if (!material) throw naoEncontrado('Material');
        const [tab] = await tx
          .select({
            id: tabelasPreco.id,
            codigo: tabelasPreco.codigo,
            nome: tabelasPreco.nome,
            ativa: tabelasPreco.ativa,
          })
          .from(tabelasPreco)
          .where(tabelaPrecoId ? eq(tabelasPreco.id, tabelaPrecoId) : eq(tabelasPreco.codigo, tabela!));
        if (!tab) throw naoEncontrado('Tabela de preço');
        const [linha] = await consulta(tx)
          .where(vigenteEm(material.id, tab.id, data))
          .limit(1);
        const [padrao] = await tx
          .select({ precoCentavos: precosPadrao.precoCentavos })
          .from(precosPadrao)
          .where(and(eq(precosPadrao.materialId, material.id), eq(precosPadrao.tabelaPrecoId, tab.id)));
        // Sem vigência cobrindo a data, vale o preço padrão (se houver).
        const preco = linha ? comSituacao(linha, data) : null;
        return {
          data,
          material,
          tabela: tab,
          preco,
          valorCentavos: preco?.precoCentavos ?? padrao?.precoCentavos ?? null,
          origem: preco ? ('vigencia' as const) : padrao ? ('padrao' as const) : null,
        };
      });
    },
  );

  /**
   * Linhas de Preço de uma tabela: cada vigência é uma linha (com início, fim e situação) e o preço padrão
   * é outra. Só preço: sem estoque nem outros dados do material além de SKU e descrição.
   * Filtro de situação: por padrão, o que vale hoje, o que vem depois e o padrão.
   */
  app.get(
    '/linhas',
    {
      schema: {
        querystring: linhasPrecoQuerySchema,
        response: { 200: z.object({ itens: z.array(linhaPrecoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { tabelaPrecoId, q, situacao, pagina, porPagina } = req.query;
      const hoje = hojeIso();
      // Mesma regra de situacaoPreco (shared), calculada no banco para poder filtrar e paginar.
      const situacaoDaVigencia = sql`case
        when p.cancelado then 'cancelado'
        when p.data_inicio > ${hoje}::date then 'futuro'
        when p.data_fim < ${hoje}::date then 'encerrado'
        else 'vigente' end`;
      const filtroSituacao =
        situacao === 'todas'
          ? sql``
          : situacao === 'atuais'
            ? sql`and l.situacao in ('vigente', 'futuro', 'padrao')`
            : sql`and l.situacao = ${situacao}`;
      const busca = q ? sql`and ${buscaDeMaterial(q)}` : sql``;
      // `materiais` sem apelido: o filtro de busca (buscaDeMaterial) usa as colunas com o nome da tabela.
      const base = sql`
        from (
          select p.id::text as id, p.material_id, p.preco_centavos, p.data_inicio, p.data_fim,
            ${situacaoDaVigencia} as situacao, 1 as ordem
          from materiais_precos p where p.tabela_preco_id = ${tabelaPrecoId}
          union all
          select 'padrao:' || pp.material_id, pp.material_id, pp.preco_centavos, null, null, 'padrao', 2
          from precos_padrao pp where pp.tabela_preco_id = ${tabelaPrecoId}
        ) l
        join materiais on materiais.id = l.material_id
        where materiais.ativo ${busca} ${filtroSituacao}`;
      return withTenant(req.user.tid, async (tx) => {
        const [tabela] = await tx
          .select({ id: tabelasPreco.id })
          .from(tabelasPreco)
          .where(eq(tabelasPreco.id, tabelaPrecoId));
        if (!tabela) throw naoEncontrado('Tabela de preço');
        const itens = (await tx.execute(sql`
          select l.id, materiais.id as "materialId", materiais.sku, materiais.descricao,
            l.preco_centavos::float8 as "precoCentavos",
            l.data_inicio::text as "dataInicio",
            l.data_fim::text as "dataFim",
            l.situacao
          ${base}
          order by materiais.descricao, materiais.sku, l.ordem, l.data_inicio
          limit ${porPagina} offset ${(pagina - 1) * porPagina}`)) as unknown as LinhaPreco[];
        const [{ total }] = (await tx.execute(sql`select count(*)::int as total ${base}`)) as unknown as [
          { total: number },
        ];
        return { itens, total };
      });
    },
  );

  /** Todas as vigências do material (histórico completo, inclusive canceladas), por tabela e da mais nova para a mais antiga. */
  app.get(
    '/',
    {
      schema: {
        querystring: z.object({ materialId: z.uuid(), tabelaPrecoId: z.uuid().optional() }),
        response: { 200: z.array(precoSchema) },
      },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const lista = await consulta(tx)
          .where(
            and(
              eq(materiaisPrecos.materialId, req.query.materialId),
              req.query.tabelaPrecoId ? eq(materiaisPrecos.tabelaPrecoId, req.query.tabelaPrecoId) : undefined,
            ),
          )
          .orderBy(asc(tabelasPreco.nome), desc(materiaisPrecos.dataInicio), desc(materiaisPrecos.criadoEm));
        return lista.map((p) => comSituacao(p));
      }),
  );

  /** Nova vigência (regras em criarVigencia). Material pelo id ou pelo SKU digitado. */
  app.post(
    '/',
    { ...editar, schema: { body: precoInputSchema, response: { 201: precoSchema } } },
    async (req, reply) => {
      const { materialId, sku, ...vigencia } = req.body;
      const preco = await withTenant(req.user.tid, async (tx) => {
        const material = await resolverMaterial(tx, { materialId, sku });
        const id = await criarVigencia(tx, { ...vigencia, material }, req.user.sub);
        return carregar(tx, id);
      });
      return reply.code(201).send(preco);
    },
  );

  /** Preço futuro (ainda não começou): corrige valor e fim. Preço que já começou não é alterado. */
  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: precoAtualizarSchema, response: { 200: precoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const p = await buscarPreco(tx, req.params.id);
        await travar(tx, p.materialId, p.tabelaPrecoId);
        const atual = await buscarPreco(tx, req.params.id); // relido depois da trava
        if (atual.cancelado) throw new ErroHttp(409, 'Preço cancelado não pode ser alterado.');
        if (atual.dataInicio <= hojeIso()) {
          throw new ErroHttp(
            409,
            'Este preço já está em vigor (ou encerrado) e não pode ser alterado. Cadastre uma nova vigência.',
          );
        }
        const { precoCentavos, dataFim } = req.body;
        if (dataFim && dataFim < atual.dataInicio)
          throw new ErroHttp(400, 'O fim deve ser igual ou posterior ao início.');
        await tx
          .update(materiaisPrecos)
          .set({ precoCentavos, dataFim, atualizadoPor: req.user.sub })
          .where(eq(materiaisPrecos.id, atual.id));
        await registrar(tx, atual.id, 'alterado', req.user.sub, retrato(atual), {
          ...retrato(atual),
          precoCentavos,
          dataFim,
        });
        return carregar(tx, atual.id);
      }),
  );

  /** Encerra (ou reprograma o fim de) uma vigência atual ou futura. Não mexe em dia que já passou. */
  app.post(
    '/:id/encerrar',
    { ...editar, schema: { params: idParamSchema, body: precoEncerrarSchema, response: { 200: precoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const p = await buscarPreco(tx, req.params.id);
        await travar(tx, p.materialId, p.tabelaPrecoId);
        const atual = await buscarPreco(tx, req.params.id);
        const hoje = hojeIso();
        const { dataFim } = req.body;
        if (atual.cancelado) throw new ErroHttp(409, 'Preço cancelado não pode ser encerrado.');
        if (atual.dataFim && atual.dataFim < hoje) throw new ErroHttp(409, 'Este preço já está encerrado.');
        if (dataFim < hoje) throw new ErroHttp(400, 'O encerramento não pode ser no passado.');
        if (dataFim < atual.dataInicio) throw new ErroHttp(400, 'O fim deve ser igual ou posterior ao início.');
        // Ampliar o fim até um preço futuro é barrado pela constraint EXCLUDE (409).
        await tx
          .update(materiaisPrecos)
          .set({ dataFim, dataFimAnterior: null, encerradoPeloPrecoId: null, atualizadoPor: req.user.sub })
          .where(eq(materiaisPrecos.id, atual.id));
        await registrar(tx, atual.id, 'encerrado', req.user.sub, retrato(atual), { ...retrato(atual), dataFim });
        return carregar(tx, atual.id);
      }),
  );

  /**
   * Cancela um preço que ainda não começou (exclusão lógica: o registro fica no histórico com o motivo).
   * Se ele tinha encerrado automaticamente a vigência anterior, ela volta ao fim original.
   */
  app.post(
    '/:id/cancelar',
    { ...editar, schema: { params: idParamSchema, body: precoCancelarSchema, response: { 200: precoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const p = await buscarPreco(tx, req.params.id);
        await travar(tx, p.materialId, p.tabelaPrecoId);
        const atual = await buscarPreco(tx, req.params.id);
        if (atual.cancelado) throw new ErroHttp(409, 'Este preço já está cancelado.');
        if (atual.dataInicio <= hojeIso())
          throw new ErroHttp(
            409,
            'Só é possível cancelar preço que ainda não começou. Para um preço em vigor, use Encerrar.',
          );
        await tx
          .update(materiaisPrecos)
          .set({
            cancelado: true,
            motivoCancelamento: req.body.motivo,
            canceladoEm: new Date(),
            canceladoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .where(eq(materiaisPrecos.id, atual.id));
        await registrar(tx, atual.id, 'cancelado', req.user.sub, retrato(atual), { motivo: req.body.motivo });

        const encerrados = await tx
          .select()
          .from(materiaisPrecos)
          .where(eq(materiaisPrecos.encerradoPeloPrecoId, atual.id));
        for (const anterior of encerrados) {
          await tx
            .update(materiaisPrecos)
            .set({
              dataFim: anterior.dataFimAnterior,
              dataFimAnterior: null,
              encerradoPeloPrecoId: null,
              atualizadoPor: req.user.sub,
            })
            .where(eq(materiaisPrecos.id, anterior.id));
          await registrar(tx, anterior.id, 'reaberto', req.user.sub, retrato(anterior), {
            ...retrato(anterior),
            dataFim: anterior.dataFimAnterior,
          });
        }
        return carregar(tx, atual.id);
      }),
  );

  /** Trilha de auditoria de uma vigência. */
  app.get(
    '/:id/eventos',
    {
      schema: {
        params: idParamSchema,
        response: {
          200: z.array(
            z.object({
              evento: z.string(),
              antes: z.unknown(),
              depois: z.unknown(),
              usuario: z.string().nullable(),
              criadoEm: z.coerce.date(),
            }),
          ),
        },
      },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await buscarPreco(tx, req.params.id);
        return tx
          .select({
            evento: precosEventos.evento,
            antes: precosEventos.antes,
            depois: precosEventos.depois,
            usuario: nomeUsuario('precos_eventos', 'usuario_id'),
            criadoEm: precosEventos.criadoEm,
          })
          .from(precosEventos)
          .where(eq(precosEventos.precoId, req.params.id))
          .orderBy(asc(precosEventos.criadoEm));
      }),
  );

  // ---------- Preço padrão (sem vigência) ----------

  const padraoQuery = z.object({ materialId: z.uuid(), tabelaPrecoId: z.uuid() });

  /** Preços padrão do material, um por tabela. */
  app.get(
    '/padrao',
    {
      schema: {
        querystring: z.object({ materialId: z.uuid() }),
        response: { 200: z.array(precoPadraoSchema) },
      },
    },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        consultaPadrao(tx).where(eq(precosPadrao.materialId, req.query.materialId)).orderBy(asc(tabelasPreco.nome)),
      ),
  );

  /** Define ou altera o preço padrão. Material pelo id ou pelo SKU digitado; `versao` protege a edição. */
  app.put(
    '/padrao',
    { ...editar, schema: { body: precoPadraoInputSchema, response: { 200: precoPadraoSchema } } },
    async (req) => {
      const { materialId, sku, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        const material = await resolverMaterial(tx, { materialId, sku });
        await definirPrecoPadrao(tx, { ...dados, material }, req.user.sub);
        const [padrao] = await consultaPadrao(tx).where(
          and(eq(precosPadrao.materialId, material.id), eq(precosPadrao.tabelaPrecoId, dados.tabelaPrecoId)),
        );
        return padrao!;
      });
    },
  );

  app.delete('/padrao', { ...editar, schema: { querystring: padraoQuery } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      removerPrecoPadrao(tx, req.query.materialId, req.query.tabelaPrecoId, req.user.sub),
    );
    return reply.code(204).send();
  });

  /** Trilha do preço padrão de um material numa tabela (mais recente primeiro). */
  app.get(
    '/padrao/eventos',
    { schema: { querystring: padraoQuery, response: { 200: z.array(eventoPrecoPadraoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        tx
          .select({
            evento: sql<EventoPrecoPadrao['evento']>`${precosPadraoEventos.evento}`,
            precoAntes: precosPadraoEventos.precoAntes,
            precoDepois: precosPadraoEventos.precoDepois,
            usuario: nomeUsuario('precos_padrao_eventos', 'usuario_id'),
            criadoEm: precosPadraoEventos.criadoEm,
          })
          .from(precosPadraoEventos)
          .where(
            and(
              eq(precosPadraoEventos.materialId, req.query.materialId),
              eq(precosPadraoEventos.tabelaPrecoId, req.query.tabelaPrecoId),
            ),
          )
          .orderBy(desc(precosPadraoEventos.criadoEm))
          .limit(100),
      ),
  );

  // ---------- Importação por planilha ----------

  /**
   * Preços em massa por CSV (colunas em COLUNAS_IMPORTACAO_PRECOS; a 1ª linha é o cabeçalho).
   * Com `?tabelaPrecoId` (tela Linhas de Preço), a coluna `tabela` é opcional e, vazia, usa essa tabela.
   * Linha com `inicio` = nova vigência (mesmas regras da tela); sem `inicio` = preço padrão.
   * Grava as linhas válidas e devolve o erro de cada uma das outras, com o número da linha.
   */
  app.post(
    '/importar',
    {
      ...editar,
      schema: {
        querystring: z.object({ tabelaPrecoId: z.uuid().optional() }),
        response: { 200: resultadoImportacaoSchema },
      },
    },
    async (req) => {
      const tabelaDaTela = req.query.tabelaPrecoId;
      const linhas = lerPlanilhaEnviada(
        req.body,
        tabelaDaTela ? COLUNAS_IMPORTACAO_LINHAS_PRECO : COLUNAS_IMPORTACAO_PRECOS,
      );
      return withTenant(req.user.tid, async (tx) => {
        // Tabelas e materiais da planilha lidos de uma vez, não uma consulta por linha.
        const tabelas = new Map(
          (await tx.select({ id: tabelasPreco.id, codigo: tabelasPreco.codigo }).from(tabelasPreco)).map((t) => [
            t.codigo,
            t.id,
          ]),
        );
        const skus = [...new Set(linhas.map((l) => (l.valores.sku ?? '').toUpperCase()).filter(Boolean))];
        const encontrados = skus.length
          ? await tx
              .select({ id: materiais.id, sku: materiais.sku, ativo: materiais.ativo })
              .from(materiais)
              .where(inArray(materiais.sku, skus))
          : [];
        const porSku = new Map(encontrados.map((m) => [m.sku, m]));
        if (tabelaDaTela && ![...tabelas.values()].includes(tabelaDaTela)) throw naoEncontrado('Tabela de preço');

        return importarLinhas(tx, linhas, async (savepoint, { valores }) => {
          const valor = (coluna: string) => valores[coluna] ?? '';
          const tabelaPrecoId = valor('tabela') ? tabelas.get(valor('tabela').toUpperCase()) : tabelaDaTela;
          if (!tabelaPrecoId) {
            throw new ErroHttp(
              400,
              valor('tabela')
                ? `Tabela de preço "${valor('tabela')}" não encontrada.`
                : 'tabela: informe o código da tabela de preço.',
            );
          }
          const material = porSku.get(valor('sku').toUpperCase());
          if (!material) throw new ErroHttp(400, `SKU "${valor('sku')}" não encontrado.`);
          const precoCentavos = lerPrecoCentavos(valor('preco'));

          if (!valor('inicio')) {
            const situacao = await definirPrecoPadrao(
              savepoint,
              { material, tabelaPrecoId, precoCentavos },
              req.user.sub,
            );
            return situacao === 'sem_alteracao' ? 'ignorada' : 'importada';
          }
          const dataInicio = lerData(valor('inicio'));
          if (!dataInicio) throw new ErroHttp(400, `Início "${valor('inicio')}" inválido: use dd/mm/aaaa.`);
          const dataFim = valor('fim') ? lerData(valor('fim')) : null;
          if (valor('fim') && !dataFim) throw new ErroHttp(400, `Fim "${valor('fim')}" inválido: use dd/mm/aaaa.`);
          if (dataFim && dataFim < dataInicio) throw new ErroHttp(400, 'O fim deve ser igual ou posterior ao início.');
          await criarVigencia(savepoint, { material, tabelaPrecoId, precoCentavos, dataInicio, dataFim }, req.user.sub);
          return 'importada';
        });
      });
    },
  );
};

const consultaPadrao = (tx: Tx) =>
  tx
    .select({
      materialId: precosPadrao.materialId,
      tabelaPrecoId: precosPadrao.tabelaPrecoId,
      tabelaCodigo: tabelasPreco.codigo,
      tabelaNome: tabelasPreco.nome,
      precoCentavos: precosPadrao.precoCentavos,
      atualizadoEm: precosPadrao.atualizadoEm,
      atualizadoPor: nomeUsuario('precos_padrao', 'atualizado_por'),
      versao: precosPadrao.versao,
    })
    .from(precosPadrao)
    .innerJoin(tabelasPreco, eq(tabelasPreco.id, precosPadrao.tabelaPrecoId));

/** Preço de planilha em reais (vírgula decimal, até 2 casas) convertido para centavos. */
function lerPrecoCentavos(texto: string): number {
  const reais = lerNumero(texto);
  const centavos = reais == null ? NaN : Math.round(reais * 100);
  if (reais == null || reais < 0 || Math.abs(centavos - reais * 100) > 1e-6 || centavos > PRECO_MAXIMO) {
    throw new ErroHttp(400, `Preço "${texto}" inválido: use reais com vírgula decimal (ex.: 150,00).`);
  }
  return centavos;
}
