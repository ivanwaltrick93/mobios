import {
  calcularMargem,
  formatarNumeroOs,
  formatarPercentual,
  type OrdemServico,
  type SnapshotComercial,
} from '@mobios/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { ordensServico, osItens } from '../../db/schema.js';
import type { AdaptadorDocumento } from '../../lib/aprovacao-comercial.js';
import { ErroHttp } from '../../lib/erros.js';
import { comTotais } from '../orcamentos/regras.js';
import { itensDaOs, percentualDaLinhaOs, registrarOs, totaisDaOs, type ItemOsGravado } from './regras.js';

// A O.S. no motor de aprovação comercial (docs/modulos/ORDENS_SERVICO.md §5, APROVACAO_COMERCIAL.md).

/**
 * Retrato da O.S. na solicitação: itens com o percentual e a marca dos que pediram a aprovação (`acima`: ids dos
 * itens cujo desconto mudou e passou da alçada de quem salvou) e a margem com o PMC congelado.
 */
export function snapshotDaOs(os: OrdemServico, gravados: ItemOsGravado[], acima: Set<string>): SnapshotComercial {
  return {
    documento: { tipo: 'ordem_servico', numero: formatarNumeroOs(os.numero), versao: 1 },
    cliente: { id: os.cliente.id, nome: os.cliente.nome },
    vendedor: os.vendedor?.nome ?? null,
    veiculo: `${os.veiculo.placa} — ${os.veiculo.marca} ${os.veiculo.modelo}`,
    tabela: `${os.tabela.codigo} — ${os.tabela.nome}`,
    validadeDias: null,
    observacoes: os.observacoes,
    itens: gravados.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      codigo: i.codigo ?? 'Avulso',
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: i.quantidade == null ? null : Number(i.quantidade),
      tempoMinutos: i.tempoMinutos,
      precoTabelaCentavos: i.precoTabelaCentavos,
      precoUnitarioCentavos: i.precoUnitarioCentavos,
      brutoCentavos: i.brutoCentavos,
      descontoCentavos: i.descontoCentavos,
      totalCentavos: i.totalCentavos,
      percentual: percentualDaLinhaOs(i),
      acimaDaAlcada: acima.has(i.id),
    })),
    subtotalCentavos: os.subtotalServicosCentavos + os.subtotalMateriaisCentavos,
    descontoCentavos: os.descontoCentavos,
    totalCentavos: os.totalCentavos,
    // Avulso não tem PMC: entra como "sem PMC" (a margem consolidada fica indisponível, como no orçamento).
    margem: calcularMargem(
      gravados.map((i) => ({
        tipo: i.tipo,
        quantidade: i.quantidade == null ? null : Number(i.quantidade),
        brutoCentavos: i.brutoCentavos,
        totalCentavos: i.totalCentavos,
        pmcCentavos: i.pmcCentavos,
      })),
    ),
  };
}

const subirVersao = (tx: Tx, id: string, usuarioId: string, valores: Partial<typeof ordensServico.$inferInsert> = {}) =>
  tx
    .update(ordensServico)
    .set({ ...valores, atualizadoPor: usuarioId, versao: sql`${ordensServico.versao} + 1` })
    .where(eq(ordensServico.id, id));

export const adaptadorOrdemServico: AdaptadorDocumento = {
  async conferir(tx, a) {
    const [o] = await tx
      .select({
        status: ordensServico.status,
        subtotalServicosCentavos: ordensServico.subtotalServicosCentavos,
        subtotalMateriaisCentavos: ordensServico.subtotalMateriaisCentavos,
        descontoCentavos: ordensServico.descontoCentavos,
      })
      .from(ordensServico)
      .where(eq(ordensServico.id, a.ordemServicoId!))
      .for('update');
    const igual =
      !!o &&
      o.status !== 'cancelada' &&
      o.subtotalServicosCentavos + o.subtotalMateriaisCentavos === a.subtotalCentavos &&
      o.descontoCentavos === a.descontoCentavos;
    if (!igual) throw new ErroHttp(409, 'A O.S. não está mais aguardando esta aprovação. Recarregue a página.');
  },

  /** Aprovado: os descontos ficam como estão e a O.S. volta a andar. */
  async aoAprovar(tx, a, usuarioId) {
    await subirVersao(tx, a.ordemServicoId!, usuarioId);
    await registrarOs(tx, a.ordemServicoId!, 'aprovado_comercialmente', usuarioId, {
      detalhe: `Desconto de ${formatarPercentual(a.percentual)} aprovado.`,
    });
  },

  /** Reprovado: os itens que pediram a aprovação voltam ao preço de tabela, e a O.S. volta a andar. */
  async aoReprovar(tx, a, usuarioId, justificativa) {
    const ids = a.snapshot.itens.flatMap((i) => (i.acimaDaAlcada && i.id ? [i.id] : []));
    const gravados = ids.length
      ? await tx.select().from(osItens).where(inArray(osItens.id, ids))
      : ([] as ItemOsGravado[]);
    for (const g of gravados) {
      const { brutoCentavos, descontoCentavos, totalCentavos } = comTotais({
        ...g,
        quantidade: g.quantidade == null ? null : Number(g.quantidade),
        precoUnitarioCentavos: g.precoTabelaCentavos,
        codigo: g.codigo ?? '',
      });
      await tx
        .update(osItens)
        .set({
          precoUnitarioCentavos: g.precoTabelaCentavos,
          descontoPercentual: null,
          brutoCentavos,
          descontoCentavos,
          totalCentavos,
        })
        .where(eq(osItens.id, g.id));
    }
    const totais = totaisDaOs(await itensDaOs(tx, a.ordemServicoId!));
    await subirVersao(tx, a.ordemServicoId!, usuarioId, totais);
    const nomes = gravados.map((g) => `${g.codigo} — ${g.descricao}`).join('; ');
    await registrarOs(tx, a.ordemServicoId!, 'reprovado_comercialmente', usuarioId, {
      detalhe: `${justificativa} Voltaram ao preço de tabela: ${nomes || 'nenhum item'}.`,
    });
  },
};
