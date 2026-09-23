import {
  hojeIso,
  idParamSchema,
  precoAtualizarSchema,
  precoCancelarSchema,
  precoEncerrarSchema,
  precoInputSchema,
  precoSchema,
  precoVigenteQuerySchema,
  precoVigenteSchema,
  itemListaPrecosSchema,
  listaPrecosQuerySchema,
  situacaoPreco,
  temAcesso,
  type ItemListaPrecos,
  type Preco,
} from '@mobios/shared';
import { and, asc, desc, eq, gt, gte, isNull, lte, not, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { materiais, materiaisPrecos, precosEventos, tabelasPreco } from '../../db/schema.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

/** Dia anterior de uma data AAAA-MM-DD (sem fuso: só a data). */
const diaAnterior = (data: string) => new Date(Date.parse(`${data}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

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

/** Vigência (não cancelada) que vale na data. A constraint EXCLUDE garante que é no máximo uma. */
const vigenteEm = (materialId: string, tabelaPrecoId: string, data: string): SQL =>
  and(
    eq(materiaisPrecos.materialId, materialId),
    eq(materiaisPrecos.tabelaPrecoId, tabelaPrecoId),
    not(materiaisPrecos.cancelado),
    lte(materiaisPrecos.dataInicio, data),
    or(isNull(materiaisPrecos.dataFim), gte(materiaisPrecos.dataFim, data)),
  )!;

/**
 * Serializa alterações de preço do mesmo material + tabela (trava liberada no fim da transação).
 * A constraint EXCLUDE já impede sobreposição; a trava evita que duas inclusões simultâneas
 * leiam o mesmo "preço atual" e uma delas falhe no meio do encerramento automático.
 */
const travar = (tx: Tx, materialId: string, tabelaPrecoId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`precos:${materialId}:${tabelaPrecoId}`}))`);

type Evento = 'criado' | 'alterado' | 'encerrado' | 'cancelado' | 'reaberto';
const registrar = (
  tx: Tx,
  precoId: string,
  evento: Evento,
  usuarioId: string,
  antes: object | null,
  depois: object | null,
) => tx.insert(precosEventos).values({ precoId, evento, usuarioId, antes, depois });

/** Campos da vigência que entram na trilha de auditoria. */
const retrato = (p: { precoCentavos: number; dataInicio: string; dataFim: string | null }) => ({
  precoCentavos: p.precoCentavos,
  dataInicio: p.dataInicio,
  dataFim: p.dataFim,
});

async function buscarPreco(tx: Tx, id: string) {
  const [p] = await tx.select().from(materiaisPrecos).where(eq(materiaisPrecos.id, id));
  if (!p) throw naoEncontrado('Preço');
  return p;
}

export const precosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('precos'));
  const editar = { onRequest: app.exigirAcesso('precos', 'editar') };

  /**
   * "Qual o preço do SKU X na tabela Y na data Z?" Devolve exatamente um preço ou `preco: null`.
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
        const [preco] = await consulta(tx)
          .where(vigenteEm(material.id, tab.id, data))
          .limit(1);
        return { data, material, tabela: tab, preco: preco ? comSituacao(preco, data) : null };
      });
    },
  );

  /**
   * Lista de preços de uma tabela (consulta rápida no atendimento): material ativo, preço vigente hoje,
   * próximo preço programado e o disponível somado dos depósitos (só para quem acessa o Estoque).
   * Preço e próximo preço vêm de subconsultas LATERAL que usam o índice (material, tabela, início).
   */
  app.get(
    '/lista',
    {
      schema: {
        querystring: listaPrecosQuerySchema,
        response: { 200: z.object({ itens: z.array(itemListaPrecosSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { tabelaPrecoId, q, comPreco, pagina, porPagina } = req.query;
      const hoje = hojeIso();
      const verEstoque = temAcesso(req.user.acessos, 'estoque');
      const busca = q
        ? sql`and (m.sku like ${`${q.toUpperCase()}%`} or m.descricao ilike ${`%${q}%`} or m.codigo_fabricante like ${`${q.toUpperCase()}%`} or m.codigo_barras = ${q})`
        : sql``;
      const soComPreco = comPreco === 'true' ? sql`and v.preco_centavos is not null` : sql``;
      const base = sql`
        from materiais m
        left join marcas ma on ma.id = m.marca_id
        left join lateral (
          select p.preco_centavos, p.data_inicio, p.data_fim from materiais_precos p
          where p.material_id = m.id and p.tabela_preco_id = ${tabelaPrecoId} and not p.cancelado
            and p.data_inicio <= ${hoje}::date and (p.data_fim is null or p.data_fim >= ${hoje}::date)
          limit 1) v on true
        left join lateral (
          select p.preco_centavos, p.data_inicio from materiais_precos p
          where p.material_id = m.id and p.tabela_preco_id = ${tabelaPrecoId} and not p.cancelado and p.data_inicio > ${hoje}::date
          order by p.data_inicio limit 1) f on true
        where m.ativo ${busca} ${soComPreco}`;
      return withTenant(req.user.tid, async (tx) => {
        const [tabela] = await tx
          .select({ id: tabelasPreco.id })
          .from(tabelasPreco)
          .where(eq(tabelasPreco.id, tabelaPrecoId));
        if (!tabela) throw naoEncontrado('Tabela de preço');
        const linhas = (await tx.execute(sql`
          select m.id as "materialId", m.sku, m.descricao, ma.nome as "marcaNome", m.unidade::text as unidade,
            v.preco_centavos::float8 as "precoCentavos", v.data_inicio::text as "vigenteDesde", v.data_fim::text as "vigenteAte",
            f.preco_centavos::float8 as "proximoPrecoCentavos", f.data_inicio::text as "proximoInicio",
            ${verEstoque ? sql`(select coalesce(sum(e.disponivel), 0) from estoques e where e.material_id = m.id)::float8` : sql`null`} as disponivel
          ${base}
          order by m.descricao, m.sku
          limit ${porPagina} offset ${(pagina - 1) * porPagina}`)) as unknown as ItemListaPrecos[];
        const [{ total }] = (await tx.execute(sql`select count(*)::int as total ${base}`)) as unknown as [
          { total: number },
        ];
        return { itens: linhas, total };
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

  /**
   * Nova vigência. Nunca apaga nem reescreve o passado:
   * - início hoje ou depois;
   * - a vigência que vale na data de início é encerrada no dia anterior (e volta ao fim original se a nova for cancelada);
   * - fim vazio = aberta; havendo preço futuro depois, a nova termina na véspera dele;
   * - fim informado que invade um preço futuro, ou que termina antes do fim da vigência atual, = conflito (409).
   */
  app.post(
    '/',
    { ...editar, schema: { body: precoInputSchema, response: { 201: precoSchema } } },
    async (req, reply) => {
      const { materialId, tabelaPrecoId, precoCentavos, dataInicio } = req.body;
      let { dataFim } = req.body;
      const hoje = hojeIso();
      if (dataInicio < hoje)
        throw new ErroHttp(400, 'A vigência não pode começar no passado: o histórico de preços não é reescrito.');

      const preco = await withTenant(req.user.tid, async (tx) => {
        await travar(tx, materialId, tabelaPrecoId);
        const [material] = await tx
          .select({ ativo: materiais.ativo })
          .from(materiais)
          .where(eq(materiais.id, materialId));
        if (!material) throw naoEncontrado('Material');
        if (!material.ativo) throw new ErroHttp(400, 'Material inativo não recebe preço novo. Reative-o primeiro.');
        const [tabela] = await tx
          .select({ ativa: tabelasPreco.ativa })
          .from(tabelasPreco)
          .where(eq(tabelasPreco.id, tabelaPrecoId));
        if (!tabela) throw naoEncontrado('Tabela de preço');
        if (!tabela.ativa)
          throw new ErroHttp(400, 'Tabela de preço inativa não recebe preço novo. Reative-a primeiro.');

        const [atual] = await tx
          .select()
          .from(materiaisPrecos)
          .where(vigenteEm(materialId, tabelaPrecoId, dataInicio));
        if (atual?.dataInicio === dataInicio) {
          throw new ErroHttp(
            409,
            'Já existe um preço começando nesta data. Edite-o (se ainda não começou) ou escolha outra data de início.',
          );
        }
        const [proximo] = await tx
          .select({ dataInicio: materiaisPrecos.dataInicio })
          .from(materiaisPrecos)
          .where(
            and(
              eq(materiaisPrecos.materialId, materialId),
              eq(materiaisPrecos.tabelaPrecoId, tabelaPrecoId),
              not(materiaisPrecos.cancelado),
              gt(materiaisPrecos.dataInicio, dataInicio),
            ),
          )
          .orderBy(asc(materiaisPrecos.dataInicio))
          .limit(1);
        if (proximo) {
          if (!dataFim) dataFim = diaAnterior(proximo.dataInicio);
          else if (dataFim >= proximo.dataInicio) {
            throw new ErroHttp(
              409,
              `Já existe preço programado a partir de ${proximo.dataInicio.split('-').reverse().join('/')}. Termine a nova vigência antes dessa data.`,
            );
          }
        }

        // A nova só substitui a atual se cobrir o resto do período dela; terminar no meio partiria a vigência
        // em duas (com um buraco sem preço) — isso é sobreposição e é recusado.
        if (atual && dataFim && (atual.dataFim === null || dataFim < atual.dataFim)) {
          const fimAtual = atual.dataFim ? `até ${atual.dataFim.split('-').reverse().join('/')}` : 'sem data de fim';
          throw new ErroHttp(
            409,
            `O período se sobrepõe ao preço vigente (${fimAtual}). Deixe a nova vigência sem fim ou termine-a depois do fim da atual.`,
          );
        }

        // Encerra a vigência atual na véspera (guardando o fim anterior para desfazer se a nova for cancelada).
        if (atual) {
          await tx
            .update(materiaisPrecos)
            .set({ dataFim: diaAnterior(dataInicio), dataFimAnterior: atual.dataFim, atualizadoPor: req.user.sub })
            .where(eq(materiaisPrecos.id, atual.id));
        }
        const [novo] = (await tx
          .insert(materiaisPrecos)
          .values({
            materialId,
            tabelaPrecoId,
            precoCentavos,
            dataInicio,
            dataFim: dataFim ?? null,
            criadoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .returning()) as [typeof materiaisPrecos.$inferSelect];
        await registrar(tx, novo.id, 'criado', req.user.sub, null, retrato(novo));
        if (atual) {
          await tx
            .update(materiaisPrecos)
            .set({ encerradoPeloPrecoId: novo.id })
            .where(eq(materiaisPrecos.id, atual.id));
          await registrar(tx, atual.id, 'encerrado', req.user.sub, retrato(atual), {
            ...retrato(atual),
            dataFim: diaAnterior(dataInicio),
            motivo: 'Nova vigência',
          });
        }
        return carregar(tx, novo.id);
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
};
