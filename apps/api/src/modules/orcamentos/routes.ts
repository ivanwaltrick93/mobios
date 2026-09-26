import {
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  idParamSchema,
  normalizarPlaca,
  orcamentoFiltroSchema,
  orcamentoInputSchema,
  orcamentoResumoSchema,
  orcamentoSchema,
  somarItens,
  temAcesso,
  type OrcamentoDados,
} from '@mobios/shared';
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import { clientes, orcamentos, tabelasPreco, users, veiculos, vendedores } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { apoioOrcamentoRoutes } from './apoio.js';
import {
  carregar,
  exigirPrecosDoDia,
  exigirQuemAltera,
  exigirSituacao,
  exigirVersaoLida,
  filtroSituacao,
  situacaoSql,
  travar,
  type Gravado,
} from './consulta.js';
import {
  descreverDescontos,
  gravarItens,
  itensDoOrcamento,
  montarItens,
  recalcularDoDia,
  registrar,
} from './regras.js';
import { transicoesOrcamentoRoutes } from './transicoes.js';

/**
 * Cliente (pode estar inativo ou incompleto: só avisa), veículo do cliente, vendedor ativo (manter o atual é
 * permitido) e tabela ativa — vazia = a padrão da oficina. Devolve a tabela a usar.
 */
async function validarCabecalho(tx: Tx, dados: OrcamentoDados, atual?: Gravado): Promise<string> {
  const [cliente] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, dados.clienteId));
  if (!cliente) throw new ErroHttp(400, 'Cliente não encontrado.', { clienteId: 'Cliente não encontrado' });
  if (dados.veiculoId) {
    const [veiculo] = await tx
      .select({ clienteId: veiculos.clienteId })
      .from(veiculos)
      .where(eq(veiculos.id, dados.veiculoId));
    if (veiculo?.clienteId !== dados.clienteId)
      throw new ErroHttp(400, 'O veículo escolhido não é deste cliente.', { veiculoId: 'Veículo de outro cliente' });
  }
  if (dados.vendedorId !== atual?.vendedorId) {
    const [vendedor] = await tx
      .select({ ativo: vendedores.ativo })
      .from(vendedores)
      .where(eq(vendedores.id, dados.vendedorId));
    if (!vendedor?.ativo)
      throw new ErroHttp(400, 'Escolha um vendedor ativo.', { vendedorId: 'Escolha um vendedor ativo' });
  }
  const [tabela] = await tx
    .select({ id: tabelasPreco.id, ativa: tabelasPreco.ativa })
    .from(tabelasPreco)
    .where(dados.tabelaPrecoId ? eq(tabelasPreco.id, dados.tabelaPrecoId) : eq(tabelasPreco.padrao, true));
  if (!tabela) {
    if (dados.tabelaPrecoId)
      throw new ErroHttp(400, 'Tabela de preço não encontrada.', { tabelaPrecoId: 'Tabela não encontrada' });
    throw new ErroHttp(
      400,
      'A oficina ainda não tem tabela de preço padrão. Cadastre uma em Política Comercial → Tabelas de Preço.',
    );
  }
  if (!tabela.ativa && tabela.id !== atual?.tabelaPrecoId)
    throw new ErroHttp(400, 'A tabela de preço escolhida está inativa.', { tabelaPrecoId: 'Tabela inativa' });
  return tabela.id;
}

const cabecalho = (dados: OrcamentoDados, tabelaPrecoId: string) => ({
  clienteId: dados.clienteId,
  veiculoId: dados.veiculoId,
  vendedorId: dados.vendedorId,
  tabelaPrecoId,
  validadeAte: dados.validadeAte,
  observacoes: dados.observacoes,
});

const resumoDoTotal = (itens: number, total: number) => `${itens} item(ns), total ${formatarMoeda(total)}.`;

/** Orçamentos (menu Orçamentos). Consultar: módulo Orçamentos; alterar: Editar; aprovar/recusar: Aprovar orçamentos. */
export const orcamentosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  // Entra quem consulta orçamentos pela matriz, o Administrador e o vendedor ativo (este, só nos próprios).
  app.addHook('onRequest', async (req) => {
    if (!req.user.admin && !req.user.vendedorId && !temAcesso(req.user.acessos, 'orcamentos'))
      throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
  });
  const editar = { onRequest: exigirQuemAltera };
  const resposta = { 200: orcamentoSchema };

  // Os plugins filhos herdam os hooks acima (autenticação e acesso ao módulo) e o prefixo /api/orcamentos.
  await app.register(apoioOrcamentoRoutes);
  await app.register(transicoesOrcamentoRoutes);

  /** Busca por número (com ou sem "ORC-"), nome do cliente ou placa; filtros de situação, vendedor e período. */
  app.get(
    '/',
    {
      schema: {
        querystring: orcamentoFiltroSchema,
        response: { 200: z.object({ itens: z.array(orcamentoResumoSchema), total: z.number() }) },
      },
    },
    async (req) => {
      const { q, situacao, vendedorId, desde, ate, pagina, porPagina } = req.query;
      const hoje = hojeIso();
      // "ORC-0000000012", "0000000012" e "12" são o mesmo número.
      const numero = q?.replace(/^orc-?/i, '').replace(/^0+(?=\d)/, '');
      const filtros: (SQL | undefined)[] = [
        // Número, nome do cliente ou placa, pela função busca_orcamentos (migração 0028).
        q
          ? sql`${orcamentos.id} in (select busca_orcamentos(
              ${numero && /^\d{1,9}$/.test(numero) ? Number(numero) : null}::integer, ${`%${q}%`}::text,
              ${normalizarPlaca(q)}::text))`
          : undefined,
        situacao ? filtroSituacao(situacao, hoje) : undefined,
        // O vendedor só vê os próprios (o filtro dele vem fixo na tela).
        req.user.vendedorId
          ? eq(orcamentos.vendedorId, req.user.vendedorId)
          : vendedorId
            ? eq(orcamentos.vendedorId, vendedorId)
            : undefined,
        desde ? gte(orcamentos.criadoEm, sql`${desde}::date::timestamp at time zone 'America/Sao_Paulo'`) : undefined,
        ate ? lte(orcamentos.criadoEm, sql`(${ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`) : undefined,
      ];
      const onde = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
        // Pagina só os ids (filtros e ordem são todos de orcamentos) e junta cliente, veículo e vendedor depois, só
        // nas linhas da página: numa busca ampla, as junções não correm sobre todos os resultados.
        const ordem = [desc(orcamentos.criadoEm), desc(orcamentos.numero)];
        const daPagina = tx
          .select({ id: orcamentos.id })
          .from(orcamentos)
          .where(onde)
          .orderBy(...ordem)
          .limit(porPagina)
          .offset((pagina - 1) * porPagina)
          .as('da_pagina');
        const itens = await tx
          .select({
            id: orcamentos.id,
            numero: orcamentos.numero,
            versaoOrcamento: orcamentos.versaoOrcamento,
            situacao: situacaoSql(hoje),
            clienteNome: clientes.nome,
            veiculoPlaca: veiculos.placa,
            vendedorNome: users.nome,
            totalCentavos: orcamentos.totalCentavos,
            validadeAte: orcamentos.validadeAte,
            criadoEm: orcamentos.criadoEm,
          })
          .from(orcamentos)
          .innerJoin(daPagina, eq(daPagina.id, orcamentos.id))
          .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
          .leftJoin(veiculos, eq(veiculos.id, orcamentos.veiculoId))
          .innerJoin(vendedores, eq(vendedores.id, orcamentos.vendedorId))
          .innerJoin(users, eq(users.id, vendedores.usuarioId))
          .orderBy(...ordem);
        // Os filtros são todos de orcamentos: a contagem não precisa das junções.
        const [{ total }] = (await tx.select({ total: count() }).from(orcamentos).where(onde)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  // ---------- Orçamento ----------

  app.get('/:id', { schema: { params: idParamSchema, response: resposta } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id, req.user.vendedorId)),
  );

  /** Novo rascunho (versão 1). O número vem do contador da oficina, na mesma transação. */
  app.post(
    '/',
    { ...editar, schema: { body: orcamentoInputSchema, response: { 201: orcamentoSchema } } },
    async (req, reply) => {
      // O vendedor não escolhe: o orçamento fica no nome dele.
      const dados = req.user.vendedorId ? { ...req.body, vendedorId: req.user.vendedorId } : req.body;
      const orcamento = await withTenant(req.user.tid, async (tx) => {
        const hoje = hojeIso();
        const tabelaPrecoId = await validarCabecalho(tx, dados);
        const { linhas, avisos } = await montarItens(tx, dados.itens, [], tabelaPrecoId, hoje, false);
        const totais = somarItens(linhas);
        const [{ id }] = (await tx
          .insert(orcamentos)
          .values({
            ...cabecalho(dados, tabelaPrecoId),
            ...totais,
            precosEm: hoje,
            criadoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .returning({ id: orcamentos.id })) as [{ id: string }];
        await gravarItens(tx, id, linhas);
        await registrar(tx, id, 'criado', req.user.sub, resumoDoTotal(linhas.length, totais.totalCentavos));
        const descontos = descreverDescontos([], linhas);
        if (descontos) await registrar(tx, id, 'descontos_alterados', req.user.sub, descontos);
        return carregar(tx, id, req.user.vendedorId, avisos);
      });
      return reply.code(201).send(orcamento);
    },
  );

  /**
   * Alteração do rascunho (cabeçalho e itens). Trocar a tabela recalcula todos os itens ao preço cheio da nova
   * tabela e tira os sem preço, com aviso.
   */
  app.put(
    '/:id',
    { ...editar, schema: { params: idParamSchema, body: orcamentoInputSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['rascunho'], 'alterar');
        exigirPrecosDoDia(atual);
        const dados = req.user.vendedorId ? { ...req.body, vendedorId: req.user.vendedorId } : req.body;
        // O cliente é o do orçamento original: a partir da versão 2 (já foi emitido) não muda.
        if (atual.versaoOrcamento > 1 && dados.clienteId !== atual.clienteId)
          throw new ErroHttp(400, 'O cliente não pode ser trocado numa nova versão do orçamento.', {
            clienteId: 'O cliente não muda a partir da versão 2',
          });
        const tabelaPrecoId = await validarCabecalho(tx, dados, atual);
        const trocouTabela = tabelaPrecoId !== atual.tabelaPrecoId;
        const gravados = await itensDoOrcamento(tx, atual.id);
        const { linhas, avisos } = await montarItens(tx, dados.itens, gravados, tabelaPrecoId, hojeIso(), trocouTabela);
        const totais = somarItens(linhas);
        await tx
          .update(orcamentos)
          .set({
            ...cabecalho(dados, tabelaPrecoId),
            ...totais,
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(orcamentos.id, atual.id));
        await gravarItens(tx, atual.id, linhas);
        if (trocouTabela) {
          const [nova] = await tx
            .select({ nome: tabelasPreco.nome })
            .from(tabelasPreco)
            .where(eq(tabelasPreco.id, tabelaPrecoId));
          await registrar(
            tx,
            atual.id,
            'tabela_trocada',
            req.user.sub,
            [`Tabela ${nova!.nome}: itens ao preço cheio.`, ...avisos].join(' '),
          );
        }
        if (!dados.automatico)
          await registrar(tx, atual.id, 'alterado', req.user.sub, resumoDoTotal(linhas.length, totais.totalCentavos));
        // Na troca de tabela a negociação é desfeita, e o evento tabela_trocada já conta isso.
        const descontos = trocouTabela ? null : descreverDescontos(gravados, linhas);
        if (descontos) await registrar(tx, atual.id, 'descontos_alterados', req.user.sub, descontos);
        return carregar(tx, atual.id, req.user.vendedorId, avisos);
      }),
  );

  /**
   * Rascunho aberto em outro dia: preços do dia (a tela chama ao abrir). Material mais caro mantém o valor do
   * cliente com desconto; mais barato, fica o novo; serviço, sempre o novo; sem preço, sai. Já no dia: nada muda.
   */
  app.post('/:id/recalcular', { ...editar, schema: { params: idParamSchema, response: resposta } }, async (req) =>
    withTenant(req.user.tid, async (tx) => {
      const atual = await travar(tx, req.params.id, req.user.vendedorId);
      const hoje = hojeIso();
      if (atual.status !== 'rascunho' || atual.precosEm >= hoje) return carregar(tx, atual.id, req.user.vendedorId);
      const gravados = await itensDoOrcamento(tx, atual.id);
      const { linhas, avisos } = await recalcularDoDia(tx, gravados, atual.tabelaPrecoId, hoje);
      const totais = somarItens(linhas);
      await tx
        .update(orcamentos)
        .set({ ...totais, precosEm: hoje, atualizadoPor: req.user.sub, versao: atual.versao + 1 })
        .where(eq(orcamentos.id, atual.id));
      await gravarItens(tx, atual.id, linhas);
      await registrar(
        tx,
        atual.id,
        'precos_recalculados',
        req.user.sub,
        avisos.length ? avisos.join(' ') : `Preços de ${formatarDataIso(hoje)}: nenhum mudou.`,
      );
      return carregar(tx, atual.id, req.user.vendedorId, avisos);
    }),
  );
};
