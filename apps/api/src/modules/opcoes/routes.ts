import { idParamSchema, listaOpcoesSchema, opcaoInputSchema, opcaoSchema, type ListaOpcoes } from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import { cargosResponsavel, origensCliente, relacionamentosCliente } from '../../db/schema.js';
import { naoEncontrado } from '../../lib/erros.js';

/** Tabela de cada lista e a coluna de clientes que aponta para ela. */
const listas = {
  origens: { tabela: origensCliente, nomeTabela: 'origens_cliente', uso: 'clientes', coluna: 'origem_id' },
  relacionamentos: { tabela: relacionamentosCliente, nomeTabela: 'relacionamentos_cliente', uso: 'clientes', coluna: 'relacionamento_id' },
  // Função do responsável: conta os clientes (PJ) com algum responsável nela.
  cargos: { tabela: cargosResponsavel, nomeTabela: 'cargos_responsavel', uso: 'cliente_responsaveis', coluna: 'cargo_id' },
} satisfies Record<ListaOpcoes, unknown>;

/** Quantos clientes usam o item. Correlação escrita à mão: o Drizzle não qualifica colunas dentro da subconsulta. */
const usoPorClientes = (lista: ListaOpcoes) =>
  sql<number>`(select count(distinct ${sql.raw(listas[lista].uso === 'clientes' ? 'u.id' : 'u.cliente_id')}) from ${sql.identifier(listas[lista].uso)} u
    where u.${sql.identifier(listas[lista].coluna)} = ${sql.identifier(listas[lista].nomeTabela)}."id")`.mapWith(Number);

const listaParam = z.object({ lista: listaOpcoesSchema });

/**
 * Listas editáveis do cadastro de clientes (origem, tipo de relacionamento).
 * Quem acessa clientes consulta (para preencher o formulário); só o admin altera (Configurações).
 * Não há exclusão: desativar tira da escolha sem mexer nos clientes que já usam o item.
 */
export const opcoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  app.get(
    '/:lista',
    { onRequest: app.exigirAcesso('clientes'), schema: { params: listaParam, response: { 200: z.array(opcaoSchema) } } },
    async (req) => {
      const { tabela } = listas[req.params.lista];
      return withTenant(req.user.tid, (tx) =>
        tx
          .select({
            id: tabela.id,
            nome: tabela.nome,
            ativa: tabela.ativa,
            clientes: usoPorClientes(req.params.lista),
          })
          .from(tabela)
          .orderBy(asc(tabela.nome)),
      );
    },
  );

  const salvarSchema = { params: listaParam, body: opcaoInputSchema, response: { 200: opcaoSchema, 201: opcaoSchema } };

  app.post('/:lista', { onRequest: app.exigirAdmin, schema: salvarSchema }, async (req, reply) => {
    const { tabela } = listas[req.params.lista];
    const [opcao] = await withTenant(req.user.tid, (tx) =>
      tx.insert(tabela).values(req.body).returning({ id: tabela.id, nome: tabela.nome, ativa: tabela.ativa }),
    );
    return reply.code(201).send({ ...opcao!, clientes: 0 });
  });

  app.put('/:lista/:id', { onRequest: app.exigirAdmin, schema: { ...salvarSchema, params: listaParam.extend(idParamSchema.shape) } }, async (req) => {
    const { tabela } = listas[req.params.lista];
    const [opcao] = await withTenant(req.user.tid, (tx) =>
      tx
        .update(tabela)
        .set(req.body)
        .where(eq(tabela.id, req.params.id))
        .returning({
          id: tabela.id,
          nome: tabela.nome,
          ativa: tabela.ativa,
          clientes: usoPorClientes(req.params.lista),
        }),
    );
    if (!opcao) throw naoEncontrado('Item');
    return opcao;
  });
};
