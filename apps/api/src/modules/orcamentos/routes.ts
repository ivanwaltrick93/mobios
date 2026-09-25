import { randomUUID } from 'node:crypto';
import {
  clienteParaOrcamentoSchema,
  formatarDataIso,
  formatarMoeda,
  formatarNumeroOrcamento,
  hojeIso,
  idParamSchema,
  itemVendavelQuerySchema,
  itemVendavelSchema,
  normalizarPlaca,
  orcamentoFiltroSchema,
  orcamentoInputSchema,
  orcamentoResumoSchema,
  orcamentoSchema,
  pendenciasCliente,
  situacaoOrcamento,
  somarDias,
  somarItens,
  tabelaParaOrcamentoSchema,
  transicaoOrcamentoSchema,
  UNIDADES,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  veiculoParaOrcamentoSchema,
  vendedorParaOrcamentoSchema,
  formatarCodigoServico,
  type EventoOrcamento,
  type ItemVendavel,
  type Orcamento,
  type OrcamentoDados,
  type SituacaoOrcamento,
} from '@mobios/shared';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  clientes,
  materiais,
  orcamentoItens,
  orcamentos,
  orcamentosEventos,
  servicos,
  tabelasPreco,
  users,
  veiculos,
  vendedores,
} from '../../db/schema.js';
import { buscaDeMaterial, buscaDeServico, nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { gravarItens, itensDoOrcamento, montarItens, precosDoDia, recalcularDoDia } from './regras.js';

type Gravado = typeof orcamentos.$inferSelect;

/** Emitido/enviado vence sozinho depois do dia seguinte ao da validade (a mesma regra de situacaoOrcamento). */
const vencidoSql = (hoje: string) =>
  sql`(${orcamentos.status} in ('emitido', 'enviado') and ${orcamentos.validadeAte} + 1 < ${hoje}::date)`;
const situacaoSql = (hoje: string) =>
  sql<SituacaoOrcamento>`case when ${vencidoSql(hoje)} then 'vencido' else ${orcamentos.status}::text end`;

/** Filtro da situação exibida (vencido é calculado; emitido/enviado só enquanto não vencem). */
function filtroSituacao(situacao: SituacaoOrcamento, hoje: string): SQL {
  if (situacao === 'vencido') return vencidoSql(hoje);
  if (situacao === 'emitido' || situacao === 'enviado')
    return and(eq(orcamentos.status, situacao), sql`not ${vencidoSql(hoje)}`)!;
  return eq(orcamentos.status, situacao);
}

// Correlação escrita à mão: dentro da subconsulta o Drizzle não qualifica as colunas.
const temEndereco = sql<boolean>`exists (select 1 from cliente_enderecos e where e.cliente_id = "clientes"."id")`;
const temResponsavel = sql<boolean>`exists (select 1 from cliente_responsaveis r where r.cliente_id = "clientes"."id")`;
const colunasPendencia = {
  tipo: clientes.tipo,
  cpfCnpj: clientes.cpfCnpj,
  telefone: clientes.telefone,
  whatsapp: clientes.whatsapp,
  temEndereco,
  temResponsavel,
};
type BasePendencia = {
  tipo: 'PF' | 'PJ';
  cpfCnpj: string | null;
  telefone: string | null;
  whatsapp: string | null;
  temEndereco: boolean;
  temResponsavel: boolean;
};
const pendencias = (c: BasePendencia) => pendenciasCliente(c, c.temEndereco, c.temResponsavel);

async function carregar(tx: Tx, id: string, avisos: string[] = []): Promise<Orcamento> {
  const hoje = hojeIso();
  const [o] = await tx
    .select({
      id: orcamentos.id,
      numero: orcamentos.numero,
      versaoOrcamento: orcamentos.versaoOrcamento,
      status: orcamentos.status,
      situacao: situacaoSql(hoje),
      totalCentavos: orcamentos.totalCentavos,
      subtotalCentavos: orcamentos.subtotalCentavos,
      descontoCentavos: orcamentos.descontoCentavos,
      validadeAte: orcamentos.validadeAte,
      precosEm: orcamentos.precosEm,
      observacoes: orcamentos.observacoes,
      criadoEm: orcamentos.criadoEm,
      atualizadoEm: orcamentos.atualizadoEm,
      versao: orcamentos.versao,
      emitidoEm: orcamentos.emitidoEm,
      enviadoEm: orcamentos.enviadoEm,
      aprovadoEm: orcamentos.aprovadoEm,
      recusadoEm: orcamentos.recusadoEm,
      motivoRecusa: orcamentos.motivoRecusa,
      canceladoEm: orcamentos.canceladoEm,
      motivoCancelamento: orcamentos.motivoCancelamento,
      criadoPor: nomeUsuario('orcamentos', 'criado_por'),
      aprovadoPor: nomeUsuario('orcamentos', 'aprovado_por'),
      recusadoPor: nomeUsuario('orcamentos', 'recusado_por'),
      cliente: { id: clientes.id, nome: clientes.nome, ativo: clientes.ativo, ...colunasPendencia },
      veiculoId: veiculos.id,
      veiculoPlaca: veiculos.placa,
      veiculoMarca: veiculos.marca,
      veiculoModelo: veiculos.modelo,
      vendedor: { id: vendedores.id, nome: users.nome, ativo: vendedores.ativo },
      tabela: { id: tabelasPreco.id, codigo: tabelasPreco.codigo, nome: tabelasPreco.nome },
    })
    .from(orcamentos)
    .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
    .leftJoin(veiculos, eq(veiculos.id, orcamentos.veiculoId))
    .innerJoin(vendedores, eq(vendedores.id, orcamentos.vendedorId))
    .innerJoin(users, eq(users.id, vendedores.usuarioId))
    .innerJoin(tabelasPreco, eq(tabelasPreco.id, orcamentos.tabelaPrecoId))
    .where(eq(orcamentos.id, id));
  if (!o) throw naoEncontrado('Orçamento');

  const itens = await itensDoOrcamento(tx, id);
  const eventos = await tx
    .select({
      evento: orcamentosEventos.evento,
      detalhe: orcamentosEventos.detalhe,
      usuario: users.nome,
      criadoEm: orcamentosEventos.criadoEm,
    })
    .from(orcamentosEventos)
    .leftJoin(users, eq(users.id, orcamentosEventos.usuarioId))
    .where(eq(orcamentosEventos.orcamentoId, id))
    .orderBy(desc(orcamentosEventos.criadoEm), desc(orcamentosEventos.id));
  const versoes = await tx
    .select({
      id: orcamentos.id,
      versaoOrcamento: orcamentos.versaoOrcamento,
      situacao: situacaoSql(hoje),
      totalCentavos: orcamentos.totalCentavos,
    })
    .from(orcamentos)
    .where(eq(orcamentos.numero, o.numero))
    .orderBy(desc(orcamentos.versaoOrcamento));

  const { cliente, veiculoId, veiculoPlaca, veiculoMarca, veiculoModelo, ...resto } = o;
  return {
    ...resto,
    clienteNome: cliente.nome,
    vendedorNome: o.vendedor.nome,
    cliente: { id: cliente.id, nome: cliente.nome, ativo: cliente.ativo, pendencias: pendencias(cliente) },
    veiculo: veiculoId ? { id: veiculoId, placa: veiculoPlaca!, marca: veiculoMarca!, modelo: veiculoModelo! } : null,
    veiculoPlaca,
    itens: itens.map(({ tenantId: _t, orcamentoId: _o, descontoPercentual, quantidade, ...i }) => ({
      ...i,
      quantidade: quantidade == null ? null : Number(quantidade),
      descontoPercentual: descontoPercentual == null ? null : descontoPercentual / 100,
    })),
    eventos,
    versoes,
    avisos,
  };
}

/** Histórico. clock_timestamp: dois eventos da mesma transação ficam na ordem em que aconteceram. */
const registrar = (tx: Tx, orcamentoId: string, evento: EventoOrcamento, usuarioId: string, detalhe?: string) =>
  tx
    .insert(orcamentosEventos)
    .values({ orcamentoId, evento, usuarioId, detalhe: detalhe || null, criadoEm: sql`clock_timestamp()` });

/** Lê o orçamento travando a linha até o fim da transação (transições e edição não se atropelam). */
async function travar(tx: Tx, id: string): Promise<Gravado> {
  const [o] = await tx.select().from(orcamentos).where(eq(orcamentos.id, id)).for('update');
  if (!o) throw naoEncontrado('Orçamento');
  return o;
}

function exigirVersaoLida(o: Gravado, versao: number | undefined) {
  if (versao == null) throw new ErroHttp(400, 'Informe a versão do registro (campo "versao").');
  if (versao !== o.versao)
    throw new ErroHttp(409, 'Este orçamento foi alterado por outra pessoa. Recarregue a página e refaça a ação.');
}

/** A ação só vale nas situações indicadas (vencido é calculado pela validade). */
function exigirSituacao(o: Gravado, permitidas: SituacaoOrcamento[], acao: string) {
  const atual = situacaoOrcamento(o.status, o.validadeAte);
  if (!permitidas.includes(atual))
    throw new ErroHttp(409, `Orçamento ${atual}: não é possível ${acao}. Recarregue a página.`);
}

/** Rascunho aberto em outro dia precisa ser recalculado (POST /:id/recalcular) antes de mudar ou emitir. */
function exigirPrecosDoDia(o: Gravado) {
  if (o.precosEm < hojeIso())
    throw new ErroHttp(
      409,
      `Os preços deste rascunho são de ${formatarDataIso(o.precosEm)}. Abra o orçamento de novo para recalcular.`,
    );
}

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
  app.addHook('onRequest', app.exigirAcesso('orcamentos'));
  const editar = { onRequest: app.exigirAcesso('orcamentos', 'editar') };
  const aprovar = { onRequest: app.exigirAcesso('aprovar_orcamentos', 'editar') };
  const resposta = { 200: orcamentoSchema };

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
        q
          ? or(
              ...(numero && /^\d{1,9}$/.test(numero) ? [eq(orcamentos.numero, Number(numero))] : []),
              ilike(clientes.nome, `%${q}%`),
              eq(veiculos.placa, normalizarPlaca(q)),
            )
          : undefined,
        situacao ? filtroSituacao(situacao, hoje) : undefined,
        vendedorId ? eq(orcamentos.vendedorId, vendedorId) : undefined,
        desde ? gte(orcamentos.criadoEm, sql`${desde}::date::timestamp at time zone 'America/Sao_Paulo'`) : undefined,
        ate ? lte(orcamentos.criadoEm, sql`(${ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`) : undefined,
      ];
      const onde = and(...filtros);
      return withTenant(req.user.tid, async (tx) => {
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
          .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
          .leftJoin(veiculos, eq(veiculos.id, orcamentos.veiculoId))
          .innerJoin(vendedores, eq(vendedores.id, orcamentos.vendedorId))
          .innerJoin(users, eq(users.id, vendedores.usuarioId))
          .where(onde)
          .orderBy(desc(orcamentos.criadoEm), desc(orcamentos.numero))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx
          .select({ total: count() })
          .from(orcamentos)
          .innerJoin(clientes, eq(clientes.id, orcamentos.clienteId))
          .leftJoin(veiculos, eq(veiculos.id, orcamentos.veiculoId))
          .where(onde)) as [{ total: number }];
        return { itens, total };
      });
    },
  );

  // ---------- Apoio à tela (sem depender dos módulos Clientes, Preços ou da Equipe) ----------

  app.get(
    '/apoio/clientes',
    {
      ...editar,
      schema: {
        querystring: z.object({ q: z.string().trim().min(2) }),
        response: { 200: z.array(clienteParaOrcamentoSchema) },
      },
    },
    async (req) => {
      const { q } = req.query;
      const digitos = q.replace(/\D/g, '');
      return withTenant(req.user.tid, async (tx) => {
        const lista = await tx
          .select({ id: clientes.id, nome: clientes.nome, ativo: clientes.ativo, ...colunasPendencia })
          .from(clientes)
          .where(
            or(
              ilike(clientes.nome, `%${q}%`),
              ...(digitos.length >= 3 ? [ilike(clientes.cpfCnpj, `${digitos}%`)] : []),
              sql`exists (select 1 from veiculos v where v.cliente_id = "clientes"."id"
                and v.placa = ${normalizarPlaca(q)})`,
            ),
          )
          .orderBy(asc(clientes.nome))
          .limit(10);
        return lista.map((c) => ({
          id: c.id,
          nome: c.nome,
          cpfCnpj: c.cpfCnpj,
          ativo: c.ativo,
          pendencias: pendencias(c),
        }));
      });
    },
  );

  app.get(
    '/apoio/clientes/:id/veiculos',
    { ...editar, schema: { params: idParamSchema, response: { 200: z.array(veiculoParaOrcamentoSchema) } } },
    async (req) =>
      withTenant(req.user.tid, (tx) =>
        tx
          .select({ id: veiculos.id, placa: veiculos.placa, marca: veiculos.marca, modelo: veiculos.modelo })
          .from(veiculos)
          .where(eq(veiculos.clienteId, req.params.id))
          .orderBy(desc(veiculos.principal), asc(veiculos.placa)),
      ),
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

  /**
   * Materiais (ativos, "Permite venda") e serviços (ativos) com o preço de hoje na tabela. Sem preço
   * (`precoCentavos` null) aparece na busca, mas não pode ser incluído.
   */
  app.get(
    '/apoio/itens',
    { ...editar, schema: { querystring: itemVendavelQuerySchema, response: { 200: z.array(itemVendavelSchema) } } },
    async (req) => {
      const { q, tabelaPrecoId } = req.query;
      return withTenant(req.user.tid, async (tx) => {
        const listaMateriais = await tx
          .select({
            id: materiais.id,
            sku: materiais.sku,
            descricao: materiais.descricao,
            unidade: materiais.unidade,
            multiplo: materiais.multiplo,
          })
          .from(materiais)
          .where(and(eq(materiais.ativo, true), eq(materiais.permiteVenda, true), buscaDeMaterial(q)))
          .orderBy(asc(materiais.descricao))
          .limit(10);
        const listaServicos = await tx
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
          })),
        ];
        const precos = await precosDoDia(tx, itens, tabelaPrecoId, hojeIso());
        return itens.map((i) => ({ ...i, precoCentavos: precos.get(`${i.tipo}:${i.id}`) ?? null }));
      });
    },
  );

  // ---------- Orçamento ----------

  app.get('/:id', { schema: { params: idParamSchema, response: resposta } }, async (req) =>
    withTenant(req.user.tid, (tx) => carregar(tx, req.params.id)),
  );

  /** Novo rascunho (versão 1). O número vem do contador da oficina, na mesma transação. */
  app.post(
    '/',
    { ...editar, schema: { body: orcamentoInputSchema, response: { 201: orcamentoSchema } } },
    async (req, reply) => {
      const orcamento = await withTenant(req.user.tid, async (tx) => {
        const hoje = hojeIso();
        const tabelaPrecoId = await validarCabecalho(tx, req.body);
        const { linhas, avisos } = await montarItens(tx, req.body.itens, [], tabelaPrecoId, hoje, false);
        const totais = somarItens(linhas);
        const [{ id }] = (await tx
          .insert(orcamentos)
          .values({
            ...cabecalho(req.body, tabelaPrecoId),
            ...totais,
            precosEm: hoje,
            criadoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .returning({ id: orcamentos.id })) as [{ id: string }];
        await gravarItens(tx, id, linhas);
        await registrar(tx, id, 'criado', req.user.sub, resumoDoTotal(linhas.length, totais.totalCentavos));
        return carregar(tx, id, avisos);
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
        const atual = await travar(tx, req.params.id);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['rascunho'], 'alterar');
        exigirPrecosDoDia(atual);
        // O cliente é o do orçamento original: a partir da versão 2 (já foi emitido) não muda.
        if (atual.versaoOrcamento > 1 && req.body.clienteId !== atual.clienteId)
          throw new ErroHttp(400, 'O cliente não pode ser trocado numa nova versão do orçamento.', {
            clienteId: 'O cliente não muda a partir da versão 2',
          });
        const tabelaPrecoId = await validarCabecalho(tx, req.body, atual);
        const trocouTabela = tabelaPrecoId !== atual.tabelaPrecoId;
        const gravados = await itensDoOrcamento(tx, atual.id);
        const { linhas, avisos } = await montarItens(
          tx,
          req.body.itens,
          gravados,
          tabelaPrecoId,
          hojeIso(),
          trocouTabela,
        );
        const totais = somarItens(linhas);
        await tx
          .update(orcamentos)
          .set({
            ...cabecalho(req.body, tabelaPrecoId),
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
        await registrar(tx, atual.id, 'alterado', req.user.sub, resumoDoTotal(linhas.length, totais.totalCentavos));
        return carregar(tx, atual.id, avisos);
      }),
  );

  /**
   * Rascunho aberto em outro dia: preços do dia (a tela chama ao abrir). Material mais caro mantém o valor do
   * cliente com desconto; mais barato, fica o novo; serviço, sempre o novo; sem preço, sai. Já no dia: nada muda.
   */
  app.post('/:id/recalcular', { ...editar, schema: { params: idParamSchema, response: resposta } }, async (req) =>
    withTenant(req.user.tid, async (tx) => {
      const atual = await travar(tx, req.params.id);
      const hoje = hojeIso();
      if (atual.status !== 'rascunho' || atual.precosEm >= hoje) return carregar(tx, atual.id);
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
      return carregar(tx, atual.id, avisos);
    }),
  );

  /** Emissão: conteúdo congelado. Validade vazia = 7 dias; de hoje até no máximo 30 dias. */
  app.post(
    '/:id/emitir',
    { ...editar, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['rascunho'], 'emitir');
        exigirPrecosDoDia(atual);
        const [{ itens }] = (await tx
          .select({ itens: count() })
          .from(orcamentoItens)
          .where(eq(orcamentoItens.orcamentoId, atual.id))) as [{ itens: number }];
        if (!itens) throw new ErroHttp(400, 'Inclua ao menos um material ou serviço antes de emitir.');
        const [vendedor] = await tx
          .select({ ativo: vendedores.ativo })
          .from(vendedores)
          .where(eq(vendedores.id, atual.vendedorId));
        if (!vendedor?.ativo)
          throw new ErroHttp(400, 'O vendedor deste orçamento está inativo. Escolha outro antes de emitir.');

        const hoje = hojeIso();
        const maxima = somarDias(hoje, VALIDADE_MAXIMA_DIAS);
        const validadeAte = atual.validadeAte ?? somarDias(hoje, VALIDADE_PADRAO_DIAS);
        if (validadeAte < hoje)
          throw new ErroHttp(400, 'A validade não pode ser anterior a hoje.', {
            validadeAte: 'Informe hoje ou uma data futura',
          });
        if (validadeAte > maxima)
          throw new ErroHttp(
            400,
            `A validade vai no máximo até ${formatarDataIso(maxima)} (${VALIDADE_MAXIMA_DIAS} dias).`,
            { validadeAte: `No máximo ${formatarDataIso(maxima)}` },
          );
        await tx
          .update(orcamentos)
          .set({
            status: 'emitido',
            validadeAte,
            emitidoEm: new Date(),
            emitidoPor: req.user.sub,
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'emitido', req.user.sub, `Válido até ${formatarDataIso(validadeAte)}.`);
        return carregar(tx, atual.id);
      }),
  );

  /** Transição simples de situação, com a trava da linha, a versão lida e o registro no histórico. */
  const transicao = (
    rota: string,
    opcoes: { onRequest: typeof editar.onRequest },
    regra: {
      de: SituacaoOrcamento[];
      acao: string;
      evento: EventoOrcamento;
      valores: (usuarioId: string, motivo: string | null) => Partial<typeof orcamentos.$inferInsert>;
      detalhe?: (motivo: string | null) => string | undefined;
    },
  ) =>
    app.post(
      rota,
      { ...opcoes, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
      async (req) =>
        withTenant(req.user.tid, async (tx) => {
          const atual = await travar(tx, req.params.id);
          exigirVersaoLida(atual, req.body.versao);
          exigirSituacao(atual, regra.de, regra.acao);
          await tx
            .update(orcamentos)
            .set({
              ...regra.valores(req.user.sub, req.body.motivo),
              atualizadoPor: req.user.sub,
              versao: atual.versao + 1,
            })
            .where(eq(orcamentos.id, atual.id));
          await registrar(tx, atual.id, regra.evento, req.user.sub, regra.detalhe?.(req.body.motivo));
          return carregar(tx, atual.id);
        }),
    );

  transicao('/:id/enviar', editar, {
    de: ['emitido'],
    acao: 'marcar como enviado',
    evento: 'enviado',
    valores: (usuarioId) => ({ status: 'enviado', enviadoEm: new Date(), enviadoPor: usuarioId }),
  });
  // Só a versão viva pode ser aprovada: as anteriores são canceladas ao gerar a nova (orcamentos_uma_versao_viva).
  transicao('/:id/aprovar', aprovar, {
    de: ['emitido', 'enviado'],
    acao: 'aprovar',
    evento: 'aprovado',
    valores: (usuarioId) => ({ status: 'aprovado', aprovadoEm: new Date(), aprovadoPor: usuarioId }),
  });
  transicao('/:id/recusar', aprovar, {
    de: ['emitido', 'enviado'],
    acao: 'recusar',
    evento: 'recusado',
    valores: (usuarioId, motivo) => ({
      status: 'recusado',
      recusadoEm: new Date(),
      recusadoPor: usuarioId,
      motivoRecusa: motivo,
    }),
    detalhe: (motivo) => motivo ?? undefined,
  });
  transicao('/:id/cancelar', editar, {
    de: ['rascunho', 'emitido', 'enviado'],
    acao: 'cancelar',
    evento: 'cancelado',
    valores: (usuarioId, motivo) => ({
      status: 'cancelado',
      canceladoEm: new Date(),
      canceladoPor: usuarioId,
      motivoCancelamento: motivo,
    }),
    detalhe: (motivo) => motivo ?? undefined,
  });

  /**
   * Nova versão de um orçamento emitido ou enviado: outro registro, mesmo número, versão + 1, ligado ao anterior,
   * que é cancelado na mesma transação. Nasce rascunho com os mesmos itens e preços (recalculados ao abrir, se de
   * outro dia) e validade em branco.
   */
  app.post(
    '/:id/nova-versao',
    {
      ...editar,
      schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: { 201: orcamentoSchema } },
    },
    async (req, reply) => {
      const nova = await withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['emitido', 'enviado'], 'gerar uma nova versão');
        const proxima = atual.versaoOrcamento + 1;
        await tx
          .update(orcamentos)
          .set({
            status: 'cancelado',
            canceladoEm: new Date(),
            canceladoPor: req.user.sub,
            motivoCancelamento: `Substituído pela versão ${proxima}.`,
            atualizadoPor: req.user.sub,
            versao: atual.versao + 1,
          })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'cancelado', req.user.sub, `Substituído pela versão ${proxima}.`);

        const [{ id }] = (await tx
          .insert(orcamentos)
          .values({
            numero: atual.numero,
            versaoOrcamento: proxima,
            orcamentoOrigemId: atual.id,
            clienteId: atual.clienteId,
            veiculoId: atual.veiculoId,
            vendedorId: atual.vendedorId,
            tabelaPrecoId: atual.tabelaPrecoId,
            precosEm: atual.precosEm,
            observacoes: atual.observacoes,
            subtotalCentavos: atual.subtotalCentavos,
            descontoCentavos: atual.descontoCentavos,
            totalCentavos: atual.totalCentavos,
            criadoPor: req.user.sub,
            atualizadoPor: req.user.sub,
          })
          .returning({ id: orcamentos.id })) as [{ id: string }];
        const itens = await itensDoOrcamento(tx, atual.id);
        await gravarItens(
          tx,
          id,
          itens.map(({ tenantId: _t, orcamentoId: _o, id: _id, ...i }) => ({ ...i, id: randomUUID() })),
        );
        await registrar(
          tx,
          id,
          'nova_versao',
          req.user.sub,
          `Gerada a partir da versão ${atual.versaoOrcamento} (${formatarNumeroOrcamento(atual.numero)}).`,
        );
        return carregar(tx, id);
      });
      return reply.code(201).send(nova);
    },
  );
};
