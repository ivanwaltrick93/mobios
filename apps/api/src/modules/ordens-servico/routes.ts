import {
  aberturaOsInputSchema,
  cabecalhoOsInputSchema,
  cancelamentoOsSchema,
  clienteParaOrcamentoFiltroSchema,
  clienteParaOrcamentoSchema,
  formatarMoeda,
  formatarNumeroOs,
  formatarPercentual,
  idParamSchema,
  itemVendavelQuerySchema,
  itemVendavelSchema,
  itensOsInputSchema,
  mecanicoOsInputSchema,
  mecanicoParaOsSchema,
  normalizarPlaca,
  ordemServicoFiltroSchema,
  ordemServicoResumoSchema,
  ordemServicoSchema,
  osAtrasada,
  SITUACOES_OS_EM_ABERTO,
  SITUACOES_OS_ITENS_EDITAVEIS,
  transicaoOsSchema,
  veiculoParaOrcamentoSchema,
  vendedorParaOrcamentoSchema,
  type EventoOs,
  type SituacaoOs,
} from '@mobios/shared';
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  clientes,
  ordensServico,
  osItemMecanicos,
  osItens,
  osMecanicos,
  osSolicitacoesPeca,
  tabelasPreco,
  users,
  veiculos,
  vendedores,
} from '../../db/schema.js';
import {
  alcadaDoUsuario,
  cancelarAprovacao,
  pendenteDoDocumento,
  solicitarAprovacao,
} from '../../lib/aprovacao-comercial.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import {
  clientesParaEscolhaPorId,
  itensComPrecoDoDia,
  listarClientesParaEscolha,
  veiculosDoCliente,
} from '../orcamentos/apoio.js';
import { snapshotDaOs } from './aprovacao.js';
import { entregaOsRoutes } from './entrega.js';
import { execucaoOsRoutes } from './execucao.js';
import { recepcaoOsRoutes } from './recepcao.js';
import { carregarOs, exigirSemAprovacaoPendente, exigirSituacaoOs, exigirVersaoLidaOs, travarOs } from './consulta.js';
import {
  abrirOs,
  assinaturaDosProdutos,
  descreverDescontosOs,
  ehMecanico,
  exigirExecutadosIntactos,
  exigirAlterar,
  filtroVisiveis,
  gravarItensOs,
  itensAcimaDaAlcada,
  itensDaOs,
  pendenciasDaConclusao,
  montarItensOs,
  percentualDaLinhaOs,
  podeAbrirOs,
  podeProdutosOs,
  podeVerOs,
  previsaoComoInstante,
  registrarOs,
  totaisDaOs,
  validarAbertura,
  type OsGravada,
} from './regras.js';

const FUSO = 'America/Sao_Paulo';
const resumoDoTotal = (itens: number, total: number) => `${itens} item(ns), total ${formatarMoeda(total)}.`;

/** Tabela padrão da oficina (O.S. aberta no balcão). */
async function tabelaPadrao(tx: Tx): Promise<string> {
  const [t] = await tx
    .select({ id: tabelasPreco.id })
    .from(tabelasPreco)
    .where(and(eq(tabelasPreco.padrao, true), eq(tabelasPreco.ativa, true)));
  if (!t)
    throw new ErroHttp(
      400,
      'A oficina ainda não tem tabela de preço padrão. Cadastre uma em Política Comercial → Tabelas de Preço.',
    );
  return t.id;
}

/** Ordens de Serviço (menu Ordens de serviço; docs/modulos/ORDENS_SERVICO.md). */
export const ordensServicoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', async (req) => {
    if (!podeVerOs(req.user)) throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
  });
  const abrir = {
    onRequest: async (req: FastifyRequest) => {
      if (!podeAbrirOs(req.user)) throw new ErroHttp(403, 'Você não tem permissão para abrir O.S.');
    },
  };
  const resposta = { 200: ordemServicoSchema };

  // Checklist, fotos e diagnóstico (onda 5.2); execução, mecânicos por serviço e solicitação de peça (onda 5.3).
  await app.register(recepcaoOsRoutes);
  await app.register(execucaoOsRoutes);
  // Entrega e PDF (onda 5.4).
  await app.register(entregaOsRoutes);

  /** Lista: número (com ou sem "OS-"), nome do cliente ou placa; filtros; o mecânico só vê as dele. */
  app.get(
    '/',
    {
      schema: {
        querystring: ordemServicoFiltroSchema,
        response: { 200: z.object({ itens: z.array(ordemServicoResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, situacao, clienteId, veiculoId, vendedorId, mecanicoId, abertas, atrasadas, pecaPendente } = req.query;
      const { desde, ate } = req.query;
      const { pagina, porPagina } = req.query;
      const numero = q?.replace(/^os-?/i, '').replace(/^0+(?=\d)/, '');
      const onde = and(
        filtroVisiveis(req.user),
        // Número, nome do cliente ou placa, pela função busca_ordens_servico (migração 0030; DATABASE.md §3).
        q
          ? sql`${ordensServico.id} in (select busca_ordens_servico(
              ${numero && /^\d{1,9}$/.test(numero) ? Number(numero) : null}::integer, ${`%${q}%`}::text,
              ${normalizarPlaca(q)}::text))`
          : undefined,
        situacao ? eq(ordensServico.status, situacao) : undefined,
        clienteId ? eq(ordensServico.clienteId, clienteId) : undefined,
        veiculoId ? eq(ordensServico.veiculoId, veiculoId) : undefined,
        vendedorId ? eq(ordensServico.vendedorId, vendedorId) : undefined,
        mecanicoId
          ? sql`exists (select 1 from os_mecanicos m where m.ordem_servico_id = ${ordensServico.id}
              and m.usuario_id = ${mecanicoId})`
          : undefined,
        abertas || atrasadas ? inArray(ordensServico.status, SITUACOES_OS_EM_ABERTO) : undefined,
        atrasadas ? lt(ordensServico.previsaoEntrega, sql`now()`) : undefined,
        pecaPendente
          ? sql`exists (select 1 from os_solicitacoes_peca s where s.ordem_servico_id = ${ordensServico.id}
              and s.status = 'pendente')`
          : undefined,
        desde ? gte(ordensServico.criadoEm, sql`${desde}::date::timestamp at time zone ${FUSO}`) : undefined,
        ate ? lt(ordensServico.criadoEm, sql`(${ate}::date + 1)::timestamp at time zone ${FUSO}`) : undefined,
      );
      return withTenant(req.user.tid, async (tx) => {
        // Pagina os ids e junta cliente, veículo e vendedor só nas linhas da página (DATABASE.md §2, regra 5).
        const ordem = [desc(ordensServico.criadoEm), desc(ordensServico.numero)];
        const daPagina = tx
          .select({ id: ordensServico.id })
          .from(ordensServico)
          .where(onde)
          .orderBy(...ordem)
          .limit(porPagina)
          .offset((pagina - 1) * porPagina)
          .as('da_pagina');
        const itens = await tx
          .select({
            id: ordensServico.id,
            numero: ordensServico.numero,
            situacao: ordensServico.status,
            clienteNome: clientes.nome,
            veiculoPlaca: veiculos.placa,
            vendedorNome: users.nome,
            mecanicos: sql<string[]>`(select coalesce(array_agg(u.nome order by u.nome), '{}') from os_mecanicos m
              join users u on u.id = m.usuario_id where m.ordem_servico_id = "ordens_servico"."id")`,
            previsaoEntrega: ordensServico.previsaoEntrega,
            totalCentavos: ordensServico.totalCentavos,
            abertaEm: ordensServico.criadoEm,
            pecasSolicitadas: sql<number>`(select count(*) from os_solicitacoes_peca s
              where s.ordem_servico_id = "ordens_servico"."id" and s.status = 'pendente')`.mapWith(Number),
          })
          .from(ordensServico)
          .innerJoin(daPagina, eq(daPagina.id, ordensServico.id))
          .innerJoin(clientes, eq(clientes.id, ordensServico.clienteId))
          .innerJoin(veiculos, eq(veiculos.id, ordensServico.veiculoId))
          .leftJoin(vendedores, eq(vendedores.id, ordensServico.vendedorId))
          .leftJoin(users, eq(users.id, vendedores.usuarioId))
          .orderBy(...ordem);
        const [{ total }] = (await tx.select({ total: count() }).from(ordensServico).where(onde)) as [
          { total: number },
        ];
        const agora = new Date();
        return {
          itens: itens.map((o) => ({ ...o, atrasada: osAtrasada(o.situacao, o.previsaoEntrega, agora) })),
          total,
        };
      });
    },
  );

  // ---------- Apoio à tela (sem depender dos módulos Clientes, Preços ou da Equipe) ----------

  app.get(
    '/apoio/clientes',
    {
      ...abrir,
      schema: {
        querystring: clienteParaOrcamentoFiltroSchema,
        response: { 200: z.object({ itens: z.array(clienteParaOrcamentoSchema), total: z.number() }) },
      },
    },
    async (req) => withTenant(req.user.tid, (tx) => listarClientesParaEscolha(tx, req.query)),
  );

  /** Clientes das últimas O.S. abertas (até 5, sem repetir), para a janela de escolha sem busca. */
  app.get(
    '/apoio/clientes/recentes',
    { ...abrir, schema: { response: { 200: z.array(clienteParaOrcamentoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const ultimos = await tx
          .select({ clienteId: ordensServico.clienteId })
          .from(ordensServico)
          .groupBy(ordensServico.clienteId)
          .orderBy(desc(sql`max(${ordensServico.criadoEm})`))
          .limit(5);
        return clientesParaEscolhaPorId(
          tx,
          ultimos.map((u) => u.clienteId),
        );
      }),
  );

  app.get(
    '/apoio/clientes/:id/veiculos',
    { ...abrir, schema: { params: idParamSchema, response: { 200: z.array(veiculoParaOrcamentoSchema) } } },
    async (req) => withTenant(req.user.tid, (tx) => veiculosDoCliente(tx, req.params.id)),
  );

  /** Vendedores ativos (o vendedor da O.S. é opcional). */
  app.get('/apoio/vendedores', { schema: { response: { 200: z.array(vendedorParaOrcamentoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) =>
      tx
        .select({ id: vendedores.id, codigo: vendedores.codigo, nome: users.nome, ativo: vendedores.ativo })
        .from(vendedores)
        .innerJoin(users, eq(users.id, vendedores.usuarioId))
        .where(eq(vendedores.ativo, true))
        .orderBy(asc(users.nome)),
    ),
  );

  app.get('/apoio/mecanicos', { schema: { response: { 200: z.array(mecanicoParaOsSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) =>
      tx
        .select({ id: users.id, nome: users.nome })
        .from(users)
        .where(and(eq(users.ativo, true), ehMecanico))
        .orderBy(asc(users.nome)),
    ),
  );

  /** Produtos com "Permite uso em O.S." e serviços, com o preço de hoje na tabela da O.S. */
  app.get(
    '/apoio/itens',
    { schema: { querystring: itemVendavelQuerySchema, response: { 200: z.array(itemVendavelSchema) } } },
    async (req) => withTenant(req.user.tid, (tx) => itensComPrecoDoDia(tx, req.query, 'os')),
  );

  // ---------- O.S. ----------

  app.get('/:id', { schema: { params: idParamSchema, response: resposta } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregarOs(tx, req.params.id, req.user)),
  );

  /** Abertura no balcão (OS-02): tabela padrão da oficina; o número vem do contador, na mesma transação. */
  app.post(
    '/',
    { ...abrir, schema: { body: aberturaOsInputSchema, response: { 201: ordemServicoSchema } } },
    async (req, reply) => {
      const os = await withTenant(req.user.tid, async (tx) => {
        await validarAbertura(tx, req.body);
        const id = await abrirOs(
          tx,
          { ...req.body, orcamentoId: null, tabelaPrecoId: await tabelaPadrao(tx) },
          req.user.sub,
          `Km de entrada ${req.body.kmEntrada.toLocaleString('pt-BR')}.`,
        );
        return carregarOs(tx, id, req.user);
      });
      return reply.code(201).send(os);
    },
  );

  /** Cabeçalho: relato, observações, vendedor e previsão (cliente, veículo e km de entrada não mudam). */
  app.put(
    '/:id',
    { schema: { params: idParamSchema, body: cabecalhoOsInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.body.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'alterar');
        if (req.body.vendedorId && req.body.vendedorId !== atual.vendedorId) {
          const [v] = await tx
            .select({ ativo: vendedores.ativo })
            .from(vendedores)
            .where(eq(vendedores.id, req.body.vendedorId));
          if (!v?.ativo)
            throw new ErroHttp(400, 'Escolha um vendedor ativo.', { vendedorId: 'Escolha um vendedor ativo' });
        }
        await tx
          .update(ordensServico)
          .set({
            relatoCliente: req.body.relatoCliente,
            observacoes: req.body.observacoes,
            vendedorId: req.body.vendedorId,
            previsaoEntrega: previsaoComoInstante(req.body.previsaoEntrega),
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'dados_alterados', req.user.sub, {
          detalhe: 'Relato, observações, vendedor ou previsão de entrega.',
        });
        return carregarOs(tx, atual.id, req.user);
      }),
  );

  /**
   * Itens (catálogo e avulsos), com a versão lida. Desconto que mudou e passou da alçada de quem salva: os itens são
   * gravados e a O.S. fica aguardando a aprovação comercial (tipo O.S.), parada até a decisão (ORDENS_SERVICO §5).
   */
  app.put(
    '/:id/itens',
    { schema: { params: idParamSchema, body: itensOsInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.body.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_ITENS_EDITAVEIS, 'alterar os itens');
        await exigirSemAprovacaoPendente(tx, atual.id);
        const gravados = await itensDaOs(tx, atual.id);
        const { linhas, avisos } = await montarItensOs(tx, req.body.itens, gravados, atual);
        exigirExecutadosIntactos(gravados, linhas);
        if (!podeProdutosOs(req.user) && assinaturaDosProdutos(gravados) !== assinaturaDosProdutos(linhas))
          throw new ErroHttp(403, 'Incluir, alterar ou remover produtos na O.S. exige "Peças na O.S." em Editar.');
        await gravarItensOs(tx, atual.id, linhas);
        const totais = totaisDaOs(linhas);
        await tx
          .update(ordensServico)
          .set({ ...totais, atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'itens_alterados', req.user.sub, {
          detalhe: resumoDoTotal(linhas.length, totais.totalCentavos),
        });
        const descontos = descreverDescontosOs(gravados, linhas);
        if (descontos) await registrarOs(tx, atual.id, 'descontos_alterados', req.user.sub, { detalhe: descontos });

        const alcada = await alcadaDoUsuario(tx, req.user.sub);
        const acima = itensAcimaDaAlcada(gravados, linhas, alcada.percentual);
        if (acima.length) {
          const os = await carregarOs(tx, atual.id, req.user);
          const percentual = Math.max(...acima.map(percentualDaLinhaOs));
          await solicitarAprovacao(tx, {
            tipoDocumento: 'ordem_servico',
            documentoId: atual.id,
            documentoNumero: formatarNumeroOs(atual.numero),
            documentoVersao: 1,
            clienteNome: os.cliente.nome,
            subtotalCentavos: totais.subtotalServicosCentavos + totais.subtotalMateriaisCentavos,
            descontoCentavos: totais.descontoCentavos,
            totalCentavos: totais.totalCentavos,
            percentual,
            solicitanteId: req.user.sub,
            alcada,
            snapshot: snapshotDaOs(os, await itensDaOs(tx, atual.id), new Set(acima.map((l) => l.id))),
          });
          await registrarOs(tx, atual.id, 'aprovacao_comercial_solicitada', req.user.sub, {
            detalhe:
              `${acima.length} item(ns): desconto de até ${formatarPercentual(percentual)}, acima da alçada de ` +
              `${formatarPercentual(alcada.percentual)}${alcada.funcao ? ` (${alcada.funcao})` : ''}.`,
          });
        }
        return carregarOs(tx, atual.id, req.user, avisos);
      }),
  );

  /** Mudança de situação: trava, permissão, versão lida, situação de origem, regra própria e histórico. */
  const acao = <S extends z.ZodType<{ versao: number; motivo?: string | null }>>(
    rota: string,
    regra: {
      de: SituacaoOs[];
      para: SituacaoOs;
      acao: string;
      evento: EventoOs;
      schema?: S;
      /** Com aprovação comercial pendente, só o cancelamento anda. */
      mesmoComAprovacaoPendente?: boolean;
      conferir?: (tx: Tx, os: OsGravada) => Promise<void>;
      valores?: (usuarioId: string, motivo: string | null) => Partial<typeof ordensServico.$inferInsert>;
      detalhe?: (motivo: string | null) => string | null;
      depois?: (tx: Tx, os: OsGravada, usuarioId: string) => Promise<void>;
    },
  ) =>
    app.post(
      rota,
      { schema: { params: idParamSchema, body: regra.schema ?? transicaoOsSchema, response: resposta } },
      async (req) =>
        withTenant(req.user.tid, async (tx) => {
          const corpo = req.body as { versao: number; motivo?: string | null };
          const atual = await travarOs(tx, req.params.id, req.user);
          exigirAlterar(req.user, atual);
          exigirVersaoLidaOs(atual, corpo.versao);
          exigirSituacaoOs(atual, regra.de, regra.acao);
          if (!regra.mesmoComAprovacaoPendente) await exigirSemAprovacaoPendente(tx, atual.id);
          await regra.conferir?.(tx, atual);
          const motivo = corpo.motivo ?? null;
          await tx
            .update(ordensServico)
            .set({
              ...regra.valores?.(req.user.sub, motivo),
              status: regra.para,
              atualizadoPor: req.user.sub,
              versao: atual.versao + 1,
            })
            .where(eq(ordensServico.id, atual.id));
          await registrarOs(tx, atual.id, regra.evento, req.user.sub, {
            detalhe: regra.detalhe?.(motivo) ?? null,
            de: atual.status,
            para: regra.para,
          });
          await regra.depois?.(tx, atual, req.user.sub);
          return carregarOs(tx, atual.id, req.user);
        }),
    );

  const contarItens = async (tx: Tx, id: string) => {
    const [linha] = await tx
      .select({
        total: count(),
        pendentes: sql<number>`count(*) filter (where ${osItens.aprovacao} = 'pendente')`.mapWith(Number),
      })
      .from(osItens)
      .where(eq(osItens.ordemServicoId, id));
    return linha!;
  };

  acao('/:id/iniciar-diagnostico', {
    de: ['aberta'],
    para: 'em_diagnostico',
    acao: 'iniciar o diagnóstico',
    evento: 'diagnostico_iniciado',
  });
  acao('/:id/solicitar-aprovacao', {
    de: ['aberta', 'em_diagnostico'],
    para: 'aguardando_aprovacao',
    acao: 'solicitar a aprovação do cliente',
    evento: 'aprovacao_solicitada',
    async conferir(tx, os) {
      if (!(await contarItens(tx, os.id)).pendentes)
        throw new ErroHttp(409, 'Não há itens pendentes de aprovação do cliente.');
    },
  });
  // Aprovação total (decisão de 26/09/2026): todos os itens pendentes ficam aprovados.
  acao('/:id/aprovar', {
    de: ['aguardando_aprovacao'],
    para: 'aprovada',
    acao: 'aprovar',
    evento: 'aprovada',
    valores: (usuarioId) => ({ aprovadaEm: new Date(), aprovadaPor: usuarioId }),
    async depois(tx, os) {
      await tx
        .update(osItens)
        .set({ aprovacao: 'aprovado' })
        .where(and(eq(osItens.ordemServicoId, os.id), eq(osItens.aprovacao, 'pendente')));
    },
  });
  acao('/:id/recusar', {
    de: ['aguardando_aprovacao'],
    para: 'recusada',
    acao: 'recusar',
    evento: 'recusada',
    valores: (usuarioId, motivo) => ({ recusadaEm: new Date(), recusadaPor: usuarioId, motivoRecusa: motivo }),
    detalhe: (motivo) => motivo,
  });
  acao('/:id/iniciar-execucao', {
    de: ['aberta', 'em_diagnostico', 'aprovada'],
    para: 'em_execucao',
    acao: 'iniciar a execução',
    evento: 'execucao_iniciada',
    async conferir(tx, os) {
      const { total, pendentes } = await contarItens(tx, os.id);
      if (!total) throw new ErroHttp(400, 'Inclua ao menos um serviço ou produto antes de iniciar a execução.');
      if (pendentes)
        throw new ErroHttp(409, 'Há itens pendentes de aprovação do cliente: solicite a aprovação antes de executar.');
    },
  });
  acao('/:id/aguardar-peca', {
    de: ['em_execucao'],
    para: 'aguardando_peca',
    acao: 'marcar como aguardando peça',
    evento: 'aguardando_peca',
    detalhe: (motivo) => motivo,
  });
  acao('/:id/retomar', {
    de: ['aguardando_peca'],
    para: 'em_execucao',
    acao: 'retomar a execução',
    evento: 'execucao_retomada',
  });
  // Conclusão (OS-R11): as mesmas pendências que a tela mostra (pendenciasConclusao).
  acao('/:id/concluir', {
    de: ['em_execucao'],
    para: 'concluida',
    acao: 'concluir',
    evento: 'concluida',
    async conferir(tx, os) {
      const [{ pendentes }] = (await tx
        .select({ pendentes: count() })
        .from(osSolicitacoesPeca)
        .where(and(eq(osSolicitacoesPeca.ordemServicoId, os.id), eq(osSolicitacoesPeca.status, 'pendente')))) as [
        { pendentes: number },
      ];
      const pendencias = pendenciasDaConclusao(await itensDaOs(tx, os.id), pendentes);
      if (pendencias.length) throw new ErroHttp(409, `Não é possível concluir: ${pendencias.join(' ')}`);
    },
    valores: (usuarioId) => ({ concluidaEm: new Date(), concluidaPor: usuarioId }),
  });
  acao('/:id/cancelar', {
    de: SITUACOES_OS_EM_ABERTO,
    para: 'cancelada',
    acao: 'cancelar',
    evento: 'cancelada',
    schema: cancelamentoOsSchema,
    mesmoComAprovacaoPendente: true,
    valores: (usuarioId, motivo) => ({ canceladaEm: new Date(), canceladaPor: usuarioId, motivoCancelamento: motivo }),
    detalhe: (motivo) => motivo,
    async depois(tx, os, usuarioId) {
      const pendente = await pendenteDoDocumento(tx, 'ordem_servico', os.id);
      if (pendente) await cancelarAprovacao(tx, pendente, usuarioId, 'O.S. cancelada.');
    },
  });

  // ---------- Mecânicos ----------

  app.post(
    '/:id/mecanicos',
    { schema: { params: idParamSchema, body: mecanicoOsInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.body.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'vincular mecânicos');
        const [mecanico] = await tx
          .select({ nome: users.nome })
          .from(users)
          .where(and(eq(users.id, req.body.usuarioId), eq(users.ativo, true), ehMecanico));
        if (!mecanico)
          throw new ErroHttp(400, 'Escolha um usuário ativo com uma função de mecânico.', {
            usuarioId: 'Não é mecânico',
          });
        const [ja] = await tx
          .select({ usuarioId: osMecanicos.usuarioId })
          .from(osMecanicos)
          .where(and(eq(osMecanicos.ordemServicoId, atual.id), eq(osMecanicos.usuarioId, req.body.usuarioId)));
        if (ja) throw new ErroHttp(409, `${mecanico.nome} já está vinculado a esta O.S.`);
        await tx.insert(osMecanicos).values({ ordemServicoId: atual.id, usuarioId: req.body.usuarioId });
        await tx
          .update(ordensServico)
          .set({ atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'mecanico_vinculado', req.user.sub, { detalhe: mecanico.nome });
        return carregarOs(tx, atual.id, req.user);
      }),
  );

  app.delete(
    '/:id/mecanicos/:usuarioId',
    {
      schema: {
        params: z.object({ id: z.uuid(), usuarioId: z.uuid() }),
        querystring: z.object({ versao: z.coerce.number().int().min(1) }),
        response: resposta,
      },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.query.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'desvincular mecânicos');
        const [removido] = await tx
          .delete(osMecanicos)
          .where(and(eq(osMecanicos.ordemServicoId, atual.id), eq(osMecanicos.usuarioId, req.params.usuarioId)))
          .returning({ usuarioId: osMecanicos.usuarioId });
        if (!removido) throw naoEncontrado('Mecânico vinculado');
        // Fora da O.S., fora dos serviços dela.
        await tx
          .delete(osItemMecanicos)
          .where(
            and(
              eq(osItemMecanicos.usuarioId, req.params.usuarioId),
              inArray(
                osItemMecanicos.osItemId,
                tx.select({ id: osItens.id }).from(osItens).where(eq(osItens.ordemServicoId, atual.id)),
              ),
            ),
          );
        const [u] = await tx.select({ nome: users.nome }).from(users).where(eq(users.id, req.params.usuarioId));
        await tx
          .update(ordensServico)
          .set({ atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'mecanico_desvinculado', req.user.sub, { detalhe: u?.nome ?? null });
        return carregarOs(tx, atual.id, req.user);
      }),
  );
};
