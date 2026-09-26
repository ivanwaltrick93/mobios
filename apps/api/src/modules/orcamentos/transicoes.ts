import { randomUUID } from 'node:crypto';
import {
  calcularMargem,
  conversaoOrcamentoInputSchema,
  conversaoOrcamentoSchema,
  dentroDaAlcada,
  formatarDataIso,
  formatarNumeroOrcamento,
  formatarPercentual,
  hojeIso,
  idParamSchema,
  orcamentoSchema,
  percentualDoItem,
  somarDias,
  transicaoOrcamentoSchema,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  type EventoOrcamento,
  type SituacaoOrcamento,
} from '@mobios/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant, type Tx } from '../../db/client.js';
import { orcamentoItens, orcamentos, vendedores } from '../../db/schema.js';
import {
  alcadaDoUsuario,
  cancelarAprovacao,
  pendenteDoDocumento,
  solicitarAprovacao,
} from '../../lib/aprovacao-comercial.js';
import { ErroHttp } from '../../lib/erros.js';
import { snapshotDoOrcamento } from './aprovacao.js';
import { converterEmOs } from './conversao.js';
import {
  carregar,
  exigirPrecosDoDia,
  exigirQuemAltera,
  exigirSituacao,
  exigirVersaoLida,
  travar,
  type Gravado,
} from './consulta.js';
import { gravarItens, itensDoOrcamento, registrar } from './regras.js';

/** "1 item" / "2 itens" acima da alçada. */
const itensAcima = (percentuais: number[], alcada: number) => {
  const n = percentuais.filter((p) => !dentroDaAlcada(p, alcada)).length;
  return `${n} ${n === 1 ? 'item' : 'itens'}`;
};

/**
 * Mudanças de situação do orçamento: emitir (com a alçada comercial), enviar, aprovar, recusar, cancelar, retirar o
 * pedido de aprovação e gerar nova versão. Registrado dentro de `orcamentosRoutes`.
 */
export const transicoesOrcamentoRoutes: FastifyPluginAsyncZod = async (app) => {
  const editar = { onRequest: exigirQuemAltera };
  const aprovar = { onRequest: app.exigirAcesso('aprovar_orcamentos', 'editar') };
  const resposta = { 200: orcamentoSchema };

  /**
   * Emissão: conteúdo congelado. Validade vazia = 7 dias; de hoje até no máximo 30 dias. Desconto acima da alçada
   * de quem emite: vai para "aguardando aprovação comercial" (docs/modulos/APROVACAO_COMERCIAL.md) e só é emitido
   * quando aprovado, com a validade contando da aprovação.
   */
  app.post(
    '/:id/emitir',
    { ...editar, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['rascunho'], 'emitir');
        exigirPrecosDoDia(atual);
        const [{ itens }] = (await tx
          .select({ itens: count() })
          .from(orcamentoItens)
          .where(eq(orcamentoItens.orcamentoId, atual.id))) as [{ itens: number }];
        if (!itens) throw new ErroHttp(400, 'Inclua ao menos um produto ou serviço antes de emitir.');
        const [vendedor] = await tx
          .select({ ativo: vendedores.ativo })
          .from(vendedores)
          .where(eq(vendedores.id, atual.vendedorId));
        if (!vendedor?.ativo)
          throw new ErroHttp(400, 'O vendedor deste orçamento está inativo. Escolha outro antes de emitir.');

        const hoje = hojeIso();
        const maxima = somarDias(hoje, VALIDADE_MAXIMA_DIAS);
        const validadeAte = atual.validadeAte ?? somarDias(hoje, VALIDADE_PADRAO_DIAS);
        if (validadeAte < hoje)
          throw new ErroHttp(400, 'A validade não pode ser anterior a hoje.', {
            validadeAte: 'Informe hoje ou uma data futura',
          });
        if (validadeAte > maxima)
          throw new ErroHttp(
            400,
            `A validade vai no máximo até ${formatarDataIso(maxima)} (${VALIDADE_MAXIMA_DIAS} dias).`,
            { validadeAte: `No máximo ${formatarDataIso(maxima)}` },
          );

        // Alçada por item, nunca pelo total (25/09/2026): vale o maior desconto entre os itens.
        const gravados = await itensDoOrcamento(tx, atual.id);
        const percentuais = gravados.map((i) =>
          percentualDoItem(i.precoTabelaCentavos, i.precoUnitarioCentavos, i.descontoPercentual),
        );
        const percentual = Math.max(0, ...percentuais);
        const alcada = await alcadaDoUsuario(tx, req.user.sub);
        if (!dentroDaAlcada(percentual, alcada.percentual)) {
          const orcamento = await carregar(tx, atual.id, null);
          const validadeDias = (Date.parse(validadeAte) - Date.parse(hoje)) / 86_400_000;
          await solicitarAprovacao(tx, {
            tipoDocumento: 'orcamento',
            documentoId: atual.id,
            documentoNumero: formatarNumeroOrcamento(atual.numero),
            documentoVersao: atual.versaoOrcamento,
            clienteNome: orcamento.cliente.nome,
            subtotalCentavos: atual.subtotalCentavos,
            descontoCentavos: atual.descontoCentavos,
            totalCentavos: atual.totalCentavos,
            percentual,
            solicitanteId: req.user.sub,
            alcada,
            // Margem para o aprovador: PMC congelado nos itens e preço líquido negociado, calculada agora.
            snapshot: {
              ...snapshotDoOrcamento(orcamento, validadeDias, alcada.percentual),
              margem: calcularMargem(
                gravados.map((i) => ({
                  tipo: i.tipo,
                  quantidade: i.quantidade == null ? null : Number(i.quantidade),
                  brutoCentavos: i.brutoCentavos,
                  totalCentavos: i.totalCentavos,
                  pmcCentavos: i.pmcCentavos,
                })),
              ),
            },
          });
          await tx
            .update(orcamentos)
            .set({ status: 'aguardando_aprovacao_comercial', atualizadoPor: req.user.sub, versao: atual.versao + 1 })
            .where(eq(orcamentos.id, atual.id));
          await registrar(
            tx,
            atual.id,
            'aprovacao_comercial_solicitada',
            req.user.sub,
            `${itensAcima(percentuais, alcada.percentual)}: desconto de até ${formatarPercentual(percentual)}, acima da ` +
              `alçada de ${formatarPercentual(alcada.percentual)}${alcada.funcao ? ` (${alcada.funcao})` : ''}.`,
          );
          return carregar(tx, atual.id, req.user.vendedorId);
        }
        await tx
          .update(orcamentos)
          .set({
            status: 'emitido',
            validadeAte,
            emitidoEm: new Date(),
            emitidoPor: req.user.sub,
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'emitido', req.user.sub, `Válido até ${formatarDataIso(validadeAte)}.`);
        return carregar(tx, atual.id, req.user.vendedorId);
      }),
  );

  /** Transição simples de situação, com a trava da linha, a versão lida e o registro no histórico. */
  const transicao = (
    rota: string,
    opcoes: { onRequest: typeof editar.onRequest },
    regra: {
      de: SituacaoOrcamento[];
      acao: string;
      evento: EventoOrcamento;
      valores: (usuarioId: string, motivo: string | null) => Partial<typeof orcamentos.$inferInsert>;
      detalhe?: (motivo: string | null) => string | undefined;
      /** Efeito extra na mesma transação (ex.: cancelar a aprovação comercial pendente). */
      depois?: (tx: Tx, atual: Gravado, usuarioId: string) => Promise<void>;
    },
  ) =>
    app.post(
      rota,
      { ...opcoes, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
      async (req) =>
        withTenant(req.user.tid, async (tx) => {
          const atual = await travar(tx, req.params.id, req.user.vendedorId);
          exigirVersaoLida(atual, req.body.versao);
          exigirSituacao(atual, regra.de, regra.acao);
          await tx
            .update(orcamentos)
            .set({
              ...regra.valores(req.user.sub, req.body.motivo),
              atualizadoPor: req.user.sub,
              versao: atual.versao + 1,
            })
            .where(eq(orcamentos.id, atual.id));
          await registrar(tx, atual.id, regra.evento, req.user.sub, regra.detalhe?.(req.body.motivo));
          await regra.depois?.(tx, atual, req.user.sub);
          return carregar(tx, atual.id, req.user.vendedorId);
        }),
    );

  transicao('/:id/enviar', editar, {
    de: ['emitido'],
    acao: 'marcar como enviado',
    evento: 'enviado',
    valores: (usuarioId) => ({ status: 'enviado', enviadoEm: new Date(), enviadoPor: usuarioId }),
  });
  // Só a versão viva pode ser aprovada: as anteriores são canceladas ao gerar a nova (orcamentos_uma_versao_viva).
  transicao('/:id/aprovar', aprovar, {
    de: ['emitido', 'enviado'],
    acao: 'aprovar',
    evento: 'aprovado',
    valores: (usuarioId) => ({ status: 'aprovado', aprovadoEm: new Date(), aprovadoPor: usuarioId }),
  });
  transicao('/:id/recusar', aprovar, {
    de: ['emitido', 'enviado'],
    acao: 'recusar',
    evento: 'recusado',
    valores: (usuarioId, motivo) => ({
      status: 'recusado',
      recusadoEm: new Date(),
      recusadoPor: usuarioId,
      motivoRecusa: motivo,
    }),
    detalhe: (motivo) => motivo ?? undefined,
  });
  transicao('/:id/cancelar', editar, {
    de: ['rascunho', 'aguardando_aprovacao_comercial', 'reprovado_comercialmente', 'emitido', 'enviado'],
    acao: 'cancelar',
    evento: 'cancelado',
    valores: (usuarioId, motivo) => ({
      status: 'cancelado',
      canceladoEm: new Date(),
      canceladoPor: usuarioId,
      motivoCancelamento: motivo,
    }),
    detalhe: (motivo) => motivo ?? undefined,
    depois: async (tx, atual, usuarioId) => {
      const pendente = await pendenteDoDocumento(tx, 'orcamento', atual.id);
      if (pendente) await cancelarAprovacao(tx, pendente, usuarioId, 'Orçamento cancelado.');
    },
  });

  /**
   * Retira o pedido de aprovação comercial: só quem pediu. O orçamento volta a rascunho para corrigir o desconto
   * (e, se os preços forem de outro dia, é recalculado ao abrir).
   */
  app.post(
    '/:id/retirar-aprovacao',
    { ...editar, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['aguardando_aprovacao_comercial'], 'retirar o pedido de aprovação');
        const pendente = await pendenteDoDocumento(tx, 'orcamento', atual.id);
        if (!pendente) throw new ErroHttp(409, 'Não há pedido de aprovação pendente. Recarregue a página.');
        if (pendente.solicitanteId !== req.user.sub)
          throw new ErroHttp(403, 'Só quem pediu a aprovação comercial pode retirá-la.');
        await cancelarAprovacao(tx, pendente, req.user.sub, 'Pedido retirado pelo solicitante.');
        await tx
          .update(orcamentos)
          .set({ status: 'rascunho', atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'aprovacao_comercial_retirada', req.user.sub, 'Voltou a rascunho.');
        return carregar(tx, atual.id, req.user.vendedorId);
      }),
  );

  /**
   * Conversão do orçamento aprovado em O.S. (docs/modulos/ORCAMENTOS.md §6): só o Administrador (qualquer orçamento)
   * e o vendedor (só os próprios). A regra toda fica em `converterEmOs`.
   */
  app.post(
    '/:id/converter',
    {
      ...editar,
      schema: {
        params: idParamSchema,
        body: conversaoOrcamentoInputSchema,
        response: { 201: conversaoOrcamentoSchema },
      },
    },
    async (req, reply) => {
      const ordemServicoId = await withTenant(req.user.tid, (tx) =>
        converterEmOs(tx, req.params.id, req.body, req.user),
      );
      return reply.code(201).send({ destino: 'ordem_servico' as const, ordemServicoId });
    },
  );

  /**
   * Nova versão de um orçamento emitido, enviado ou reprovado comercialmente: outro registro, mesmo número, versão + 1, ligado ao anterior,
   * que é cancelado na mesma transação. Nasce rascunho com os mesmos itens e preços (recalculados ao abrir, se de
   * outro dia) e validade em branco.
   */
  app.post(
    '/:id/nova-versao',
    {
      ...editar,
      schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: { 201: orcamentoSchema } },
    },
    async (req, reply) => {
      const nova = await withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['emitido', 'enviado', 'reprovado_comercialmente'], 'gerar uma nova versão');
        const proxima = atual.versaoOrcamento + 1;
        await tx
          .update(orcamentos)
          .set({
            status: 'cancelado',
            canceladoEm: new Date(),
            canceladoPor: req.user.sub,
            motivoCancelamento: `Substituído pela versão ${proxima}.`,
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'cancelado', req.user.sub, `Substituído pela versão ${proxima}.`);

        const [{ id }] = (await tx
          .insert(orcamentos)
          .values({
            numero: atual.numero,
            versaoOrcamento: proxima,
            orcamentoOrigemId: atual.id,
            clienteId: atual.clienteId,
            veiculoId: atual.veiculoId,
            vendedorId: atual.vendedorId,
            tabelaPrecoId: atual.tabelaPrecoId,
            precosEm: atual.precosEm,
            observacoes: atual.observacoes,
            subtotalCentavos: atual.subtotalCentavos,
            descontoCentavos: atual.descontoCentavos,
            totalCentavos: atual.totalCentavos,
            criadoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .returning({ id: orcamentos.id })) as [{ id: string }];
        const itens = await itensDoOrcamento(tx, atual.id);
        await gravarItens(
          tx,
          id,
          itens.map(({ tenantId: _t, orcamentoId: _o, id: _id, ...i }) => ({ ...i, id: randomUUID() })),
        );
        await registrar(
          tx,
          id,
          'nova_versao',
          req.user.sub,
          `Gerada a partir da versão ${atual.versaoOrcamento} (${formatarNumeroOrcamento(atual.numero)}).`,
        );
        return carregar(tx, id, req.user.vendedorId);
      });
      return reply.code(201).send(nova);
    },
  );
};
