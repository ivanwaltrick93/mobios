import {
  hojeIso,
  relatorioFiltroSchema,
  relatorioIdSchema,
  type RelatorioDescricao,
  type RelatorioId,
} from '@mobios/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { gerarCsv } from '../../lib/csv.js';
import { ErroHttp } from '../../lib/erros.js';
import { relatorios } from './definicoes.js';

const LIMITE_PREVIA = 50;
// A exportação é montada em memória: acima disso, o usuário deve reduzir o período.
const LIMITE_EXPORTACAO = 50_000;

const paramsSchema = z.object({ id: relatorioIdSchema });

export const relatoriosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('relatorios'));

  const permitido = (id: RelatorioId, admin: boolean) => !relatorios[id].somenteAdmin || admin;
  const definicaoPermitida = (id: RelatorioId, admin: boolean) => {
    if (!permitido(id, admin)) throw new ErroHttp(403, 'Você não tem permissão para este relatório.');
    return relatorios[id];
  };

  /** Relatórios que o usuário logado pode extrair. */
  app.get('/', async (req): Promise<RelatorioDescricao[]> =>
    Object.values(relatorios)
      .filter((r) => permitido(r.id, req.user.admin))
      .map(({ id, titulo, descricao, colunas }) => ({ id, titulo, descricao, colunas })),
  );

  app.get('/:id', { schema: { params: paramsSchema, querystring: relatorioFiltroSchema } }, async (req) => {
    const def = definicaoPermitida(req.params.id, req.user.admin);
    const { linhas, total } = await withTenant(req.user.tid, (tx) => def.consultar(tx, req.query, LIMITE_PREVIA));
    return { colunas: def.colunas, linhas, total };
  });

  app.get('/:id/csv', { schema: { params: paramsSchema, querystring: relatorioFiltroSchema } }, async (req, reply) => {
    const def = definicaoPermitida(req.params.id, req.user.admin);
    const { linhas, total } = await withTenant(req.user.tid, (tx) =>
      def.consultar(tx, req.query, LIMITE_EXPORTACAO + 1),
    );
    if (total > LIMITE_EXPORTACAO) {
      throw new ErroHttp(
        400,
        `O relatório tem ${total.toLocaleString('pt-BR')} linhas. Reduza o período (máximo ${LIMITE_EXPORTACAO.toLocaleString('pt-BR')}).`,
      );
    }
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${def.id}-${hojeIso()}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(gerarCsv(def.colunas, linhas));
  });
};
