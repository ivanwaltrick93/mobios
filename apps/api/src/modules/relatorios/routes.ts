import {
  hojeIso,
  relatorioDescricaoSchema,
  relatorioFiltroSchema,
  relatorioIdSchema,
  relatorioPreviaSchema,
  temAcesso,
  type RelatorioId,
} from '@mobios/shared';
import type { FastifyRequest } from 'fastify';
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

  /** Relatório com dados de outro módulo (ex.: clientes) exige também consultar esse módulo. */
  const permitido = (id: RelatorioId, usuario: FastifyRequest['user']) => {
    const { somenteAdmin, modulo } = relatorios[id];
    return (!somenteAdmin || usuario.admin) && (!modulo || temAcesso(usuario.acessos, modulo));
  };
  const definicaoPermitida = (id: RelatorioId, usuario: FastifyRequest['user']) => {
    if (!permitido(id, usuario)) throw new ErroHttp(403, 'Você não tem permissão para este relatório.');
    return relatorios[id];
  };

  /** Relatórios que o usuário logado pode extrair. */
  app.get('/', { schema: { response: { 200: z.array(relatorioDescricaoSchema) } } }, async (req) =>
    Object.values(relatorios)
      .filter((r) => permitido(r.id, req.user))
      .map(({ id, titulo, descricao, colunas }) => ({ id, titulo, descricao, colunas })),
  );

  app.get(
    '/:id',
    { schema: { params: paramsSchema, querystring: relatorioFiltroSchema, response: { 200: relatorioPreviaSchema } } },
    async (req) => {
      const def = definicaoPermitida(req.params.id, req.user);
      const { linhas, total } = await withTenant(req.user.tid, (tx) => def.consultar(tx, req.query, LIMITE_PREVIA));
      return { colunas: def.colunas, linhas, total };
    },
  );

  app.get('/:id/csv', { schema: { params: paramsSchema, querystring: relatorioFiltroSchema } }, async (req, reply) => {
    const def = definicaoPermitida(req.params.id, req.user);
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
