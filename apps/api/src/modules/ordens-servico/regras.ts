import { randomUUID } from 'node:crypto';
import {
  arredondarQuantidade,
  calcularItem,
  dentroDaAlcada,
  formatarPercentual,
  hojeIso,
  paraMilesimos,
  pendenciasCliente,
  pendenciasVeiculo,
  percentualDoItem,
  temAcesso,
  UNIDADES,
  type EventoOs,
  type ItemOrcamentoDados,
  type ItemOsDados,
  type SituacaoOs,
} from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Tx } from '../../db/client.js';
import { clientes, ordensServico, osEventos, osItens, veiculos, vendedores } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';
import { temEndereco, temResponsavel } from '../clientes/routes.js';
import { montarItens } from '../orcamentos/regras.js';

// Regras da O.S. (docs/modulos/ORDENS_SERVICO.md): quem vê e altera, abertura, itens, alçada e histórico.

export type OsGravada = typeof ordensServico.$inferSelect;
export type ItemOsGravado = typeof osItens.$inferSelect;
export type LinhaOs = Omit<typeof osItens.$inferInsert, 'tenantId' | 'ordemServicoId'> & { id: string };
type Usuario = FastifyRequest['user'];

// ---------- Quem vê e quem altera (§7) ----------

/** Entra no módulo: Administrador, qualquer vendedor ou quem consulta O.S. na matriz. */
export const podeVerOs = (u: Usuario) => u.admin || !!u.vendedorId || temAcesso(u.acessos, 'os');

/** O mecânico (sem ser Administrador nem vendedor) só vê as O.S. vinculadas a ele; os demais, todas. */
export const filtroVisiveis = (u: Usuario) =>
  u.mecanico
    ? sql`exists (select 1 from os_mecanicos m where m.ordem_servico_id = ${ordensServico.id}
        and m.usuario_id = ${u.sub})`
    : undefined;

export const podeAbrirOs = (u: Usuario) => u.admin || temAcesso(u.acessos, 'os', 'editar');

/** Altera itens, mecânicos e situação: "O.S. editar", ou o vendedor da O.S. (convertida do orçamento dele). */
export const podeAlterarOs = (u: Usuario, os: Pick<OsGravada, 'vendedorId'>) =>
  u.admin || temAcesso(u.acessos, 'os', 'editar') || (!!u.vendedorId && os.vendedorId === u.vendedorId);

/** Produto do catálogo e peça avulsa exigem também "Peças na O.S." (OS-R16). */
export const podeProdutosOs = (u: Usuario) => u.admin || temAcesso(u.acessos, 'pecas_os', 'editar');

export function exigirAlterar(u: Usuario, os: OsGravada) {
  if (!podeAlterarOs(u, os)) throw new ErroHttp(403, 'Você não tem permissão para alterar esta O.S.');
}

// ---------- Histórico ----------

/** Evento da O.S. clock_timestamp: dois eventos da mesma transação ficam na ordem em que aconteceram. */
export const registrarOs = (
  tx: Tx,
  ordemServicoId: string,
  evento: EventoOs,
  usuarioId: string,
  extra: { detalhe?: string | null; de?: SituacaoOs; para?: SituacaoOs } = {},
) =>
  tx.insert(osEventos).values({
    ordemServicoId,
    evento,
    usuarioId,
    detalhe: extra.detalhe || null,
    situacaoAnterior: extra.de ?? null,
    situacaoNova: extra.para ?? null,
    criadoEm: sql`clock_timestamp()`,
  });

// ---------- Abertura (OS-02) ----------

/**
 * Confere cliente, veículo e vendedor para abrir a O.S. (balcão ou conversão): cliente ativo e com o cadastro
 * completo; veículo do cliente, ativo e completo; vendedor ativo. Erro 400 com o motivo.
 */
export async function validarAbertura(tx: Tx, d: { clienteId: string; veiculoId: string; vendedorId: string | null }) {
  const [c] = await tx
    .select({
      nome: clientes.nome,
      ativo: clientes.ativo,
      tipo: clientes.tipo,
      cpfCnpj: clientes.cpfCnpj,
      telefone: clientes.telefone,
      whatsapp: clientes.whatsapp,
      temEndereco,
      temResponsavel,
    })
    .from(clientes)
    .where(eq(clientes.id, d.clienteId));
  if (!c) throw new ErroHttp(400, 'Cliente não encontrado.', { clienteId: 'Cliente não encontrado' });
  if (!c.ativo)
    throw new ErroHttp(400, `O cliente ${c.nome} está inativo: reative-o para abrir a O.S.`, {
      clienteId: 'Cliente inativo',
    });
  const faltaCliente = pendenciasCliente(c, c.temEndereco, c.temResponsavel);
  if (faltaCliente.length)
    throw new ErroHttp(400, `Complete o cadastro do cliente antes de abrir a O.S.: falta ${faltaCliente.join(', ')}.`, {
      clienteId: 'Cadastro incompleto',
    });

  const [v] = await tx
    .select({
      clienteId: veiculos.clienteId,
      placa: veiculos.placa,
      status: veiculos.status,
      anoFabricacao: veiculos.anoFabricacao,
      anoModelo: veiculos.anoModelo,
    })
    .from(veiculos)
    .where(eq(veiculos.id, d.veiculoId));
  if (v?.clienteId !== d.clienteId)
    throw new ErroHttp(400, 'O veículo escolhido não é deste cliente.', { veiculoId: 'Veículo de outro cliente' });
  if (v.status !== 'ativo')
    throw new ErroHttp(
      400,
      `O veículo ${v.placa} está ${v.status === 'vendido' ? 'vendido' : 'inativo'}: reative-o para abrir a O.S.`,
      { veiculoId: 'Veículo não está ativo' },
    );
  const faltaVeiculo = pendenciasVeiculo(v);
  if (faltaVeiculo.length)
    throw new ErroHttp(400, `Complete o cadastro do veículo antes de abrir a O.S.: falta ${faltaVeiculo.join(', ')}.`, {
      veiculoId: 'Cadastro incompleto',
    });

  if (d.vendedorId) {
    const [vendedor] = await tx
      .select({ ativo: vendedores.ativo })
      .from(vendedores)
      .where(eq(vendedores.id, d.vendedorId));
    if (!vendedor?.ativo)
      throw new ErroHttp(400, 'Escolha um vendedor ativo.', { vendedorId: 'Escolha um vendedor ativo' });
  }
}

/** Ao abrir a O.S.: última visita hoje e km atual = o maior entre o atual e o de entrada (OS-R18). */
export const atualizarVeiculoNaAbertura = (tx: Tx, veiculoId: string, kmEntrada: number) =>
  tx
    .update(veiculos)
    .set({
      ultimaVisita: hojeIso(),
      kmAtual: sql`greatest(coalesce(${veiculos.kmAtual}, 0), ${kmEntrada})`,
    })
    .where(eq(veiculos.id, veiculoId));

/** Previsão de entrega digitada ("2026-09-30T17:30", hora de Brasília) como instante. */
export const previsaoComoInstante = (previsao: string | null) =>
  previsao ? sql`${previsao}::timestamp at time zone 'America/Sao_Paulo'` : null;

export type DadosAbertura = {
  clienteId: string;
  veiculoId: string;
  vendedorId: string | null;
  orcamentoId: string | null;
  tabelaPrecoId: string;
  kmEntrada: number;
  relatoCliente: string | null;
  previsaoEntrega: string | null;
};

/**
 * Cria a O.S. `aberta` (número pelo banco, na mesma transação), atualiza o veículo e registra a abertura. As
 * validações da abertura (`validarAbertura`) são feitas antes por quem chama.
 */
export async function abrirOs(tx: Tx, d: DadosAbertura, usuarioId: string, detalhe: string | null): Promise<string> {
  const [{ id }] = (await tx
    .insert(ordensServico)
    .values({
      clienteId: d.clienteId,
      veiculoId: d.veiculoId,
      vendedorId: d.vendedorId,
      orcamentoId: d.orcamentoId,
      tabelaPrecoId: d.tabelaPrecoId,
      kmEntrada: d.kmEntrada,
      relatoCliente: d.relatoCliente,
      previsaoEntrega: previsaoComoInstante(d.previsaoEntrega),
      criadoPor: usuarioId,
      atualizadoPor: usuarioId,
    })
    .returning({ id: ordensServico.id })) as [{ id: string }];
  await atualizarVeiculoNaAbertura(tx, d.veiculoId, d.kmEntrada);
  await registrarOs(tx, id, d.orcamentoId ? 'convertida' : 'criada', usuarioId, { detalhe, para: 'aberta' });
  return id;
}

// ---------- Itens ----------

/** Totais da O.S.: bruto de serviços e de produtos, desconto e total. */
export function totaisDaOs(linhas: Pick<LinhaOs, 'tipo' | 'brutoCentavos' | 'descontoCentavos' | 'totalCentavos'>[]) {
  const soma = (tipo: 'material' | 'servico') =>
    linhas.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.brutoCentavos, 0);
  return {
    subtotalServicosCentavos: soma('servico'),
    subtotalMateriaisCentavos: soma('material'),
    descontoCentavos: linhas.reduce((s, l) => s + l.descontoCentavos, 0),
    totalCentavos: linhas.reduce((s, l) => s + l.totalCentavos, 0),
  };
}

const ehAvulso = (i: ItemOsDados): i is Extract<ItemOsDados, { avulso: true }> => 'avulso' in i;

/** Linha de item avulso: preço digitado é o final (sem desconto); peça inteira quando a unidade não é fracionada. */
function linhaAvulsa(i: Extract<ItemOsDados, { avulso: true }>, id: string): Omit<LinhaOs, 'ordem' | 'aprovacao'> {
  const hora = i.tipo === 'servico' && i.formaPreco === 'hora';
  const unidade = i.tipo === 'servico' ? (hora ? 'H' : 'UN') : i.unidade!;
  const fracionada = i.tipo === 'material' && UNIDADES[i.unidade!].fracionada;
  const quantidade = hora ? null : arredondarQuantidade(i.quantidade!, 1, fracionada);
  const tempoMinutos = hora ? i.tempoMinutos! : null;
  return {
    id,
    tipo: i.tipo,
    materialId: null,
    servicoId: null,
    avulso: true,
    orcamentoItemId: null,
    codigo: null,
    descricao: i.descricao,
    unidade,
    formaPreco: i.tipo === 'servico' ? i.formaPreco! : null,
    multiplo: 1,
    fracionada,
    quantidade,
    tempoMinutos,
    precoTabelaCentavos: i.precoUnitarioCentavos,
    precoUnitarioCentavos: i.precoUnitarioCentavos,
    descontoPercentual: null,
    pmcCentavos: null,
    ...calcularItem(
      i.precoUnitarioCentavos,
      i.precoUnitarioCentavos,
      hora ? { tempoMinutos: tempoMinutos! } : { quantidadeMilesimos: paraMilesimos(quantidade!) },
    ),
  };
}

/**
 * Monta os itens da O.S. a partir do que a tela enviou, na ordem enviada. Do catálogo: as mesmas regras do
 * orçamento (`montarItens`, preço da tabela da O.S. hoje, produto com "Permite uso em O.S."); item já gravado mantém
 * o retrato e a origem. Avulso: preço digitado. Item novo entra aprovado se a O.S. já foi aprovada pelo cliente
 * (convertida, ou aprovada depois de aberta no balcão); senão, pendente. Item gravado mantém a aprovação.
 */
export async function montarItensOs(
  tx: Tx,
  entrada: ItemOsDados[],
  gravados: ItemOsGravado[],
  os: Pick<OsGravada, 'tabelaPrecoId' | 'orcamentoId' | 'aprovadaEm'>,
): Promise<{ linhas: LinhaOs[]; avisos: string[] }> {
  const porId = new Map(gravados.map((g) => [g.id, g]));
  const aprovacaoDoNovo = os.orcamentoId || os.aprovadaEm ? ('aprovado' as const) : ('pendente' as const);

  const catalogo = entrada.filter((i): i is ItemOrcamentoDados => !ehAvulso(i));
  const gravadosCatalogo = gravados.filter((g) => !g.avulso).map((g) => ({ ...g, codigo: g.codigo! }));
  const { linhas: doCatalogo, avisos } = await montarItens(
    tx,
    catalogo,
    gravadosCatalogo,
    os.tabelaPrecoId,
    hojeIso(),
    false,
    'os',
  );

  let proximoDoCatalogo = 0;
  const linhas = entrada.map((i, n): LinhaOs => {
    if (ehAvulso(i)) {
      const anterior = i.id ? porId.get(i.id) : undefined;
      const base = linhaAvulsa(i, anterior?.avulso ? anterior.id : randomUUID());
      return { ...base, ordem: n + 1, aprovacao: anterior?.avulso ? anterior.aprovacao : aprovacaoDoNovo };
    }
    const l = doCatalogo[proximoDoCatalogo++]!;
    const anterior = porId.get(l.id);
    return {
      ...l,
      ordem: n + 1,
      avulso: false,
      orcamentoItemId: anterior?.orcamentoItemId ?? null,
      aprovacao: anterior && !anterior.avulso ? anterior.aprovacao : aprovacaoDoNovo,
    };
  });
  return { linhas, avisos };
}

/** Assinatura dos produtos (catálogo e avulsos): mudou sem "Peças na O.S.", a gravação é recusada. */
export const assinaturaDosProdutos = (
  linhas: Pick<LinhaOs, 'id' | 'tipo' | 'quantidade' | 'precoUnitarioCentavos' | 'descricao'>[],
) =>
  JSON.stringify(
    linhas
      .filter((l) => l.tipo === 'material')
      .map((l) => [l.id, l.descricao, Number(l.quantidade), l.precoUnitarioCentavos])
      .sort(),
  );

/** Troca os itens da O.S. (a O.S. já está travada e em situação que aceita mudança). */
export async function gravarItensOs(tx: Tx, ordemServicoId: string, linhas: LinhaOs[]) {
  await tx.delete(osItens).where(eq(osItens.ordemServicoId, ordemServicoId));
  if (linhas.length) await tx.insert(osItens).values(linhas.map((l) => ({ ...l, ordemServicoId })));
}

export const itensDaOs = (tx: Tx, ordemServicoId: string) =>
  tx.select().from(osItens).where(eq(osItens.ordemServicoId, ordemServicoId)).orderBy(osItens.ordem);

/** Percentual de desconto do item (centésimos), o que a alçada avalia. Avulso e serviço: 0. */
export const percentualDaLinhaOs = (
  l: Pick<LinhaOs, 'precoTabelaCentavos' | 'precoUnitarioCentavos' | 'descontoPercentual'>,
) => percentualDoItem(l.precoTabelaCentavos, l.precoUnitarioCentavos, l.descontoPercentual ?? null);

/**
 * Itens cujo desconto mudou nesta gravação e passou da `alcada` de quem gravou: eles pedem aprovação comercial
 * (docs/modulos/ORDENS_SERVICO.md §5). Desconto que não mudou já foi aceito antes (ou aprovado).
 */
export function itensAcimaDaAlcada(gravados: ItemOsGravado[], linhas: LinhaOs[], alcada: number): LinhaOs[] {
  const antes = new Map(gravados.map((g) => [g.id, percentualDaLinhaOs(g)]));
  return linhas.filter((l) => {
    const p = percentualDaLinhaOs(l);
    return p !== (antes.get(l.id) ?? 0) && !dentroDaAlcada(p, alcada);
  });
}

/** "Produto X: 5% → 12%; …" para o histórico (só itens do catálogo; avulso não tem desconto). */
export function descreverDescontosOs(gravados: ItemOsGravado[], linhas: LinhaOs[]): string | null {
  const antes = new Map(gravados.map((g) => [g.id, percentualDaLinhaOs(g)]));
  const rotulo = (c: number) => (c ? formatarPercentual(c) : 'sem desconto');
  const mudancas = linhas.flatMap((l) => {
    const de = antes.get(l.id) ?? 0;
    const para = percentualDaLinhaOs(l);
    return de === para ? [] : [`${l.codigo ?? 'Avulso'} — ${l.descricao}: ${rotulo(de)} → ${rotulo(para)}`];
  });
  return mudancas.length ? `${mudancas.join('; ')}.` : null;
}
