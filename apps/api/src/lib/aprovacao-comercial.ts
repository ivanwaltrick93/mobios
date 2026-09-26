import {
  dentroDaAlcada,
  formatarPercentual,
  STATUS_APROVACAO_COMERCIAL,
  type EventoAprovacaoComercial,
  type SnapshotComercial,
  type TipoDocumentoComercial,
} from '@mobios/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import {
  alcadasDesconto,
  aprovacoesComerciais,
  aprovacoesComerciaisEventos,
  funcoes,
  usuarioFuncoes,
} from '../db/schema.js';
import { ErroHttp, naoEncontrado } from './erros.js';

/*
 * Motor da aprovação comercial por alçada (docs/modulos/APROVACAO_COMERCIAL.md). Não conhece regra de documento:
 * cada documento (hoje o Orçamento) avalia a alçada na própria ação, pede a aprovação aqui e fornece um adaptador
 * para conferir e aplicar a decisão. Pedido de Venda e O.S. entram depois com o seu adaptador.
 */

export type AprovacaoGravada = typeof aprovacoesComerciais.$inferSelect;

/** Como o documento confere e aplica a decisão (tudo na transação da decisão). */
export type AdaptadorDocumento = {
  /** Trava o documento e confere que ele ainda aguarda esta aprovação com os mesmos valores (senão 409). */
  conferir(tx: Tx, aprovacao: AprovacaoGravada): Promise<void>;
  aoAprovar(tx: Tx, aprovacao: AprovacaoGravada, usuarioId: string): Promise<void>;
  aoReprovar(tx: Tx, aprovacao: AprovacaoGravada, usuarioId: string, justificativa: string): Promise<void>;
};

export type AlcadaDoUsuario = { percentual: number; funcao: string | null };

const percentualEfetivo = sql<number>`coalesce(${alcadasDesconto.percentual}, 0)`.mapWith(Number);

/**
 * Alçada do usuário: a maior entre as funções ATIVAS dele (função sem alçada, ou com ela inativa, vale 0%), com o
 * nome da função que a concede (empate: a primeira em ordem alfabética).
 */
export async function alcadaDoUsuario(tx: Tx, usuarioId: string): Promise<AlcadaDoUsuario> {
  const [linha] = await tx
    .select({ percentual: percentualEfetivo, funcao: funcoes.nome })
    .from(usuarioFuncoes)
    .innerJoin(funcoes, and(eq(funcoes.id, usuarioFuncoes.funcaoId), eq(funcoes.ativa, true)))
    .leftJoin(alcadasDesconto, and(eq(alcadasDesconto.funcaoId, funcoes.id), eq(alcadasDesconto.ativa, true)))
    .where(eq(usuarioFuncoes.usuarioId, usuarioId))
    .orderBy(desc(percentualEfetivo), asc(funcoes.nome))
    .limit(1);
  return linha ?? { percentual: 0, funcao: null };
}

/** A função dá o direito de decidir: Administrador ou "Aprovação comercial" em Editar. */
const funcaoQueDecide = (funcao: string) => sql`(${sql.raw(funcao)}.admin or exists (
  select 1 from funcao_permissoes p
  where p.funcao_id = ${sql.raw(funcao)}.id and p.modulo = 'aprovacao_comercial' and p.nivel = 'editar'))`;

/**
 * Maior alçada entre os usuários ativos que podem decidir (permissão em alguma função ativa), fora o solicitante.
 * Abaixo do percentual pedido, ninguém poderia aprovar: a emissão é bloqueada antes de criar a solicitação.
 */
async function maiorAlcadaDeQuemDecide(tx: Tx, exceto: string): Promise<number> {
  const [linha] = await tx.execute<{ maior: number | null }>(sql`
    select max(a.percentual)::int as maior
    from users u
    join usuario_funcoes uf on uf.usuario_id = u.id
    join funcoes f on f.id = uf.funcao_id and f.ativa
    join alcadas_desconto a on a.funcao_id = f.id and a.ativa
    where u.ativo and u.id <> ${exceto}
      and exists (
        select 1 from usuario_funcoes uf2 join funcoes f2 on f2.id = uf2.funcao_id and f2.ativa
        where uf2.usuario_id = u.id and ${funcaoQueDecide('f2')})`);
  return linha?.maior ?? 0;
}

/** Funções ativas que hoje aprovam o percentual (alçada suficiente e permissão), da menor alçada para a maior. */
export async function funcoesQueAprovam(tx: Tx, percentual: number) {
  return tx
    .select({ funcao: funcoes.nome, alcada: alcadasDesconto.percentual })
    .from(funcoes)
    .innerJoin(alcadasDesconto, and(eq(alcadasDesconto.funcaoId, funcoes.id), eq(alcadasDesconto.ativa, true)))
    .where(
      and(eq(funcoes.ativa, true), sql`${alcadasDesconto.percentual} >= ${percentual}`, funcaoQueDecide('"funcoes"')),
    )
    .orderBy(asc(alcadasDesconto.percentual), asc(funcoes.nome));
}

/** Linha do tempo (só inclusão). clock_timestamp: eventos da mesma transação ficam na ordem em que aconteceram. */
export const registrarEventoAprovacao = (
  tx: Tx,
  aprovacaoId: string,
  evento: EventoAprovacaoComercial,
  quem: { usuarioId: string; funcao: string | null; alcada: number | null },
  detalhe: string | null,
) =>
  tx
    .insert(aprovacoesComerciaisEventos)
    .values({ aprovacaoId, evento, ...quem, detalhe, criadoEm: sql`clock_timestamp()` });

export type Solicitacao = {
  tipoDocumento: TipoDocumentoComercial;
  documentoId: string;
  documentoNumero: string;
  documentoVersao: number;
  clienteNome: string;
  subtotalCentavos: number;
  descontoCentavos: number;
  totalCentavos: number;
  percentual: number;
  solicitanteId: string;
  alcada: AlcadaDoUsuario;
  snapshot: SnapshotComercial;
};

/** Coluna do documento na solicitação (uma por tipo, para manter a FK composta). */
const colunaDoDocumento = (tipo: TipoDocumentoComercial, documentoId: string) =>
  ({ orcamento: { orcamentoId: documentoId } })[tipo];

export const documentoDaAprovacao = (a: Pick<AprovacaoGravada, 'tipoDocumento' | 'orcamentoId'>) =>
  ({ orcamento: a.orcamentoId })[a.tipoDocumento]!;

/**
 * Cria a solicitação (desconto acima da alçada de quem emite), com o retrato e as alçadas do momento. Se ninguém
 * mais tem alçada para aprovar o percentual, recusa (400) sem criar nada.
 */
export async function solicitarAprovacao(tx: Tx, s: Solicitacao): Promise<string> {
  if (dentroDaAlcada(s.percentual, s.alcada.percentual))
    throw new Error('solicitarAprovacao chamada com desconto dentro da alçada');
  const maior = await maiorAlcadaDeQuemDecide(tx, s.solicitanteId);
  if (maior < s.percentual)
    throw new ErroHttp(
      400,
      `Nenhum usuário pode aprovar ${formatarPercentual(s.percentual)} de desconto` +
        (maior > 0
          ? ` (a maior alçada de quem aprova é ${formatarPercentual(maior)}).`
          : ' (ninguém mais tem alçada para aprovar descontos).') +
        ' Reduza o desconto ou peça ao Administrador para ajustar as alçadas em Configurações → Alçadas de desconto.',
    );
  const [{ id }] = (await tx
    .insert(aprovacoesComerciais)
    .values({
      tipoDocumento: s.tipoDocumento,
      ...colunaDoDocumento(s.tipoDocumento, s.documentoId),
      documentoNumero: s.documentoNumero,
      documentoVersao: s.documentoVersao,
      clienteNome: s.clienteNome,
      subtotalCentavos: s.subtotalCentavos,
      descontoCentavos: s.descontoCentavos,
      totalCentavos: s.totalCentavos,
      percentual: s.percentual,
      solicitanteId: s.solicitanteId,
      solicitanteFuncao: s.alcada.funcao,
      alcadaSolicitante: s.alcada.percentual,
      snapshot: s.snapshot,
    })
    .returning({ id: aprovacoesComerciais.id })) as [{ id: string }];
  const quem = { usuarioId: s.solicitanteId, funcao: s.alcada.funcao, alcada: s.alcada.percentual };
  await registrarEventoAprovacao(
    tx,
    id,
    'necessaria',
    quem,
    `Desconto de ${formatarPercentual(s.percentual)} excede a alçada de ${formatarPercentual(s.alcada.percentual)}` +
      `${s.alcada.funcao ? ` (${s.alcada.funcao})` : ''}.`,
  );
  await registrarEventoAprovacao(
    tx,
    id,
    'solicitada',
    quem,
    `Aguardando quem tenha alçada de ${formatarPercentual(s.percentual)} ou mais.`,
  );
  return id;
}

/** Pendente do documento, travada (null = não há). */
export async function pendenteDoDocumento(tx: Tx, tipo: TipoDocumentoComercial, documentoId: string) {
  const [a] = await tx
    .select()
    .from(aprovacoesComerciais)
    .where(
      and(
        eq(aprovacoesComerciais.tipoDocumento, tipo),
        eq(aprovacoesComerciais.status, 'pendente'),
        tipo === 'orcamento' ? eq(aprovacoesComerciais.orcamentoId, documentoId) : undefined,
      ),
    )
    .for('update');
  return a ?? null;
}

/** Cancela a pendente (documento cancelado, nova versão ou pedido retirado). O documento já está travado. */
export async function cancelarAprovacao(tx: Tx, a: AprovacaoGravada, usuarioId: string, motivo: string) {
  await tx
    .update(aprovacoesComerciais)
    .set({ status: 'cancelada', decididoPor: usuarioId, decididoEm: new Date(), versao: a.versao + 1 })
    .where(eq(aprovacoesComerciais.id, a.id));
  await registrarEventoAprovacao(tx, a.id, 'cancelada', { usuarioId, funcao: null, alcada: null }, motivo);
}

/**
 * Por que o usuário não pode decidir (null = pode). A mesma regra vale para a tela (podeDecidir) e para a decisão.
 * A permissão do módulo é conferida antes, pela rota.
 */
export function bloqueioDaDecisao(a: AprovacaoGravada, usuarioId: string, alcada: AlcadaDoUsuario): string | null {
  if (a.status !== 'pendente') return `Esta solicitação já está ${STATUS_APROVACAO_COMERCIAL[a.status].toLowerCase()}.`;
  if (a.solicitanteId === usuarioId) return 'Quem pediu a aprovação não pode decidi-la.';
  if (!dentroDaAlcada(a.percentual, alcada.percentual))
    return (
      `Sua alçada (${formatarPercentual(alcada.percentual)}) não cobre ` +
      `${formatarPercentual(a.percentual)} de desconto.`
    );
  return null;
}

type Decisao = { decisao: 'aprovada' } | { decisao: 'reprovada'; justificativa: string };

/**
 * Aprova ou reprova. Trava primeiro o documento (mesma ordem da emissão e do cancelamento: sem deadlock), depois a
 * solicitação, e confere tudo de novo: situação, versão lida, solicitante e alçada do decisor no momento.
 * Duas decisões ao mesmo tempo: a segunda encontra a solicitação já decidida (409).
 */
export async function decidirAprovacao(
  tx: Tx,
  adaptadores: Record<TipoDocumentoComercial, AdaptadorDocumento>,
  pedido: { id: string; usuarioId: string; versao: number } & Decisao,
) {
  const [lida] = await tx.select().from(aprovacoesComerciais).where(eq(aprovacoesComerciais.id, pedido.id));
  if (!lida) throw naoEncontrado('Aprovação comercial');
  const adaptador = adaptadores[lida.tipoDocumento];
  if (lida.status === 'pendente') await adaptador.conferir(tx, lida);

  const [a] = (await tx
    .select()
    .from(aprovacoesComerciais)
    .where(eq(aprovacoesComerciais.id, pedido.id))
    .for('update')) as [AprovacaoGravada];
  const alcada = await alcadaDoUsuario(tx, pedido.usuarioId);
  if (a.status !== 'pendente')
    throw new ErroHttp(409, `${bloqueioDaDecisao(a, pedido.usuarioId, alcada)} Recarregue a página.`);
  if (a.versao !== pedido.versao)
    throw new ErroHttp(409, 'Esta solicitação foi alterada por outra pessoa. Recarregue a página e refaça a ação.');
  const bloqueio = bloqueioDaDecisao(a, pedido.usuarioId, alcada);
  if (bloqueio) throw new ErroHttp(403, bloqueio);

  const justificativa = pedido.decisao === 'reprovada' ? pedido.justificativa : null;
  await tx
    .update(aprovacoesComerciais)
    .set({
      status: pedido.decisao,
      decididoPor: pedido.usuarioId,
      decisorFuncao: alcada.funcao,
      alcadaDecisor: alcada.percentual,
      decididoEm: new Date(),
      justificativa,
      versao: a.versao + 1,
    })
    .where(eq(aprovacoesComerciais.id, a.id));
  await registrarEventoAprovacao(
    tx,
    a.id,
    pedido.decisao,
    { usuarioId: pedido.usuarioId, funcao: alcada.funcao, alcada: alcada.percentual },
    pedido.decisao === 'aprovada'
      ? `Desconto de ${formatarPercentual(a.percentual)} aprovado.`
      : `Desconto de ${formatarPercentual(a.percentual)} reprovado: ${justificativa}`,
  );
  if (pedido.decisao === 'aprovada') await adaptador.aoAprovar(tx, a, pedido.usuarioId);
  else await adaptador.aoReprovar(tx, a, pedido.usuarioId, pedido.justificativa);
}
