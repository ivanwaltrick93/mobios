import {
  idParamSchema,
  listaOpcoesSchema,
  LISTAS_OPCOES,
  opcaoInputSchema,
  opcaoSchema,
  temAcesso,
  type ListaOpcoes,
} from '@mobios/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/client.js';
import {
  cargosResponsavel,
  origensCliente,
  relacionamentosCliente,
  tiposDeposito,
  tiposMaterial,
} from '../../db/schema.js';
import { excluirSeNaoUsado } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

/** Tabela de cada lista e a coluna de clientes que aponta para ela. */
const listas = {
  origens: { tabela: origensCliente, nomeTabela: 'origens_cliente', uso: 'clientes', coluna: 'origem_id' },
  relacionamentos: {
    tabela: relacionamentosCliente,
    nomeTabela: 'relacionamentos_cliente',
    uso: 'clientes',
    coluna: 'relacionamento_id',
  },
  // Função do responsável: conta os clientes (PJ) com algum responsável nela.
  cargos: {
    tabela: cargosResponsavel,
    nomeTabela: 'cargos_responsavel',
    uso: 'cliente_responsaveis',
    coluna: 'cargo_id',
  },
  tiposMaterial: { tabela: tiposMaterial, nomeTabela: 'tipos_material', uso: 'materiais', coluna: 'tipo_id' },
  tiposDeposito: { tabela: tiposDeposito, nomeTabela: 'tipos_deposito', uso: 'depositos', coluna: 'tipo_id' },
} satisfies Record<ListaOpcoes, unknown>;

/**
 * Quantos registros usam o item (para responsáveis: clientes distintos).
 * Correlação escrita à mão: o Drizzle não qualifica colunas dentro da subconsulta.
 */
const usoDoItem = (lista: ListaOpcoes) => {
  const { uso, coluna, nomeTabela } = listas[lista];
  // sql.raw/identifier só recebem valores fixos do objeto `listas`, nunca da requisição.
  const contado = sql.raw(uso === 'cliente_responsaveis' ? 'u.cliente_id' : 'u.id');
  return sql<number>`(select count(distinct ${contado}) from ${sql.identifier(uso)} u
    where u.${sql.identifier(coluna)} = ${sql.identifier(nomeTabela)}."id")`.mapWith(Number);
};

const colunas = (lista: ListaOpcoes) => {
  const { tabela } = listas[lista];
  return {
    id: tabela.id,
    codigo: tabela.codigo,
    nome: tabela.nome,
    descricao: tabela.descricao,
    ativa: tabela.ativa,
    usos: usoDoItem(lista),
  };
};

const listaParam = z.object({ lista: listaOpcoesSchema });
const itemParam = listaParam.extend(idParamSchema.shape);

/**
 * Listas editáveis por oficina (origem, relacionamento, função do responsável, tipos de material e de depósito).
 * Quem acessa o módulo da lista consulta (para preencher formulários); só o admin altera (Configurações).
 * Desativar tira da escolha sem mexer nos registros que já usam o item; excluir, só o que nunca foi usado.
 */
export const opcoesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  app.get('/:lista', { schema: { params: listaParam, response: { 200: z.array(opcaoSchema) } } }, async (req) => {
    // Consulta liberada para quem acessa o módulo que usa a lista (clientes ou materiais).
    if (!temAcesso(req.user.acessos, LISTAS_OPCOES[req.params.lista].modulo))
      throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
    const { tabela } = listas[req.params.lista];
    return withTenant(req.user.tid, (tx) =>
      tx.select(colunas(req.params.lista)).from(tabela).orderBy(asc(tabela.nome)),
    );
  });

  const salvarSchema = { params: listaParam, body: opcaoInputSchema, response: { 200: opcaoSchema, 201: opcaoSchema } };

  app.post('/:lista', { onRequest: app.exigirAdmin, schema: salvarSchema }, async (req, reply) => {
    const { tabela } = listas[req.params.lista];
    const [opcao] = await withTenant(req.user.tid, (tx) =>
      tx.insert(tabela).values(req.body).returning({
        id: tabela.id,
        codigo: tabela.codigo,
        nome: tabela.nome,
        descricao: tabela.descricao,
        ativa: tabela.ativa,
      }),
    );
    return reply.code(201).send({ ...opcao!, usos: 0 });
  });

  app.put(
    '/:lista/:id',
    { onRequest: app.exigirAdmin, schema: { ...salvarSchema, params: itemParam } },
    async (req) => {
      const { tabela } = listas[req.params.lista];
      const [opcao] = await withTenant(req.user.tid, (tx) =>
        tx.update(tabela).set(req.body).where(eq(tabela.id, req.params.id)).returning(colunas(req.params.lista)),
      );
      if (!opcao) throw naoEncontrado('Item');
      return opcao;
    },
  );

  /** Exclui só o item que nenhum registro usa (as FKs são RESTRICT); em uso, a saída é inativar. */
  app.delete('/:lista/:id', { onRequest: app.exigirAdmin, schema: { params: itemParam } }, async (req, reply) => {
    await withTenant(req.user.tid, (tx) =>
      excluirSeNaoUsado(
        tx,
        listas[req.params.lista].tabela,
        req.params.id,
        'Item',
        `Este item está em uso (${LISTAS_OPCOES[req.params.lista].uso}). Ele pode apenas ser inativado.`,
      ),
    );
    return reply.code(204).send();
  });
};
