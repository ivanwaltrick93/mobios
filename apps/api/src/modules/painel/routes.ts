import {
  type AlertaPainel,
  DIAS_ANIVERSARIO_SEMANA,
  hojeIso,
  type Indicador,
  janelaDeAniversarios,
  type Painel,
  painelQuerySchema,
  painelSchema,
  type PeriodoPainel,
  SITUACOES_OS_EM_ABERTO,
  somarDias,
  temAcesso,
} from '@mobios/shared';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/client.js';
import { chaveDaOficina, obterOuCarregar, PRAZOS_CACHE, resumoParaChave } from '../../lib/cache.js';
import { clientes, orcamentos, ordensServico, users, veiculos, vendedores } from '../../db/schema.js';
import { contarPendentes } from '../aprovacoes-comerciais/routes.js';
import { aniversarioNaJanela, diasNaJanela } from '../clientes/routes.js';
import { situacaoSql } from '../orcamentos/consulta.js';
import { filtroVisiveis, podeVerOs } from '../ordens-servico/regras.js';

const FUSO = 'America/Sao_Paulo';

/**
 * Instante dentro das datas do período (inclusivas, dia de Brasília). Comparado como intervalo de instantes, sem
 * converter a coluna: assim o filtro usa o índice de criado_em (docs/performance/DATABASE.md §Painel).
 */
const noPeriodo = (coluna: PgColumn, p: { inicio: string; fim: string }): SQL =>
  sql`${coluna} >= ${p.inicio}::date::timestamp at time zone ${FUSO}
    and ${coluna} < (${p.fim}::date + 1)::timestamp at time zone ${FUSO}`;

/**
 * Período pedido e o anterior, de mesmo tamanho (datas inclusivas, Brasília). "Este mês" vai do dia 1 até hoje e
 * compara com os mesmos N dias imediatamente antes.
 */
function periodos(periodo: PeriodoPainel) {
  const hoje = hojeIso();
  const inicio =
    periodo === 'hoje'
      ? hoje
      : periodo === '7d'
        ? somarDias(hoje, -6)
        : periodo === '30d'
          ? somarDias(hoje, -29)
          : `${hoje.slice(0, 8)}01`;
  const dias = Math.round((Date.parse(hoje) - Date.parse(inicio)) / 86_400_000) + 1;
  return {
    atual: { inicio, fim: hoje },
    anterior: { inicio: somarDias(inicio, -dias), fim: somarDias(inicio, -1) },
  };
}

/** Variação % do período atual sobre o anterior (1 casa); sem base (anterior zero), null. */
const variacao = (atual: number, anterior: number) =>
  anterior === 0 ? null : Math.round(((atual - anterior) / anterior) * 1000) / 10;

const contar = (condicao: SQL) => sql<number>`count(*) filter (where ${condicao})`.mapWith(Number);
const somar = (coluna: PgColumn, condicao: SQL) =>
  sql<number>`coalesce(sum(${coluna}) filter (where ${condicao}), 0)`.mapWith(Number);

/**
 * Página inicial: indicadores do período com variação, gráficos de orçamentos e alertas, calculados a partir do
 * banco (isolados por oficina via RLS). Cada bloco só vem para quem acessa o módulo dele. Indicadores de módulos
 * ainda não implementados voltam com valor null — a tela mostra "em breve".
 */
export const painelRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.autenticar);

  app.get(
    '/',
    { schema: { querystring: painelQuerySchema, response: { 200: painelSchema } } },
    async (req): Promise<Painel> => {
      // Cache de até PRAZOS_CACHE.painel segundos (docs/decisoes/0001-redis-cache-de-leitura.md). O Painel monta os
      // blocos conforme o acesso de quem pede: o perfil (admin, acessos e vendedor) entra na chave, e nenhum perfil
      // recebe o Painel de outro. Mudar as permissões de alguém muda a chave dele na hora.
      const perfil = resumoParaChave({
        admin: req.user.admin,
        acessos: req.user.acessos,
        vendedorId: req.user.vendedorId,
        // O mecânico vê só as O.S. dele: o número de O.S. em aberto é do usuário, não do perfil.
        mecanico: req.user.mecanico ? req.user.sub : null,
      });
      const chave = chaveDaOficina(req.user.tid, 'painel', 'v1', hojeIso(), req.query.periodo, perfil);
      return obterOuCarregar(chave, PRAZOS_CACHE.painel, () => carregarPainel(req), req.log);
    },
  );
};

/** Indicadores, gráficos, alertas e aniversariantes da oficina, lidos do banco (isolados por oficina via RLS). */
const carregarPainel = (req: FastifyRequest<{ Querystring: { periodo: PeriodoPainel } }>): Promise<Painel> =>
  withTenant(req.user.tid, async (tx) => {
    const { atual, anterior } = periodos(req.query.periodo);
    const acessa = (modulo: Parameters<typeof temAcesso>[1]) => temAcesso(req.user.acessos, modulo);

    const [c] = await tx
      .select({
        total: count(),
        novos: contar(noPeriodo(clientes.criadoEm, atual)),
        novosAntes: contar(noPeriodo(clientes.criadoEm, anterior)),
      })
      .from(clientes);
    // "not exists" fora do count(*) filter: assim o Postgres faz uma junção anti (uma passada em cada tabela) em
    // vez de uma subconsulta por cliente. Correlação escrita à mão: dentro da subconsulta o Drizzle não qualifica
    // as colunas e "id" seria o do veículo, não o do cliente.
    const [{ semVeiculo }] = (await tx
      .select({ semVeiculo: count() })
      .from(clientes)
      .where(sql`not exists (select 1 from veiculos v where v.cliente_id = "clientes"."id")`)) as [
      { semVeiculo: number },
    ];
    // Faltando campo obrigatório (cadastros antigos): não poderão abrir O.S. até serem completados.
    const [{ incompletos }] = (await tx.execute(sql`select count(*)::int as incompletos from (
            select id from clientes where cpf_cnpj is null or telefone is null or whatsapp is null
            union select c.id from clientes c
              where not exists (select 1 from cliente_enderecos e where e.cliente_id = c.id)
            union select c.id from clientes c
              where c.tipo = 'PJ' and not exists (select 1 from cliente_responsaveis r where r.cliente_id = c.id)
          ) x`)) as unknown as [{ incompletos: number }];
    const [v] = await tx
      .select({
        total: count(),
        novos: contar(noPeriodo(veiculos.criadoEm, atual)),
        novosAntes: contar(noPeriodo(veiculos.criadoEm, anterior)),
        incompletos: contar(sql`${veiculos.anoFabricacao} is null or ${veiculos.anoModelo} is null`),
      })
      .from(veiculos);

    const indicadores: Indicador[] = [
      {
        id: 'clientes',
        titulo: 'Clientes',
        valor: c!.total,
        formato: 'numero',
        detalhe: `${c!.novos} novo(s) no período`,
        variacao: variacao(c!.novos, c!.novosAntes),
        link: '/clientes',
      },
      {
        id: 'veiculos',
        titulo: 'Veículos',
        valor: v!.total,
        formato: 'numero',
        detalhe: `${v!.novos} novo(s) no período`,
        variacao: variacao(v!.novos, v!.novosAntes),
        link: '/veiculos',
      },
    ];

    let orcamentosPorSituacao: Painel['orcamentosPorSituacao'] = null;
    let aprovadosPorVendedor: Painel['aprovadosPorVendedor'] = null;
    // O vendedor (não Administrador) vê os números dos próprios orçamentos; os demais, da oficina inteira.
    if (acessa('orcamentos') || req.user.vendedorId) {
      const meus = req.user.vendedorId ? eq(orcamentos.vendedorId, req.user.vendedorId) : undefined;
      // Orçamentos novos contam pela 1ª versão (as versões seguintes são o mesmo orçamento).
      const primeira = eq(orcamentos.versaoOrcamento, 1);
      const aprovadoEm = (p: typeof atual) =>
        sql`${orcamentos.status} = 'aprovado' and ${noPeriodo(orcamentos.aprovadoEm, p)}`;
      const recusadoEm = (p: typeof atual) =>
        sql`${orcamentos.status} = 'recusado' and ${noPeriodo(orcamentos.recusadoEm, p)}`;
      const [o] = await tx
        .select({
          criados: contar(and(primeira, noPeriodo(orcamentos.criadoEm, atual))!),
          criadosAntes: contar(and(primeira, noPeriodo(orcamentos.criadoEm, anterior))!),
          aprovados: contar(aprovadoEm(atual)),
          aprovadosAntes: contar(aprovadoEm(anterior)),
          valorAprovado: somar(orcamentos.totalCentavos, aprovadoEm(atual)),
          valorAprovadoAntes: somar(orcamentos.totalCentavos, aprovadoEm(anterior)),
          recusados: contar(recusadoEm(atual)),
          recusadosAntes: contar(recusadoEm(anterior)),
        })
        .from(orcamentos)
        .where(meus);
      const ticket = (valor: number, n: number) => (n ? Math.round(valor / n) : 0);
      const taxa = (aprovados: number, recusados: number) =>
        aprovados + recusados ? Math.round((aprovados / (aprovados + recusados)) * 1000) / 10 : null;
      const taxaAtual = taxa(o!.aprovados, o!.recusados);
      const taxaAntes = taxa(o!.aprovadosAntes, o!.recusadosAntes);
      indicadores.push(
        {
          id: 'orcamentos',
          titulo: 'Orçamentos',
          valor: o!.criados,
          formato: 'numero',
          detalhe: 'criados no período',
          variacao: variacao(o!.criados, o!.criadosAntes),
          link: '/orcamentos',
        },
        {
          id: 'valor_aprovado',
          titulo: 'Valor aprovado',
          valor: o!.valorAprovado,
          formato: 'moeda',
          detalhe: `${o!.aprovados} orçamento(s) aprovado(s)`,
          variacao: variacao(o!.valorAprovado, o!.valorAprovadoAntes),
          link: '/orcamentos?situacao=aprovado',
        },
        {
          id: 'ticket_medio',
          titulo: 'Ticket médio',
          valor: ticket(o!.valorAprovado, o!.aprovados),
          formato: 'moeda',
          detalhe: 'por orçamento aprovado',
          variacao: variacao(ticket(o!.valorAprovado, o!.aprovados), ticket(o!.valorAprovadoAntes, o!.aprovadosAntes)),
        },
        {
          id: 'taxa_aprovacao',
          titulo: 'Taxa de aprovação',
          valor: taxaAtual,
          formato: 'percentual',
          detalhe: taxaAtual === null ? 'sem aprovações ou recusas' : 'aprovados ÷ (aprovados + recusados)',
          variacao: taxaAtual !== null && taxaAntes !== null ? variacao(taxaAtual, taxaAntes) : null,
        },
      );

      const hoje = hojeIso();
      orcamentosPorSituacao = await tx
        .select({
          situacao: situacaoSql(hoje),
          quantidade: count(),
          totalCentavos: sql<number>`coalesce(sum(${orcamentos.totalCentavos}), 0)`.mapWith(Number),
        })
        .from(orcamentos)
        .where(and(noPeriodo(orcamentos.criadoEm, atual), meus))
        // Pela 1ª coluna: a expressão tem parâmetros, e repeti-la no GROUP BY não casaria com a do SELECT.
        .groupBy(sql`1`);
      aprovadosPorVendedor = await tx
        .select({
          vendedor: users.nome,
          quantidade: count(),
          totalCentavos: sql<number>`sum(${orcamentos.totalCentavos})`.mapWith(Number),
        })
        .from(orcamentos)
        .innerJoin(vendedores, eq(vendedores.id, orcamentos.vendedorId))
        .innerJoin(users, eq(users.id, vendedores.usuarioId))
        .where(and(aprovadoEm(atual), meus))
        .groupBy(users.nome)
        .orderBy(desc(sql`sum(${orcamentos.totalCentavos})`))
        .limit(5);
    }

    // O.S. ainda na oficina, das que o usuário vê (o mecânico, só as vinculadas a ele).
    if (podeVerOs(req.user)) {
      const [{ abertas }] = (await tx
        .select({ abertas: count() })
        .from(ordensServico)
        .where(and(inArray(ordensServico.status, SITUACOES_OS_EM_ABERTO), filtroVisiveis(req.user)))) as [
        { abertas: number },
      ];
      indicadores.push({
        id: 'os_abertas',
        titulo: 'O.S. em aberto',
        valor: abertas,
        formato: 'numero',
        detalhe: 'na oficina agora',
        variacao: null,
        link: '/os',
      });
    }
    // Faturamento só para quem acessa o financeiro.
    if (acessa('financeiro'))
      indicadores.push({
        id: 'faturamento',
        titulo: 'Faturamento',
        valor: null,
        formato: 'moeda',
        detalhe: 'Disponível com o módulo Financeiro',
        variacao: null,
      });

    const alertas: AlertaPainel[] = [];
    const pendentes = acessa('aprovacao_comercial') ? await contarPendentes(tx, req) : 0;
    if (pendentes > 0) {
      alertas.push({
        nivel: 'aviso',
        mensagem: `${pendentes} aprovação(ões) comercial(is) de desconto aguardando decisão.`,
        link: '/aprovacoes-comerciais',
      });
    }
    if (incompletos > 0) {
      alertas.push({
        nivel: 'aviso',
        mensagem: `${incompletos} cliente(s) com cadastro incompleto: complete antes de abrir O.S.`,
        link: '/clientes',
      });
    }
    if (v!.incompletos > 0) {
      alertas.push({
        nivel: 'aviso',
        mensagem: `${v!.incompletos} veículo(s) com cadastro incompleto (ano de fabricação ou modelo): complete antes de abrir O.S.`,
        link: '/clientes',
      });
    }
    if (semVeiculo > 0) {
      alertas.push({
        nivel: 'info',
        mensagem: `${semVeiculo} cliente(s) sem veículo cadastrado.`,
        link: '/clientes',
      });
    }

    // Aniversariantes (PF ativos) de hoje e da semana: relacionamento mais pessoal no atendimento.
    const janela = janelaDeAniversarios(hojeIso(), DIAS_ANIVERSARIO_SEMANA);
    const dias = diasNaJanela(janela);
    const aniversariantes = acessa('clientes')
      ? await tx
          .select({ id: clientes.id, nome: clientes.nome, whatsapp: clientes.whatsapp, dias })
          .from(clientes)
          .where(and(eq(clientes.tipo, 'PF'), eq(clientes.ativo, true), aniversarioNaJanela(janela)))
          .orderBy(asc(dias), asc(clientes.nome))
          .limit(30)
      : [];

    return {
      periodo: { id: req.query.periodo, ...atual },
      indicadores,
      orcamentosPorSituacao,
      aprovadosPorVendedor,
      alertas,
      aniversariantes,
      modulosPendentes: ['O.S. atrasadas', 'Estoque abaixo do mínimo', 'Contas a vencer'],
      atualizadoEm: new Date().toISOString(),
    };
  });
