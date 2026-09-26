import {
  atendimentoSolicitacaoSchema,
  formatarQuantidade,
  mecanicosDoServicoInputSchema,
  ordemServicoSchema,
  recusaSolicitacaoSchema,
  SITUACOES_OS_EM_ABERTO,
  SITUACOES_OS_EXECUCAO,
  solicitacaoPecaInputSchema,
} from '@mobios/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { ordensServico, osItemMecanicos, osItens, osMecanicos, osSolicitacoesPeca, users } from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { carregarOs, exigirSituacaoOs, exigirVersaoLidaOs, travarOs, type Usuario } from './consulta.js';
import { ehMecanico, exigirAlterar, podeProdutosOs, registrarOs, type OsGravada } from './regras.js';

// Execução da O.S. (onda 5.3; docs/modulos/ORDENS_SERVICO.md §11): confirmação de execução por serviço, mecânicos
// por serviço e solicitação de peça pelo mecânico. A aprovação comercial pendente (desconto) não trava a execução.

const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const solicitacaoParams = z.object({ id: z.uuid(), solicitacaoId: z.uuid() });
const versaoSchema = z.object({ versao: z.number().int().min(1) });

/** Nova versão da O.S. (concorrência otimista) depois de uma alteração em tabela filha. */
const tocarOs = (tx: Tx, os: OsGravada, usuarioId: string) =>
  tx
    .update(ordensServico)
    .set({ atualizadoPor: usuarioId, versao: os.versao + 1 })
    .where(eq(ordensServico.id, os.id));

/** Serviço da O.S., travado até o fim da transação. */
async function travarServico(tx: Tx, os: OsGravada, itemId: string) {
  const [item] = await tx
    .select()
    .from(osItens)
    .where(and(eq(osItens.id, itemId), eq(osItens.ordemServicoId, os.id)))
    .for('update');
  if (!item) throw naoEncontrado('Item da O.S.');
  if (item.tipo !== 'servico') throw new ErroHttp(400, 'Execução e mecânicos valem só para serviços.');
  return item;
}

/** Trava a O.S. e confere quem altera, a versão lida e a situação. */
async function prepararAlteracao(tx: Tx, id: string, u: Usuario, versao: number, situacoes = SITUACOES_OS_EM_ABERTO) {
  const os = await travarOs(tx, id, u);
  exigirAlterar(u, os);
  exigirVersaoLidaOs(os, versao);
  exigirSituacaoOs(os, situacoes, 'fazer esta alteração');
  return os;
}

export const execucaoOsRoutes: FastifyPluginAsyncZod = async (app) => {
  const resposta = { 200: ordemServicoSchema };

  /** Confirma a execução do serviço (OS-22): quem e quando. Só serviço aprovado, com a O.S. em execução. */
  app.post(
    '/:id/itens/:itemId/executar',
    { schema: { params: itemParams, body: versaoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const os = await prepararAlteracao(tx, req.params.id, req.user, req.body.versao, SITUACOES_OS_EXECUCAO);
        const item = await travarServico(tx, os, req.params.itemId);
        if (item.aprovacao !== 'aprovado') throw new ErroHttp(409, 'Este serviço ainda não foi aprovado pelo cliente.');
        if (item.executadoEm) throw new ErroHttp(409, 'Este serviço já foi confirmado como executado.');
        await tx
          .update(osItens)
          .set({ executadoEm: new Date(), executadoPor: req.user.sub })
          .where(eq(osItens.id, item.id));
        await tocarOs(tx, os, req.user.sub);
        await registrarOs(tx, os.id, 'servico_executado', req.user.sub, { detalhe: item.descricao });
        return carregarOs(tx, os.id, req.user);
      }),
  );

  /** Desfaz a confirmação (engano ou retrabalho), com registro no histórico. */
  app.post(
    '/:id/itens/:itemId/desfazer-execucao',
    { schema: { params: itemParams, body: versaoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const os = await prepararAlteracao(tx, req.params.id, req.user, req.body.versao, SITUACOES_OS_EXECUCAO);
        const item = await travarServico(tx, os, req.params.itemId);
        if (!item.executadoEm) throw new ErroHttp(409, 'Este serviço não está confirmado como executado.');
        await tx.update(osItens).set({ executadoEm: null, executadoPor: null }).where(eq(osItens.id, item.id));
        await tocarOs(tx, os, req.user.sub);
        await registrarOs(tx, os.id, 'execucao_desfeita', req.user.sub, { detalhe: item.descricao });
        return carregarOs(tx, os.id, req.user);
      }),
  );

  /**
   * Mecânicos do serviço (OS-10): substitui a lista. Só usuários ativos com função de mecânico; quem ainda não está
   * vinculado à O.S. passa a estar (e então a vê).
   */
  app.put(
    '/:id/itens/:itemId/mecanicos',
    { schema: { params: itemParams, body: mecanicosDoServicoInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const os = await prepararAlteracao(tx, req.params.id, req.user, req.body.versao);
        const item = await travarServico(tx, os, req.params.itemId);
        const ids = [...new Set(req.body.usuarioIds)];
        const mecanicos = ids.length
          ? await tx
              .select({ id: users.id, nome: users.nome })
              .from(users)
              .where(and(inArray(users.id, ids), eq(users.ativo, true), ehMecanico))
              .orderBy(asc(users.nome))
          : [];
        if (mecanicos.length !== ids.length)
          throw new ErroHttp(400, 'Escolha só usuários ativos com uma função de mecânico.', {
            usuarioIds: 'Não é mecânico',
          });

        const vinculados = new Set(
          (
            await tx
              .select({ usuarioId: osMecanicos.usuarioId })
              .from(osMecanicos)
              .where(eq(osMecanicos.ordemServicoId, os.id))
          ).map((m) => m.usuarioId),
        );
        for (const m of mecanicos.filter((x) => !vinculados.has(x.id))) {
          await tx.insert(osMecanicos).values({ ordemServicoId: os.id, usuarioId: m.id });
          await registrarOs(tx, os.id, 'mecanico_vinculado', req.user.sub, { detalhe: m.nome });
        }
        await tx.delete(osItemMecanicos).where(eq(osItemMecanicos.osItemId, item.id));
        if (mecanicos.length)
          await tx.insert(osItemMecanicos).values(mecanicos.map((m) => ({ osItemId: item.id, usuarioId: m.id })));
        await tocarOs(tx, os, req.user.sub);
        await registrarOs(tx, os.id, 'mecanicos_do_servico', req.user.sub, {
          detalhe: `${item.descricao}: ${mecanicos.map((m) => m.nome).join(', ') || 'nenhum'}`,
        });
        return carregarOs(tx, os.id, req.user);
      }),
  );

  // ---------- Solicitação de peça (OS-21, sem estoque nesta fase) ----------

  /** O mecânico (quem altera a O.S.) pede a peça; quem tem "Peças na O.S." responde. */
  app.post(
    '/:id/solicitacoes-peca',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: solicitacaoPecaInputSchema,
        response: { 201: ordemServicoSchema },
      },
    },
    async (req, reply) => {
      const resultado = await withTenant(req.user.tid, async (tx) => {
        const os = await prepararAlteracao(tx, req.params.id, req.user, req.body.versao);
        const { descricao, quantidade, observacao } = req.body;
        await tx
          .insert(osSolicitacoesPeca)
          .values({ ordemServicoId: os.id, descricao, quantidade, observacao, solicitadaPor: req.user.sub });
        await tocarOs(tx, os, req.user.sub);
        await registrarOs(tx, os.id, 'peca_solicitada', req.user.sub, {
          detalhe: `${formatarQuantidade(quantidade)} × ${descricao}`,
        });
        return carregarOs(tx, os.id, req.user);
      });
      return reply.code(201).send(resultado);
    },
  );

  /** Responde a solicitação pendente: atendida (a peça entra pelos itens da O.S.) ou recusada, com o motivo. */
  const responder = (acao: 'atender' | 'recusar') =>
    app.post(
      `/:id/solicitacoes-peca/:solicitacaoId/${acao}`,
      {
        schema: {
          params: solicitacaoParams,
          body: acao === 'atender' ? atendimentoSolicitacaoSchema : recusaSolicitacaoSchema,
          response: resposta,
        },
      },
      async (req) =>
        withTenant(req.user.tid, async (tx) => {
          const os = await travarOs(tx, req.params.id, req.user);
          if (!podeProdutosOs(req.user))
            throw new ErroHttp(403, 'Responder solicitações de peça exige "Peças na O.S." em Editar.');
          exigirVersaoLidaOs(os, req.body.versao);
          exigirSituacaoOs(os, SITUACOES_OS_EM_ABERTO, 'responder a solicitação');
          const [solicitacao] = await tx
            .select()
            .from(osSolicitacoesPeca)
            .where(
              and(eq(osSolicitacoesPeca.id, req.params.solicitacaoId), eq(osSolicitacoesPeca.ordemServicoId, os.id)),
            )
            .for('update');
          if (!solicitacao) throw naoEncontrado('Solicitação de peça');
          if (solicitacao.status !== 'pendente') throw new ErroHttp(409, 'Esta solicitação já foi respondida.');
          const resposta = req.body.resposta ?? null;
          await tx
            .update(osSolicitacoesPeca)
            .set({
              status: acao === 'atender' ? 'atendida' : 'recusada',
              resolvidaPor: req.user.sub,
              resolvidaEm: new Date(),
              resposta,
            })
            .where(eq(osSolicitacoesPeca.id, solicitacao.id));
          await tocarOs(tx, os, req.user.sub);
          await registrarOs(
            tx,
            os.id,
            acao === 'atender' ? 'solicitacao_atendida' : 'solicitacao_recusada',
            req.user.sub,
            { detalhe: `${solicitacao.descricao}${resposta ? ` — ${resposta}` : ''}` },
          );
          return carregarOs(tx, os.id, req.user);
        }),
    );
  responder('atender');
  responder('recusar');
};
