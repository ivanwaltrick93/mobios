import {
  clienteParaOrcamentoFiltroSchema,
  clienteParaOrcamentoSchema,
  contextoClienteSchema,
  formatarCodigoServico,
  hojeIso,
  idParamSchema,
  itemVendavelQuerySchema,
  itemVendavelSchema,
  tabelaParaOrcamentoSchema,
  UNIDADES,
  veiculoParaOrcamentoSchema,
  vendedorParaOrcamentoSchema,
  type ItemVendavel,
} from '@mobios/shared';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  clienteEnderecos,
  clientes,
  materiais,
  orcamentos,
  servicos,
  tabelasPreco,
  users,
  veiculos,
  vendedores,
} from '../../db/schema.js';
import { buscaDeMaterial, buscaDeServico } from '../../lib/cadastro.js';
import { naoEncontrado } from '../../lib/erros.js';
import { buscaDeCliente } from '../clientes/routes.js';
import { colunasPendencia, exigirQuemAltera, pendencias, situacaoSql, type BasePendencia } from './consulta.js';
import { precosDoDia, type UsoDoItem } from './regras.js';

/** Colunas da janela de escolha do cliente (lista e recentes), com a cidade principal e as placas. */
const colunasClienteParaOrcamento = {
  id: clientes.id,
  nome: clientes.nome,
  ativo: clientes.ativo,
  ...colunasPendencia,
  cidade: sql<string | null>`(select e.cidade || '/' || e.uf from cliente_enderecos e
    where e.cliente_id = "clientes"."id" order by e.principal desc, e.criado_em limit 1)`,
  placas: sql<string[]>`(select coalesce(array_agg(v.placa order by v.principal desc, v.placa), '{}')
    from veiculos v where v.cliente_id = "clientes"."id")`,
};
const paraClienteParaOrcamento = (
  c: BasePendencia & { id: string; nome: string; ativo: boolean; cidade: string | null; placas: string[] },
) => ({
  id: c.id,
  nome: c.nome,
  tipo: c.tipo,
  cpfCnpj: c.cpfCnpj,
  telefone: c.telefone,
  whatsapp: c.whatsapp,
  cidade: c.cidade,
  placas: c.placas,
  ativo: c.ativo,
  pendencias: pendencias(c),
});

/** Janela de escolha do cliente (orçamento e O.S.): lista paginada, filtros de situação e tipo, placas. */
export async function listarClientesParaEscolha(tx: Tx, filtro: z.output<typeof clienteParaOrcamentoFiltroSchema>) {
  const { q, ativo, tipo, pagina, porPagina } = filtro;
  const onde = and(
    q ? buscaDeCliente(q) : undefined,
    ativo ? eq(clientes.ativo, ativo === 'true') : undefined,
    tipo ? eq(clientes.tipo, tipo) : undefined,
  );
  const lista = await tx
    .select(colunasClienteParaOrcamento)
    .from(clientes)
    .where(onde)
    .orderBy(asc(clientes.nome), asc(clientes.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);
  const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(onde)) as [{ total: number }];
  return { itens: lista.map(paraClienteParaOrcamento), total };
}

/** Clientes pelos ids, na ordem pedida (recentes da janela de escolha). */
export async function clientesParaEscolhaPorId(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const lista = await tx.select(colunasClienteParaOrcamento).from(clientes).where(inArray(clientes.id, ids));
  const porId = new Map(lista.map((c) => [c.id, c]));
  return ids.flatMap((id) => {
    const c = porId.get(id);
    return c ? [paraClienteParaOrcamento(c)] : [];
  });
}

/** Veículos do cliente, o principal primeiro. */
export const veiculosDoCliente = (tx: Tx, clienteId: string) =>
  tx
    .select({ id: veiculos.id, placa: veiculos.placa, marca: veiculos.marca, modelo: veiculos.modelo })
    .from(veiculos)
    .where(eq(veiculos.clienteId, clienteId))
    .orderBy(desc(veiculos.principal), asc(veiculos.placa));

/**
 * Busca de itens com o preço de hoje na tabela: produtos ativos com "Permite venda" (orçamento) ou "Permite uso em
 * O.S." (O.S.) e serviços ativos. Sem preço (`precoCentavos` null) aparece, mas não pode ser incluído.
 */
export async function itensComPrecoDoDia(
  tx: Tx,
  { q, tabelaPrecoId, tipo }: z.output<typeof itemVendavelQuerySchema>,
  uso: UsoDoItem,
): Promise<ItemVendavel[]> {
  // Filtro por tipo: a consulta do outro tipo nem roda.
  const listaMateriais =
    tipo === 'servico'
      ? []
      : await tx
          .select({
            id: materiais.id,
            sku: materiais.sku,
            descricao: materiais.descricao,
            unidade: materiais.unidade,
            multiplo: materiais.multiplo,
            estoque: sql<number>`(select coalesce(sum(e.disponivel - e.reservado), 0)
        from estoques e where e.material_id = "materiais"."id")`.mapWith(Number),
          })
          .from(materiais)
          .where(
            and(
              eq(materiais.ativo, true),
              uso === 'os' ? eq(materiais.permiteUsoOs, true) : eq(materiais.permiteVenda, true),
              buscaDeMaterial(q),
            ),
          )
          .orderBy(asc(materiais.descricao))
          .limit(10);
  const listaServicos =
    tipo === 'material'
      ? []
      : await tx
          .select({
            id: servicos.id,
            codigo: servicos.codigo,
            nome: servicos.nome,
            formaPreco: servicos.formaPreco,
            tempoMinutos: servicos.tempoMinutos,
          })
          .from(servicos)
          .where(and(eq(servicos.ativo, true), buscaDeServico(q)))
          .orderBy(asc(servicos.nome))
          .limit(10);
  const itens: Omit<ItemVendavel, 'precoCentavos'>[] = [
    ...listaMateriais.map((m) => ({
      tipo: 'material' as const,
      id: m.id,
      codigo: m.sku,
      descricao: m.descricao,
      unidade: m.unidade,
      formaPreco: null,
      multiplo: m.multiplo,
      fracionada: UNIDADES[m.unidade].fracionada,
      estoque: m.estoque,
    })),
    ...listaServicos.map((s) => ({
      tipo: 'servico' as const,
      id: s.id,
      codigo: formatarCodigoServico(s.codigo),
      descricao: s.nome,
      unidade: s.formaPreco === 'hora' ? 'H' : 'UN',
      formaPreco: s.formaPreco,
      multiplo: s.formaPreco === 'hora' ? s.tempoMinutos! : 1,
      fracionada: false,
      estoque: null,
    })),
  ];
  const precos = await precosDoDia(tx, itens, tabelaPrecoId, hojeIso());
  return itens.map((i) => ({ ...i, precoCentavos: precos.get(`${i.tipo}:${i.id}`) ?? null }));
}

/**
 * Apoio à tela do orçamento (sem depender dos módulos Clientes, Preços ou da Equipe). Registrado dentro de
 * `orcamentosRoutes`, herda a autenticação e o acesso ao módulo.
 */
export const apoioOrcamentoRoutes: FastifyPluginAsyncZod = async (app) => {
  const editar = { onRequest: exigirQuemAltera };

  /** Janela de escolha do cliente: lista paginada (abre sem busca), filtros de situação e tipo, placas do cliente. */
  app.get(
    '/apoio/clientes',
    {
      ...editar,
      schema: {
        querystring: clienteParaOrcamentoFiltroSchema,
        response: { 200: z.object({ itens: z.array(clienteParaOrcamentoSchema), total: z.number() }) },
      },
    },
    async (req) => withTenant(req.user.tid, (tx) => listarClientesParaEscolha(tx, req.query)),
  );

  /**
   * Clientes recentes (janela de escolha, sem busca): os dos últimos orçamentos do vendedor logado ou, para o
   * Administrador, da oficina. Até 5, do mais recente para o mais antigo; calculado dos orçamentos, sem cadastro à parte.
   */
  app.get(
    '/apoio/clientes/recentes',
    { ...editar, schema: { response: { 200: z.array(clienteParaOrcamentoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const ultimos = await tx
          .select({ clienteId: orcamentos.clienteId, ultimo: sql`max(${orcamentos.criadoEm})` })
          .from(orcamentos)
          .where(req.user.vendedorId ? eq(orcamentos.vendedorId, req.user.vendedorId) : undefined)
          .groupBy(orcamentos.clienteId)
          .orderBy(desc(sql`max(${orcamentos.criadoEm})`))
          .limit(5);
        return clientesParaEscolhaPorId(
          tx,
          ultimos.map((u) => u.clienteId),
        );
      }),
  );

  /**
   * Contexto do cliente no orçamento ("Visualizar cliente"): cadastro, endereço principal, veículos, os 5 últimos
   * orçamentos e o último aprovado. O vendedor vê só os orçamentos dele (os de outros não aparecem).
   */
  app.get(
    '/apoio/clientes/:id/contexto',
    { ...editar, schema: { params: idParamSchema, response: { 200: contextoClienteSchema } } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const [c] = await tx
          .select({
            id: clientes.id,
            nome: clientes.nome,
            rgIe: clientes.rgIe,
            email: clientes.email,
            clienteDesde: clientes.clienteDesde,
            ativo: clientes.ativo,
            ...colunasPendencia,
          })
          .from(clientes)
          .where(eq(clientes.id, req.params.id));
        if (!c) throw naoEncontrado('Cliente');
        const [endereco] = await tx
          .select({
            logradouro: clienteEnderecos.logradouro,
            numero: clienteEnderecos.numero,
            complemento: clienteEnderecos.complemento,
            bairro: clienteEnderecos.bairro,
            cidade: clienteEnderecos.cidade,
            uf: clienteEnderecos.uf,
            cep: clienteEnderecos.cep,
          })
          .from(clienteEnderecos)
          .where(eq(clienteEnderecos.clienteId, c.id))
          .orderBy(desc(clienteEnderecos.principal), asc(clienteEnderecos.criadoEm))
          .limit(1);
        const listaVeiculos = await tx
          .select({ id: veiculos.id, placa: veiculos.placa, marca: veiculos.marca, modelo: veiculos.modelo })
          .from(veiculos)
          .where(eq(veiculos.clienteId, c.id))
          .orderBy(desc(veiculos.principal), asc(veiculos.placa));
        const doCliente = and(
          eq(orcamentos.clienteId, c.id),
          req.user.vendedorId ? eq(orcamentos.vendedorId, req.user.vendedorId) : undefined,
        );
        const recentes = await tx
          .select({
            id: orcamentos.id,
            numero: orcamentos.numero,
            versaoOrcamento: orcamentos.versaoOrcamento,
            situacao: situacaoSql(hojeIso()),
            totalCentavos: orcamentos.totalCentavos,
            criadoEm: orcamentos.criadoEm,
          })
          .from(orcamentos)
          .where(doCliente)
          .orderBy(desc(orcamentos.criadoEm), desc(orcamentos.versaoOrcamento))
          .limit(5);
        const [{ total }] = (await tx.select({ total: count() }).from(orcamentos).where(doCliente)) as [
          { total: number },
        ];
        const [ultimoAprovado] = await tx
          .select({
            id: orcamentos.id,
            numero: orcamentos.numero,
            versaoOrcamento: orcamentos.versaoOrcamento,
            aprovadoEm: orcamentos.aprovadoEm,
            totalCentavos: orcamentos.totalCentavos,
          })
          .from(orcamentos)
          .where(and(doCliente, eq(orcamentos.status, 'aprovado')))
          .orderBy(desc(orcamentos.aprovadoEm))
          .limit(1);
        const { temEndereco: _e, temResponsavel: _r, ...cadastro } = c;
        return {
          ...cadastro,
          pendencias: pendencias(c),
          endereco: endereco ?? null,
          veiculos: listaVeiculos,
          ultimoAprovado: ultimoAprovado ? { ...ultimoAprovado, aprovadoEm: ultimoAprovado.aprovadoEm! } : null,
          totalOrcamentos: total,
          orcamentos: recentes,
        };
      }),
  );

  app.get(
    '/apoio/clientes/:id/veiculos',
    { ...editar, schema: { params: idParamSchema, response: { 200: z.array(veiculoParaOrcamentoSchema) } } },
    async (req) => withTenant(req.user.tid, (tx) => veiculosDoCliente(tx, req.params.id)),
  );

  /** Todos os vendedores (o filtro da lista usa também os inativos; o formulário oferece só os ativos). */
  app.get('/apoio/vendedores', { schema: { response: { 200: z.array(vendedorParaOrcamentoSchema) } } }, async (req) =>
    withTenant(req.user.tid, (tx) =>
      tx
        .select({ id: vendedores.id, codigo: vendedores.codigo, nome: users.nome, ativo: vendedores.ativo })
        .from(vendedores)
        .innerJoin(users, eq(users.id, vendedores.usuarioId))
        .orderBy(asc(users.nome)),
    ),
  );

  app.get(
    '/apoio/tabelas',
    { ...editar, schema: { response: { 200: z.array(tabelaParaOrcamentoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        tx
          .select({
            id: tabelasPreco.id,
            codigo: tabelasPreco.codigo,
            nome: tabelasPreco.nome,
            padrao: tabelasPreco.padrao,
          })
          .from(tabelasPreco)
          .where(eq(tabelasPreco.ativa, true))
          .orderBy(desc(tabelasPreco.padrao), asc(tabelasPreco.nome)),
      ),
  );

  /** Produtos com "Permite venda" e serviços, com o preço de hoje na tabela (itensComPrecoDoDia). */
  app.get(
    '/apoio/itens',
    { ...editar, schema: { querystring: itemVendavelQuerySchema, response: { 200: z.array(itemVendavelSchema) } } },
    async (req) => withTenant(req.user.tid, (tx) => itensComPrecoDoDia(tx, req.query, 'venda')),
  );
};
