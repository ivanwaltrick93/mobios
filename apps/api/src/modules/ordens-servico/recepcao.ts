import {
  CATEGORIAS_FOTO_OS,
  checklistOsInputSchema,
  diagnosticoOsInputSchema,
  ESTADOS_CHECKLIST,
  fotoOsQuerySchema,
  idParamSchema,
  MAXIMO_FOTOS_OS,
  NIVEIS_COMBUSTIVEL,
  ordemServicoSchema,
  SITUACOES_OS_EM_ABERTO,
} from '@mobios/shared';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { ordensServico, osChecklist, osFotos } from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { aceitarUploadDeImagem, lerImagemEnviada, responderImagem } from '../../lib/imagem.js';
import { carregarOs, exigirSituacaoOs, exigirVersaoLidaOs, travarOs } from './consulta.js';
import { exigirAlterar, filtroVisiveis, registrarOs } from './regras.js';

// Recepção e diagnóstico da O.S. (onda 5.2; docs/modulos/ORDENS_SERVICO.md §10): checklist de entrada, fotos e
// diagnóstico. Quem altera a O.S. registra, enquanto ela está em aberto; a aprovação comercial pendente não trava.

/** Resumo do checklist para o histórico: quantos itens, o que faltou ou veio avariado e o combustível. */
function resumoDoChecklist(
  itens: { item: string; estado: keyof typeof ESTADOS_CHECKLIST }[],
  combustivel: keyof typeof NIVEIS_COMBUSTIVEL | null,
) {
  const partes = [`${itens.length} item(ns)`];
  for (const estado of ['ausente', 'avariado'] as const) {
    const nomes = itens.filter((i) => i.estado === estado).map((i) => i.item);
    if (nomes.length) partes.push(`${ESTADOS_CHECKLIST[estado].toLowerCase()}: ${nomes.join(', ')}`);
  }
  if (combustivel) partes.push(`combustível ${NIVEIS_COMBUSTIVEL[combustivel]}`);
  return `${partes.join('; ')}.`;
}

/** Diagnóstico no histórico: o começo do texto (o completo fica na O.S.). */
const trechoDoDiagnostico = (texto: string | null) =>
  !texto ? 'Diagnóstico apagado.' : texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;

export const recepcaoOsRoutes: FastifyPluginAsyncZod = async (app) => {
  aceitarUploadDeImagem(app);
  const resposta = { 200: ordemServicoSchema };
  const fotoParams = z.object({ id: z.uuid(), fotoId: z.uuid() });

  /** Checklist de entrada (OS-03): itens com o estado, combustível e avarias; regravado inteiro. */
  app.put(
    '/:id/checklist',
    { schema: { params: idParamSchema, body: checklistOsInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.body.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'registrar o checklist');
        const { itens, combustivel, avariasEntrada } = req.body;
        await tx.delete(osChecklist).where(eq(osChecklist.ordemServicoId, atual.id));
        if (itens.length)
          await tx.insert(osChecklist).values(itens.map((i, n) => ({ ordemServicoId: atual.id, ordem: n + 1, ...i })));
        await tx
          .update(ordensServico)
          .set({
            combustivel,
            avariasEntrada,
            checklistEm: new Date(),
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'checklist_registrado', req.user.sub, {
          detalhe: resumoDoChecklist(itens, combustivel),
        });
        return carregarOs(tx, atual.id, req.user);
      }),
  );

  /** Diagnóstico técnico e observações do mecânico (OS-05). */
  app.put(
    '/:id/diagnostico',
    { schema: { params: idParamSchema, body: diagnosticoOsInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.body.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'registrar o diagnóstico');
        await tx
          .update(ordensServico)
          .set({ diagnostico: req.body.diagnostico, atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'diagnostico_registrado', req.user.sub, {
          detalhe: trechoDoDiagnostico(req.body.diagnostico),
        });
        return carregarOs(tx, atual.id, req.user);
      }),
  );

  /**
   * Foto (OS-04): a imagem vai no corpo (já reduzida no navegador), a categoria e a versão lida na URL. No máximo
   * MAXIMO_FOTOS_OS por O.S., contadas com a O.S. travada (dois envios ao mesmo tempo não passam do limite).
   */
  app.post(
    '/:id/fotos',
    { schema: { params: idParamSchema, querystring: fotoOsQuerySchema, response: { 201: ordemServicoSchema } } },
    async (req, reply) => {
      const imagem = lerImagemEnviada(req.body);
      const os = await withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.query.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'enviar fotos');
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(osFotos)
          .where(eq(osFotos.ordemServicoId, atual.id))) as [{ total: number }];
        if (total >= MAXIMO_FOTOS_OS)
          throw new ErroHttp(409, `A O.S. já tem ${MAXIMO_FOTOS_OS} fotos: remova uma para enviar outra.`);
        await tx.insert(osFotos).values({
          ordemServicoId: atual.id,
          categoria: req.query.categoria,
          conteudo: imagem.conteudo,
          tipo: imagem.tipo,
          tamanho: imagem.tamanho,
          criadoPor: req.user.sub,
        });
        await tx
          .update(ordensServico)
          .set({ atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'foto_adicionada', req.user.sub, {
          detalhe: CATEGORIAS_FOTO_OS[req.query.categoria],
        });
        return carregarOs(tx, atual.id, req.user);
      });
      return reply.code(201).send(os);
    },
  );

  /** A imagem, para quem vê a O.S. (o mecânico, só nas vinculadas). */
  app.get('/:id/fotos/:fotoId', { schema: { params: fotoParams } }, async (req, reply) => {
    const [foto] = await withTenant(req.user.tid, (tx) =>
      tx
        .select({ conteudo: osFotos.conteudo, tipo: osFotos.tipo, atualizadoEm: osFotos.criadoEm })
        .from(osFotos)
        .innerJoin(ordensServico, eq(ordensServico.id, osFotos.ordemServicoId))
        .where(and(eq(osFotos.id, req.params.fotoId), eq(ordensServico.id, req.params.id), filtroVisiveis(req.user))),
    );
    return responderImagem(req, reply, foto, 'Foto não encontrada');
  });

  app.delete(
    '/:id/fotos/:fotoId',
    {
      schema: {
        params: fotoParams,
        querystring: z.object({ versao: z.coerce.number().int().min(1) }),
        response: resposta,
      },
    },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travarOs(tx, req.params.id, req.user);
        exigirAlterar(req.user, atual);
        exigirVersaoLidaOs(atual, req.query.versao);
        exigirSituacaoOs(atual, SITUACOES_OS_EM_ABERTO, 'remover fotos');
        const [removida] = await tx
          .delete(osFotos)
          .where(and(eq(osFotos.id, req.params.fotoId), eq(osFotos.ordemServicoId, atual.id)))
          .returning({ categoria: osFotos.categoria });
        if (!removida) throw naoEncontrado('Foto');
        await tx
          .update(ordensServico)
          .set({ atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(ordensServico.id, atual.id));
        await registrarOs(tx, atual.id, 'foto_removida', req.user.sub, {
          detalhe: CATEGORIAS_FOTO_OS[removida.categoria],
        });
        return carregarOs(tx, atual.id, req.user);
      }),
  );
};
