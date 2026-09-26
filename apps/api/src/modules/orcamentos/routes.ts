import { randomUUID } from 'node:crypto';
import {
  calcularMargem,
  clienteParaOrcamentoFiltroSchema,
  clienteParaOrcamentoSchema,
  contextoClienteSchema,
  dentroDaAlcada,
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
  percentualDoItem,
  formatarPercentual,
  situacaoOrcamento,
  SITUACOES_ORCAMENTO,
  somarDias,
  somarItens,
  temAcesso,
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
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Tx } from '../../db/client.js';
import {
  aprovacoesComerciais,
  clienteEnderecos,
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
import {
  alcadaDoUsuario,
  cancelarAprovacao,
  pendenteDoDocumento,
  solicitarAprovacao,
} from '../../lib/aprovacao-comercial.js';
import { buscaDeMaterial, buscaDeServico, nomeUsuario } from '../../lib/cadastro.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';
import { buscaDeCliente } from '../clientes/routes.js';
import { snapshotDoOrcamento } from './aprovacao.js';
import {
  descreverDescontos,
  gravarItens,
  itensDoOrcamento,
  montarItens,
  precosDoDia,
  recalcularDoDia,
  registrar,
} from './regras.js';

type Gravado = typeof orcamentos.$inferSelect;

/** Emitido/enviado vence sozinho depois do dia seguinte ao da validade (a mesma regra de situacaoOrcamento). */
const vencidoSql = (hoje: string) =>
  sql`(${orcamentos.status} in ('emitido', 'enviado') and ${orcamentos.validadeAte} + 1 < ${hoje}::date)`;
export const situacaoSql = (hoje: string) =>
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

/**
 * Orçamento completo. `dono`: vendedor que só enxerga os próprios (req.user.vendedorId); de outro vendedor, 404.
 */
async function carregar(tx: Tx, id: string, dono: string | null, avisos: string[] = []): Promise<Orcamento> {
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
    .where(and(eq(orcamentos.id, id), dono ? eq(orcamentos.vendedorId, dono) : undefined));
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
    .where(and(eq(orcamentos.numero, o.numero), dono ? eq(orcamentos.vendedorId, dono) : undefined))
    .orderBy(desc(orcamentos.versaoOrcamento));
  const [aprovacao] = await tx
    .select({
      id: aprovacoesComerciais.id,
      status: aprovacoesComerciais.status,
      percentual: aprovacoesComerciais.percentual,
      alcadaSolicitante: aprovacoesComerciais.alcadaSolicitante,
      solicitanteId: aprovacoesComerciais.solicitanteId,
      solicitante: nomeUsuario('aprovacoes_comerciais', 'solicitante_id'),
      solicitanteFuncao: aprovacoesComerciais.solicitanteFuncao,
      criadoEm: aprovacoesComerciais.criadoEm,
      decisor: nomeUsuario('aprovacoes_comerciais', 'decidido_por'),
      decisorFuncao: aprovacoesComerciais.decisorFuncao,
      alcadaDecisor: aprovacoesComerciais.alcadaDecisor,
      decididoEm: aprovacoesComerciais.decididoEm,
      justificativa: aprovacoesComerciais.justificativa,
    })
    .from(aprovacoesComerciais)
    .where(eq(aprovacoesComerciais.orcamentoId, id))
    .orderBy(desc(aprovacoesComerciais.criadoEm))
    .limit(1);

  const { cliente, veiculoId, veiculoPlaca, veiculoMarca, veiculoModelo, ...resto } = o;
  return {
    ...resto,
    clienteNome: cliente.nome,
    vendedorNome: o.vendedor.nome,
    cliente: { id: cliente.id, nome: cliente.nome, ativo: cliente.ativo, pendencias: pendencias(cliente) },
    veiculo: veiculoId ? { id: veiculoId, placa: veiculoPlaca!, marca: veiculoMarca!, modelo: veiculoModelo! } : null,
    veiculoPlaca,
    // O PMC congelado no item é interno (margem da aprovação): nunca vai na resposta do orçamento.
    itens: itens.map(({ tenantId: _t, orcamentoId: _o, pmcCentavos: _pmc, descontoPercentual, quantidade, ...i }) => ({
      ...i,
      quantidade: quantidade == null ? null : Number(quantidade),
      descontoPercentual: descontoPercentual == null ? null : descontoPercentual / 100,
    })),
    aprovacaoComercial: aprovacao ? { ...aprovacao, solicitante: aprovacao.solicitante ?? '' } : null,
    eventos,
    versoes,
    avisos,
  };
}

/** Lê o orçamento travando a linha até o fim da transação (transições e edição não se atropelam). */
async function travar(tx: Tx, id: string, dono: string | null): Promise<Gravado> {
  const [o] = await tx
    .select()
    .from(orcamentos)
    .where(and(eq(orcamentos.id, id), dono ? eq(orcamentos.vendedorId, dono) : undefined))
    .for('update');
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
    throw new ErroHttp(
      409,
      `Orçamento ${SITUACOES_ORCAMENTO[atual].toLowerCase()}: não é possível ${acao}. Recarregue a página.`,
    );
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

/** "1 item" / "2 itens" acima da alçada. */
const itensAcima = (percentuais: number[], alcada: number) => {
  const n = percentuais.filter((p) => !dentroDaAlcada(p, alcada)).length;
  return `${n} ${n === 1 ? 'item' : 'itens'}`;
};

const resumoDoTotal = (itens: number, total: number) => `${itens} item(ns), total ${formatarMoeda(total)}.`;

/** Orçamentos (menu Orçamentos). Consultar: módulo Orçamentos; alterar: Editar; aprovar/recusar: Aprovar orçamentos. */
export const orcamentosRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);
  // Entra quem consulta orçamentos pela matriz, o Administrador e o vendedor ativo (este, só nos próprios).
  app.addHook('onRequest', async (req) => {
    if (!req.user.admin && !req.user.vendedorId && !temAcesso(req.user.acessos, 'orcamentos'))
      throw new ErroHttp(403, 'Você não tem permissão para esta ação.');
  });
  // Alterar (criar, editar, emitir, enviar, nova versão, cancelar): só o Administrador e o vendedor, nos próprios.
  // Os demais só consultam, mesmo com "Editar" em Orçamentos na matriz (decisão de 25/09/2026).
  const editar = {
    onRequest: async (req: FastifyRequest) => {
      if (!req.user.admin && !req.user.vendedorId)
        throw new ErroHttp(403, 'Só o Administrador e os vendedores criam e alteram orçamentos.');
    },
  };
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
    async (req) => {
      const { q, ativo, tipo, pagina, porPagina } = req.query;
      const onde = and(
        q ? buscaDeCliente(q) : undefined,
        ativo ? eq(clientes.ativo, ativo === 'true') : undefined,
        tipo ? eq(clientes.tipo, tipo) : undefined,
      );
      return withTenant(req.user.tid, async (tx) => {
        const lista = await tx
          .select(colunasClienteParaOrcamento)
          .from(clientes)
          .where(onde)
          .orderBy(asc(clientes.nome), asc(clientes.id))
          .limit(porPagina)
          .offset((pagina - 1) * porPagina);
        const [{ total }] = (await tx.select({ total: count() }).from(clientes).where(onde)) as [{ total: number }];
        return { itens: lista.map(paraClienteParaOrcamento), total };
      });
    },
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
        if (!ultimos.length) return [];
        const lista = await tx
          .select(colunasClienteParaOrcamento)
          .from(clientes)
          .where(
            inArray(
              clientes.id,
              ultimos.map((u) => u.clienteId),
            ),
          );
        const porId = new Map(lista.map((c) => [c.id, c]));
        return ultimos.flatMap((u) => {
          const c = porId.get(u.clienteId);
          return c ? [paraClienteParaOrcamento(c)] : [];
        });
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
      const { q, tabelaPrecoId, tipo } = req.query;
      return withTenant(req.user.tid, async (tx) => {
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
                .where(and(eq(materiais.ativo, true), eq(materiais.permiteVenda, true), buscaDeMaterial(q)))
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

  /**
   * Emissão: conteúdo congelado. Validade vazia = 7 dias; de hoje até no máximo 30 dias. Desconto acima da alçada
   * de quem emite: vai para "aguardando aprovação comercial" (docs/modulos/APROVACAO_COMERCIAL.md) e só é emitido
   * quando aprovado, com a validade contando da aprovação.
   */
  app.post(
    '/:id/emitir',
    { ...editar, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['rascunho'], 'emitir');
        exigirPrecosDoDia(atual);
        const [{ itens }] = (await tx
          .select({ itens: count() })
          .from(orcamentoItens)
          .where(eq(orcamentoItens.orcamentoId, atual.id))) as [{ itens: number }];
        if (!itens) throw new ErroHttp(400, 'Inclua ao menos um produto ou serviço antes de emitir.');
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

        // Alçada por item, nunca pelo total (25/09/2026): vale o maior desconto entre os itens.
        const gravados = await itensDoOrcamento(tx, atual.id);
        const percentuais = gravados.map((i) =>
          percentualDoItem(i.precoTabelaCentavos, i.precoUnitarioCentavos, i.descontoPercentual),
        );
        const percentual = Math.max(0, ...percentuais);
        const alcada = await alcadaDoUsuario(tx, req.user.sub);
        if (!dentroDaAlcada(percentual, alcada.percentual)) {
          const orcamento = await carregar(tx, atual.id, null);
          const validadeDias = (Date.parse(validadeAte) - Date.parse(hoje)) / 86_400_000;
          await solicitarAprovacao(tx, {
            tipoDocumento: 'orcamento',
            documentoId: atual.id,
            documentoNumero: formatarNumeroOrcamento(atual.numero),
            documentoVersao: atual.versaoOrcamento,
            clienteNome: orcamento.cliente.nome,
            subtotalCentavos: atual.subtotalCentavos,
            descontoCentavos: atual.descontoCentavos,
            totalCentavos: atual.totalCentavos,
            percentual,
            solicitanteId: req.user.sub,
            alcada,
            // Margem para o aprovador: PMC congelado nos itens e preço líquido negociado, calculada agora.
            snapshot: {
              ...snapshotDoOrcamento(orcamento, validadeDias, alcada.percentual),
              margem: calcularMargem(
                gravados.map((i) => ({
                  tipo: i.tipo,
                  quantidade: i.quantidade == null ? null : Number(i.quantidade),
                  brutoCentavos: i.brutoCentavos,
                  totalCentavos: i.totalCentavos,
                  pmcCentavos: i.pmcCentavos,
                })),
              ),
            },
          });
          await tx
            .update(orcamentos)
            .set({ status: 'aguardando_aprovacao_comercial', atualizadoPor: req.user.sub, versao: atual.versao + 1 })
            .where(eq(orcamentos.id, atual.id));
          await registrar(
            tx,
            atual.id,
            'aprovacao_comercial_solicitada',
            req.user.sub,
            `${itensAcima(percentuais, alcada.percentual)}: desconto de até ${formatarPercentual(percentual)}, acima da ` +
              `alçada de ${formatarPercentual(alcada.percentual)}${alcada.funcao ? ` (${alcada.funcao})` : ''}.`,
          );
          return carregar(tx, atual.id, req.user.vendedorId);
        }
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
        return carregar(tx, atual.id, req.user.vendedorId);
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
      /** Efeito extra na mesma transação (ex.: cancelar a aprovação comercial pendente). */
      depois?: (tx: Tx, atual: Gravado, usuarioId: string) => Promise<void>;
    },
  ) =>
    app.post(
      rota,
      { ...opcoes, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
      async (req) =>
        withTenant(req.user.tid, async (tx) => {
          const atual = await travar(tx, req.params.id, req.user.vendedorId);
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
          await regra.depois?.(tx, atual, req.user.sub);
          return carregar(tx, atual.id, req.user.vendedorId);
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
    de: ['rascunho', 'aguardando_aprovacao_comercial', 'reprovado_comercialmente', 'emitido', 'enviado'],
    acao: 'cancelar',
    evento: 'cancelado',
    valores: (usuarioId, motivo) => ({
      status: 'cancelado',
      canceladoEm: new Date(),
      canceladoPor: usuarioId,
      motivoCancelamento: motivo,
    }),
    detalhe: (motivo) => motivo ?? undefined,
    depois: async (tx, atual, usuarioId) => {
      const pendente = await pendenteDoDocumento(tx, 'orcamento', atual.id);
      if (pendente) await cancelarAprovacao(tx, pendente, usuarioId, 'Orçamento cancelado.');
    },
  });

  /**
   * Retira o pedido de aprovação comercial: só quem pediu. O orçamento volta a rascunho para corrigir o desconto
   * (e, se os preços forem de outro dia, é recalculado ao abrir).
   */
  app.post(
    '/:id/retirar-aprovacao',
    { ...editar, schema: { params: idParamSchema, body: transicaoOrcamentoSchema, response: resposta } },
    async (req) =>
      withTenant(req.user.tid, async (tx) => {
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['aguardando_aprovacao_comercial'], 'retirar o pedido de aprovação');
        const pendente = await pendenteDoDocumento(tx, 'orcamento', atual.id);
        if (!pendente) throw new ErroHttp(409, 'Não há pedido de aprovação pendente. Recarregue a página.');
        if (pendente.solicitanteId !== req.user.sub)
          throw new ErroHttp(403, 'Só quem pediu a aprovação comercial pode retirá-la.');
        await cancelarAprovacao(tx, pendente, req.user.sub, 'Pedido retirado pelo solicitante.');
        await tx
          .update(orcamentos)
          .set({ status: 'rascunho', atualizadoPor: req.user.sub, versao: atual.versao + 1 })
          .where(eq(orcamentos.id, atual.id));
        await registrar(tx, atual.id, 'aprovacao_comercial_retirada', req.user.sub, 'Voltou a rascunho.');
        return carregar(tx, atual.id, req.user.vendedorId);
      }),
  );

  /**
   * Nova versão de um orçamento emitido, enviado ou reprovado comercialmente: outro registro, mesmo número, versão + 1, ligado ao anterior,
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
        const atual = await travar(tx, req.params.id, req.user.vendedorId);
        exigirVersaoLida(atual, req.body.versao);
        exigirSituacao(atual, ['emitido', 'enviado', 'reprovado_comercialmente'], 'gerar uma nova versão');
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
        return carregar(tx, id, req.user.vendedorId);
      });
      return reply.code(201).send(nova);
    },
  );
};
