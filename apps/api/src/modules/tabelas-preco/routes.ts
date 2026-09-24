import {
  hojeIso,
  idParamSchema,
  statusInputSchema,
  tabelaPrecoInputSchema,
  tabelaPrecoSchema,
  type TabelaPreco,
} from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { tabelasPreco } from '../../db/schema.js';
import { alterarAtivo, atualizarVersionado, excluirSeNaoUsado, exigirVersao, nomeUsuario } from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';

const colunas = () => ({
  id: tabelasPreco.id,
  codigo: tabelasPreco.codigo,
  nome: tabelasPreco.nome,
  descricao: tabelasPreco.descricao,
  moeda: sql<'BRL'>`${tabelasPreco.moeda}`,
  ativa: tabelasPreco.ativa,
  // Materiais com preço hoje (Brasília): vigência que cobre o dia ou preço padrão. Correlação escrita à mão.
  materiaisComPreco: sql<number>`(select count(*) from (
      select p.material_id from materiais_precos p
      where p.tabela_preco_id = "tabelas_preco"."id" and not p.cancelado
        and p.data_inicio <= ${hojeIso()}::date and (p.data_fim is null or p.data_fim >= ${hojeIso()}::date)
      union
      select pp.material_id from precos_padrao pp where pp.tabela_preco_id = "tabelas_preco"."id"
    ) com_preco)`.mapWith(Number),
  criadoEm: tabelasPreco.criadoEm,
  atualizadoEm: tabelasPreco.atualizadoEm,
  criadoPor: nomeUsuario('tabelas_preco', 'criado_por'),
  atualizadoPor: nomeUsuario('tabelas_preco', 'atualizado_por'),
  versao: tabelasPreco.versao,
});

async function carregar(tx: Tx, id: string): Promise<TabelaPreco> {
  const [t] = await tx.select(colunas()).from(tabelasPreco).where(eq(tabelasPreco.id, id));
  if (!t) throw naoEncontrado('Tabela de preço');
  return t;
}

export const tabelasPrecoRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  app.addHook('onRequest', app.exigirAcesso('precos'));
  const editar = { onRequest: app.exigirAcesso('precos', 'editar') };

  app.get('/', { schema: { response: { 200: z.array(tabelaPrecoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) => tx.select(colunas()).from(tabelasPreco).orderBy(asc(tabelasPreco.nome))),
  );
  app.get('/:id', { schema: { params: idParamSchema, response: { 200: tabelaPrecoSchema } } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  app.post(
    '/',
    { ...editar, schema: { body: tabelaPrecoInputSchema, response: { 201: tabelaPrecoSchema } } },
    async (req, reply) => {
      const { versao: _v, ...dados } = req.body;
      const tabela = await withTenant(req.user.tid, async (tx) => {
        const [{ id }] = (await tx
          .insert(tabelasPreco)
          .values({ ...dados, criadoPor: req.user.sub, atualizadoPor: req.user.sub })
          .returning({ id: tabelasPreco.id })) as [{ id: string }];
        return carregar(tx, id);
      });
      return reply.code(201).send(tabela);
    },
  );

  app.put(
    '/:id',
    {
      ...editar,
      schema: { params: idParamSchema, body: tabelaPrecoInputSchema, response: { 200: tabelaPrecoSchema } },
    },
    async (req) => {
      const { versao, ...dados } = req.body;
      return withTenant(req.user.tid, async (tx) => {
        await atualizarVersionado(
          tx,
          tabelasPreco,
          req.params.id,
          exigirVersao(versao),
          { ...dados, atualizadoPor: req.user.sub },
          'Tabela de preço',
        );
        return carregar(tx, req.params.id);
      });
    },
  );

  app.patch(
    '/:id/status',
    { ...editar, schema: { params: idParamSchema, body: statusInputSchema, response: { 200: tabelaPrecoSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        await alterarAtivo(
          tx,
          tabelasPreco,
          tabelasPreco.ativa,
          req.params.id,
          req.body.ativo,
          req.user.sub,
          'Tabela de preço',
        );
        return carregar(tx, req.params.id);
      }),
  );

  app.delete('/:id', { ...editar, schema: { params: idParamSchema } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        tabelasPreco,
        req.params.id,
        'Tabela de preço',
        'Esta tabela tem preços cadastrados e não pode ser excluída (o histórico é mantido). Inative-a.',
      ),
    );
    return reply.code(204).send();
  });
};
