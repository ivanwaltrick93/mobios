import {
  alcadaEventoSchema,
  alcadaInputSchema,
  alcadaSchema,
  idParamSchema,
  minhaAlcadaSchema,
  type Alcada,
} from '@mobios/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { alcadasDesconto, alcadasDescontoEventos, funcoes, users } from '../../db/schema.js';
import { alcadaDoUsuario } from '../../lib/aprovacao-comercial.js';
import { nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

/** Todas as funções com a alçada (sem linha = 0%, nunca configurada). */
async function listar(tx: Tx, funcaoId?: string): Promise<Alcada[]> {
  return tx
    .select({
      funcaoId: funcoes.id,
      funcao: funcoes.nome,
      admin: funcoes.admin,
      funcaoAtiva: funcoes.ativa,
      percentual: sql<number>`coalesce(${alcadasDesconto.percentual}, 0)`.mapWith(Number),
      ativa: sql<boolean>`coalesce(${alcadasDesconto.ativa}, true)`,
      versao: alcadasDesconto.versao,
      atualizadoEm: alcadasDesconto.atualizadoEm,
      atualizadoPor: nomeUsuario('alcadas_desconto', 'atualizado_por'),
    })
    .from(funcoes)
    .leftJoin(alcadasDesconto, eq(alcadasDesconto.funcaoId, funcoes.id))
    .where(funcaoId ? eq(funcoes.id, funcaoId) : undefined)
    .orderBy(desc(funcoes.admin), asc(funcoes.nome));
}

/**
 * Alçadas de desconto (Configurações → Alçadas de desconto; docs/modulos/APROVACAO_COMERCIAL.md). Só o
 * Administrador configura e vê o histórico; qualquer usuário consulta a própria alçada.
 */
export const alcadasRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  const admin = { onRequest: app.exigirAdmin };

  /** A maior alçada entre as funções ativas do usuário logado (a tela avisa antes de emitir). */
  app.get('/minha', { schema: { response: { 200: minhaAlcadaSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => alcadaDoUsuario(tx, req.user.sub)),
  );

  app.get('/', { ...admin, schema: { response: { 200: z.array(alcadaSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => listar(tx)),
  );

  /** Histórico das alterações (as 200 mais recentes). */
  app.get('/historico', { ...admin, schema: { response: { 200: z.array(alcadaEventoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) =>
      tx
        .select({
          funcao: funcoes.nome,
          percentualAntes: alcadasDescontoEventos.percentualAntes,
          percentualDepois: alcadasDescontoEventos.percentualDepois,
          ativaAntes: alcadasDescontoEventos.ativaAntes,
          ativaDepois: alcadasDescontoEventos.ativaDepois,
          usuario: users.nome,
          criadoEm: alcadasDescontoEventos.criadoEm,
        })
        .from(alcadasDescontoEventos)
        .innerJoin(funcoes, eq(funcoes.id, alcadasDescontoEventos.funcaoId))
        .leftJoin(users, eq(users.id, alcadasDescontoEventos.usuarioId))
        .orderBy(desc(alcadasDescontoEventos.criadoEm), desc(alcadasDescontoEventos.id))
        .limit(200),
    ),
  );

  /**
   * Define a alçada da função (cria na primeira vez). Vale para as próximas emissões e decisões; o que já foi
   * solicitado ou decidido guarda a alçada do momento.
   */
  app.put(
    '/:id',
    { ...admin, schema: { params: idParamSchema, body: alcadaInputSchema, response: { 200: alcadaSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [funcao] = await tx.select({ id: funcoes.id }).from(funcoes).where(eq(funcoes.id, req.params.id));
        if (!funcao) throw naoEncontrado('Função');
        const [atual] = await tx
          .select()
          .from(alcadasDesconto)
          .where(eq(alcadasDesconto.funcaoId, funcao.id))
          .for('update');
        if ((atual?.versao ?? null) !== req.body.versao)
          throw new ErroHttp(409, 'Esta alçada foi alterada por outra pessoa. Recarregue a página e refaça a ação.');

        const percentual = Math.round(req.body.percentual * 100);
        const { ativa } = req.body;
        if (atual?.percentual === percentual && atual.ativa === ativa) return (await listar(tx, funcao.id))[0]!;
        if (atual)
          await tx
            .update(alcadasDesconto)
            .set({ percentual, ativa, atualizadoPor: req.user.sub, versao: atual.versao + 1 })
            .where(eq(alcadasDesconto.id, atual.id));
        else
          await tx
            .insert(alcadasDesconto)
            .values({ funcaoId: funcao.id, percentual, ativa, criadoPor: req.user.sub, atualizadoPor: req.user.sub });
        await tx.insert(alcadasDescontoEventos).values({
          funcaoId: funcao.id,
          percentualAntes: atual?.percentual ?? null,
          percentualDepois: percentual,
          ativaAntes: atual?.ativa ?? null,
          ativaDepois: ativa,
          usuarioId: req.user.sub,
        });
        return (await listar(tx, funcao.id))[0]!;
      }),
  );
};
