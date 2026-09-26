import {
  aprovacaoComercialFiltroSchema,
  aprovacaoComercialResumoSchema,
  aprovacaoComercialSchema,
  decisaoComercialSchema,
  idParamSchema,
  reprovacaoComercialSchema,
  temAcesso,
  type AprovacaoComercial,
  type TipoDocumentoComercial,
} from '@mobios/shared';
import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  aprovacoesComerciais,
  aprovacoesComerciaisEventos,
  orcamentos,
  ordensServico,
  users,
} from '../../db/schema.js';
import {
  alcadaDoUsuario,
  bloqueioDaDecisao,
  decidirAprovacao,
  documentoDaAprovacao,
  funcoesQueAprovam,
  type AdaptadorDocumento,
} from '../../lib/aprovacao-comercial.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';
import { adaptadorOrcamento } from '../orcamentos/aprovacao.js';
import { adaptadorOrdemServico } from '../ordens-servico/aprovacao.js';

/** Um adaptador por documento ligado ao motor. O Pedido de Venda entra aqui quando existir. */
const ADAPTADORES: Record<TipoDocumentoComercial, AdaptadorDocumento> = {
  orcamento: adaptadorOrcamento,
  ordem_servico: adaptadorOrdemServico,
};

/**
 * O que o usuário enxerga. O vendedor (não Administrador) que também decide vê as solicitações dele, as dos
 * orçamentos e O.S. dele, as que decidiu e as pendentes que a alçada dele cobre; os demais, todas. As consultas
 * que usam o escopo juntam orçamento e O.S. (`comDocumentos`).
 */
async function escopo(tx: Tx, req: FastifyRequest): Promise<SQL | undefined> {
  if (!req.user.vendedorId) return undefined;
  const alcada = await alcadaDoUsuario(tx, req.user.sub);
  return or(
    eq(aprovacoesComerciais.solicitanteId, req.user.sub),
    eq(aprovacoesComerciais.decididoPor, req.user.sub),
    eq(orcamentos.vendedorId, req.user.vendedorId),
    eq(ordensServico.vendedorId, req.user.vendedorId),
    and(eq(aprovacoesComerciais.status, 'pendente'), sql`${aprovacoesComerciais.percentual} <= ${alcada.percentual}`),
  );
}

/** Pendentes que o usuário enxerga (alerta da página inicial). */
export async function contarPendentes(tx: Tx, req: FastifyRequest): Promise<number> {
  const [{ total }] = (await tx
    .select({ total: count() })
    .from(aprovacoesComerciais)
    .leftJoin(orcamentos, eq(orcamentos.id, aprovacoesComerciais.orcamentoId))
    .leftJoin(ordensServico, eq(ordensServico.id, aprovacoesComerciais.ordemServicoId))
    .where(and(eq(aprovacoesComerciais.status, 'pendente'), await escopo(tx, req)))) as [{ total: number }];
  return total;
}

const colunasResumo = {
  id: aprovacoesComerciais.id,
  tipoDocumento: aprovacoesComerciais.tipoDocumento,
  orcamentoId: aprovacoesComerciais.orcamentoId,
  ordemServicoId: aprovacoesComerciais.ordemServicoId,
  documentoNumero: aprovacoesComerciais.documentoNumero,
  documentoVersao: aprovacoesComerciais.documentoVersao,
  clienteNome: aprovacoesComerciais.clienteNome,
  solicitanteId: aprovacoesComerciais.solicitanteId,
  solicitante: nomeUsuario('aprovacoes_comerciais', 'solicitante_id'),
  solicitanteFuncao: aprovacoesComerciais.solicitanteFuncao,
  subtotalCentavos: aprovacoesComerciais.subtotalCentavos,
  descontoCentavos: aprovacoesComerciais.descontoCentavos,
  totalCentavos: aprovacoesComerciais.totalCentavos,
  percentual: aprovacoesComerciais.percentual,
  alcadaSolicitante: aprovacoesComerciais.alcadaSolicitante,
  status: aprovacoesComerciais.status,
  criadoEm: aprovacoesComerciais.criadoEm,
  decisor: nomeUsuario('aprovacoes_comerciais', 'decidido_por'),
  decididoEm: aprovacoesComerciais.decididoEm,
  versao: aprovacoesComerciais.versao,
};
const paraResumo = <
  T extends {
    tipoDocumento: TipoDocumentoComercial;
    orcamentoId: string | null;
    ordemServicoId: string | null;
    solicitante: string | null;
  },
>({
  orcamentoId,
  ordemServicoId,
  solicitante,
  ...a
}: T) => ({
  ...a,
  documentoId: documentoDaAprovacao({ tipoDocumento: a.tipoDocumento, orcamentoId, ordemServicoId }),
  solicitante: solicitante ?? '',
});

/** Detalhe com o retrato, a linha do tempo, quem pode aprovar e se o usuário atual pode decidir. */
async function carregar(tx: Tx, req: FastifyRequest, id: string): Promise<AprovacaoComercial> {
  const [linha] = await tx
    .select({
      ...colunasResumo,
      gravada: aprovacoesComerciais,
      documentoVendedorId: sql<string | null>`coalesce(${orcamentos.vendedorId}, ${ordensServico.vendedorId})`,
    })
    .from(aprovacoesComerciais)
    .leftJoin(orcamentos, eq(orcamentos.id, aprovacoesComerciais.orcamentoId))
    .leftJoin(ordensServico, eq(ordensServico.id, aprovacoesComerciais.ordemServicoId))
    .where(and(eq(aprovacoesComerciais.id, id), await escopo(tx, req)));
  if (!linha) throw naoEncontrado('Aprovação comercial');
  const { gravada, documentoVendedorId, ...resumo } = linha;

  const eventos = await tx
    .select({
      evento: aprovacoesComerciaisEventos.evento,
      usuario: users.nome,
      funcao: aprovacoesComerciaisEventos.funcao,
      alcada: aprovacoesComerciaisEventos.alcada,
      detalhe: aprovacoesComerciaisEventos.detalhe,
      criadoEm: aprovacoesComerciaisEventos.criadoEm,
    })
    .from(aprovacoesComerciaisEventos)
    .leftJoin(users, eq(users.id, aprovacoesComerciaisEventos.usuarioId))
    .where(eq(aprovacoesComerciaisEventos.aprovacaoId, id))
    .orderBy(aprovacoesComerciaisEventos.criadoEm, aprovacoesComerciaisEventos.id);
  const motivoBloqueio = temAcesso(req.user.acessos, 'aprovacao_comercial', 'editar')
    ? bloqueioDaDecisao(gravada, req.user.sub, await alcadaDoUsuario(tx, req.user.sub))
    : 'Você não tem permissão para aprovar ou reprovar.';
  return {
    ...paraResumo(resumo),
    decisorFuncao: gravada.decisorFuncao,
    alcadaDecisor: gravada.alcadaDecisor,
    justificativa: gravada.justificativa,
    documentoVendedorId,
    // Margem (PMC e custo) é interna: só para quem tem "Custos e margem".
    snapshot: temAcesso(req.user.acessos, 'custos') ? gravada.snapshot : { ...gravada.snapshot, margem: undefined },
    aprovadores: await funcoesQueAprovam(tx, gravada.percentual),
    podeDecidir: motivoBloqueio === null,
    motivoBloqueio,
    eventos,
  };
}

/**
 * Aprovações comerciais (menu Aprovações comerciais). Consultar: ver lista, retrato e histórico; Editar: aprovar e
 * reprovar, até a alçada. A solicitação nasce sozinha na emissão do documento (não há rota para criá-la), e quem
 * a retira é o solicitante, pelo próprio documento.
 */
export const aprovacoesComerciaisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('aprovacao_comercial'));
  const decidir = { onRequest: app.exigirAcesso('aprovacao_comercial', 'editar') };

  app.get(
    '/',
    {
      schema: {
        querystring: aprovacaoComercialFiltroSchema,
        response: { 200: z.object({ itens: z.array(aprovacaoComercialResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, status, tipo, posso, pagina, porPagina } = req.query;
      // "ORC-0000000012", "OS-000012" e "12" são o mesmo número (do orçamento ou da O.S.).
      const numero = q?.replace(/^(orc|os)-?/i, '').replace(/^0+(?=\d)/, '');
      return withTenant(req.user.tid, async (tx) => {
        const alcada = posso ? await alcadaDoUsuario(tx, req.user.sub) : null;
        const onde = and(
          await escopo(tx, req),
          q
            ? or(
                ilike(aprovacoesComerciais.clienteNome, `%${q}%`),
                ...(numero && /^\d{1,9}$/.test(numero)
                  ? [eq(orcamentos.numero, Number(numero)), eq(ordensServico.numero, Number(numero))]
                  : []),
              )
            : undefined,
          status ? eq(aprovacoesComerciais.status, status) : undefined,
          tipo ? eq(aprovacoesComerciais.tipoDocumento, tipo) : undefined,
          alcada
            ? temAcesso(req.user.acessos, 'aprovacao_comercial', 'editar')
              ? and(
                  eq(aprovacoesComerciais.status, 'pendente'),
                  ne(aprovacoesComerciais.solicitanteId, req.user.sub),
                  sql`${aprovacoesComerciais.percentual} <= ${alcada.percentual}`,
                )
              : sql`false`
            : undefined,
        );
        const itens = await tx
          .select(colunasResumo)
          .from(aprovacoesComerciais)
          .leftJoin(orcamentos, eq(orcamentos.id, aprovacoesComerciais.orcamentoId))
          .leftJoin(ordensServico, eq(ordensServico.id, aprovacoesComerciais.ordemServicoId))
          .where(onde)
          .orderBy(desc(aprovacoesComerciais.criadoEm), desc(aprovacoesComerciais.id))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(aprovacoesComerciais)
          .leftJoin(orcamentos, eq(orcamentos.id, aprovacoesComerciais.orcamentoId))
          .leftJoin(ordensServico, eq(ordensServico.id, aprovacoesComerciais.ordemServicoId))
          .where(onde)) as [{ total: number }];
        return { itens: itens.map(paraResumo), total };
      });
    },
  );

  app.get('/:id', { schema: { params: idParamSchema, response: { 200: aprovacaoComercialSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req, req.params.id)),
  );

  app.post(
    '/:id/aprovar',
    {
      ...decidir,
      schema: { params: idParamSchema, body: decisaoComercialSchema, response: { 200: aprovacaoComercialSchema } },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await carregar(tx, req, req.params.id);
        await decidirAprovacao(tx, ADAPTADORES, {
          id: req.params.id,
          usuarioId: req.user.sub,
          versao: req.body.versao,
          decisao: 'aprovada',
        });
        return carregar(tx, req, req.params.id);
      }),
  );

  app.post(
    '/:id/reprovar',
    {
      ...decidir,
      schema: { params: idParamSchema, body: reprovacaoComercialSchema, response: { 200: aprovacaoComercialSchema } },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await carregar(tx, req, req.params.id);
        await decidirAprovacao(tx, ADAPTADORES, {
          id: req.params.id,
          usuarioId: req.user.sub,
          versao: req.body.versao,
          decisao: 'reprovada',
          justificativa: req.body.justificativa,
        });
        return carregar(tx, req, req.params.id);
      }),
  );
};
