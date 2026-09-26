import {
  formatarDataIso,
  formatarNumeroOrcamento,
  formatarPercentual,
  hojeIso,
  somarDias,
  VALIDADE_PADRAO_DIAS,
  type Orcamento,
  type SnapshotComercial,
} from '@mobios/shared';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { orcamentos } from '../../db/schema.js';
import type { AdaptadorDocumento, AprovacaoGravada } from '../../lib/aprovacao-comercial.js';
import { ErroHttp } from '../../lib/erros.js';
import { registrar } from './regras.js';

// O Orçamento no motor de aprovação comercial (docs/modulos/APROVACAO_COMERCIAL.md §Integrações).

/** Retrato do orçamento na solicitação. `validadeDias`: a validade pedida, que passa a contar na aprovação. */
export const snapshotDoOrcamento = (o: Orcamento, validadeDias: number): SnapshotComercial => ({
  documento: { tipo: 'orcamento', numero: formatarNumeroOrcamento(o.numero), versao: o.versaoOrcamento },
  cliente: { id: o.cliente.id, nome: o.cliente.nome },
  vendedor: o.vendedor.nome,
  veiculo: o.veiculo ? `${o.veiculo.placa} — ${o.veiculo.marca} ${o.veiculo.modelo}` : null,
  tabela: `${o.tabela.codigo} — ${o.tabela.nome}`,
  validadeDias,
  observacoes: o.observacoes,
  itens: o.itens.map((i) => ({
    tipo: i.tipo,
    codigo: i.codigo,
    descricao: i.descricao,
    unidade: i.unidade,
    quantidade: i.quantidade,
    tempoMinutos: i.tempoMinutos,
    precoTabelaCentavos: i.precoTabelaCentavos,
    precoUnitarioCentavos: i.precoUnitarioCentavos,
    brutoCentavos: i.brutoCentavos,
    descontoCentavos: i.descontoCentavos,
    totalCentavos: i.totalCentavos,
  })),
  subtotalCentavos: o.subtotalCentavos,
  descontoCentavos: o.descontoCentavos,
  totalCentavos: o.totalCentavos,
});

const mudarSituacao = (
  tx: Tx,
  a: AprovacaoGravada,
  usuarioId: string,
  valores: Partial<typeof orcamentos.$inferInsert>,
) =>
  tx
    .update(orcamentos)
    .set({ ...valores, atualizadoPor: usuarioId, versao: sql`${orcamentos.versao} + 1` })
    .where(eq(orcamentos.id, a.orcamentoId!));

export const adaptadorOrcamento: AdaptadorDocumento = {
  async conferir(tx, a) {
    const [o] = await tx
      .select({
        status: orcamentos.status,
        subtotalCentavos: orcamentos.subtotalCentavos,
        descontoCentavos: orcamentos.descontoCentavos,
      })
      .from(orcamentos)
      .where(eq(orcamentos.id, a.orcamentoId!))
      .for('update');
    const igual =
      o?.status === 'aguardando_aprovacao_comercial' &&
      o.subtotalCentavos === a.subtotalCentavos &&
      o.descontoCentavos === a.descontoCentavos;
    if (!igual) throw new ErroHttp(409, 'O orçamento não está mais aguardando esta aprovação. Recarregue a página.');
  },

  /** Aprovado: o orçamento é emitido agora, e a validade pedida passa a contar de hoje. */
  async aoAprovar(tx, a, usuarioId) {
    const validadeAte = somarDias(hojeIso(), a.snapshot.validadeDias ?? VALIDADE_PADRAO_DIAS);
    await mudarSituacao(tx, a, usuarioId, {
      status: 'emitido',
      validadeAte,
      emitidoEm: new Date(),
      emitidoPor: a.solicitanteId,
    });
    await registrar(
      tx,
      a.orcamentoId!,
      'aprovado_comercialmente',
      usuarioId,
      `Desconto de ${formatarPercentual(a.percentual)} aprovado.`,
    );
    await registrar(tx, a.orcamentoId!, 'emitido', usuarioId, `Válido até ${formatarDataIso(validadeAte)}.`);
  },

  /** Reprovado: para corrigir o desconto, gera-se uma nova versão (reavaliada na emissão). */
  async aoReprovar(tx, a, usuarioId, justificativa) {
    await mudarSituacao(tx, a, usuarioId, { status: 'reprovado_comercialmente' });
    await registrar(tx, a.orcamentoId!, 'reprovado_comercialmente', usuarioId, justificativa);
  },
};
