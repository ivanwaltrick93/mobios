import { randomUUID } from 'node:crypto';
import {
  arredondarMinutos,
  arredondarQuantidade,
  calcularItem,
  descontoPorPercentual,
  formatarCodigoServico,
  formatarHoras,
  formatarMoeda,
  formatarPercentual,
  formatarQuantidade,
  paraMilesimos,
  percentualDeDesconto,
  percentualDoItem,
  somarItens,
  UNIDADES,
  type CalculoItem,
  type FormaPrecoServico,
  type EventoOrcamento,
  type ItemOrcamentoDados,
  type TipoItemPreco,
} from '@mobios/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { materiais, orcamentoItens, orcamentosEventos, servicos } from '../../db/schema.js';
import { ErroHttp } from '../../lib/erros.js';

// Regras dos itens do orçamento: preço do dia na tabela, quantidade vendável, negociação e recálculo.

export type LinhaItem = Omit<typeof orcamentoItens.$inferInsert, 'tenantId' | 'orcamentoId'> & { id: string };
export type ItemGravado = typeof orcamentoItens.$inferSelect;

/** O que é preciso saber do cadastro para incluir um item novo (guardado depois como snapshot). */
type Catalogo = {
  codigo: string;
  descricao: string;
  unidade: string;
  formaPreco: FormaPrecoServico | null;
  multiplo: number;
  fracionada: boolean;
  vendavel: boolean;
  motivo?: string;
};

const chave = (tipo: TipoItemPreco, id: string) => `${tipo}:${id}`;

/**
 * Preço de cada item na tabela e na data: a vigência que cobre o dia ou, sem ela, o preço padrão. Uma consulta
 * por tipo (não uma por item). Ausente no mapa = sem preço: o item não pode ser vendido.
 */
export async function precosDoDia(
  tx: Tx,
  itens: { tipo: TipoItemPreco; id: string }[],
  tabelaPrecoId: string,
  data: string,
): Promise<Map<string, number>> {
  const precos = new Map<string, number>();
  for (const tipo of ['material', 'servico'] as const) {
    const ids = [...new Set(itens.filter((i) => i.tipo === tipo).map((i) => i.id))];
    if (!ids.length) continue;
    const coluna = sql.identifier(tipo === 'material' ? 'material_id' : 'servico_id');
    const linhas = await tx.execute<{ id: string; preco: string | null }>(sql`
      select x.id, coalesce(
        (select p.preco_centavos from materiais_precos p
          where p.${coluna} = x.id and p.tabela_preco_id = ${tabelaPrecoId} and not p.cancelado
            and p.data_inicio <= ${data}::date and (p.data_fim is null or p.data_fim >= ${data}::date)
          limit 1),
        (select pp.preco_centavos from precos_padrao pp where pp.${coluna} = x.id and pp.tabela_preco_id = ${tabelaPrecoId})
      ) as preco
      from unnest(array[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]) as x(id)`);
    for (const l of linhas) if (l.preco != null) precos.set(chave(tipo, l.id), Number(l.preco));
  }
  return precos;
}

/**
 * PMC atual do cadastro de cada material (para congelar no item). Ausente no mapa = sem PMC (não disponível).
 * Uma consulta para todos.
 */
async function pmcsDosMateriais(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return new Map();
  const lista = await tx
    .select({ id: materiais.id, pmcCentavos: materiais.pmcCentavos })
    .from(materiais)
    .where(inArray(materiais.id, unicos));
  return new Map(lista.flatMap((m) => (m.pmcCentavos == null ? [] : [[m.id, m.pmcCentavos] as [string, number]])));
}

/** Cadastro dos itens novos (ativos; material também com "Permite venda"). */
async function catalogo(tx: Tx, itens: { tipo: TipoItemPreco; id: string }[]) {
  const mapa = new Map<string, Catalogo>();
  const idsMaterial = itens.filter((i) => i.tipo === 'material').map((i) => i.id);
  const idsServico = itens.filter((i) => i.tipo === 'servico').map((i) => i.id);
  if (idsMaterial.length) {
    const lista = await tx
      .select({
        id: materiais.id,
        sku: materiais.sku,
        descricao: materiais.descricao,
        unidade: materiais.unidade,
        multiplo: materiais.multiplo,
        ativo: materiais.ativo,
        permiteVenda: materiais.permiteVenda,
      })
      .from(materiais)
      .where(inArray(materiais.id, idsMaterial));
    for (const m of lista)
      mapa.set(chave('material', m.id), {
        codigo: m.sku,
        descricao: m.descricao,
        unidade: m.unidade,
        formaPreco: null,
        multiplo: m.multiplo,
        fracionada: UNIDADES[m.unidade].fracionada,
        vendavel: m.ativo && m.permiteVenda,
        motivo: !m.ativo ? 'está inativo' : 'não está marcado como "Permite venda"',
      });
  }
  if (idsServico.length) {
    const lista = await tx
      .select({
        id: servicos.id,
        codigo: servicos.codigo,
        nome: servicos.nome,
        formaPreco: servicos.formaPreco,
        tempoMinutos: servicos.tempoMinutos,
        ativo: servicos.ativo,
      })
      .from(servicos)
      .where(inArray(servicos.id, idsServico));
    for (const s of lista)
      mapa.set(chave('servico', s.id), {
        codigo: formatarCodigoServico(s.codigo),
        descricao: s.nome,
        unidade: s.formaPreco === 'hora' ? 'H' : 'UN',
        formaPreco: s.formaPreco,
        // Valor-hora: vende-se em múltiplos das horas do serviço; preço fechado: quantidade inteira.
        multiplo: s.formaPreco === 'hora' ? s.tempoMinutos! : 1,
        fracionada: false,
        vendavel: s.ativo,
        motivo: 'está inativo',
      });
  }
  return mapa;
}

const quantidadeDaLinha = (l: Pick<LinhaItem, 'formaPreco' | 'quantidade' | 'tempoMinutos'>) =>
  l.formaPreco === 'hora'
    ? { tempoMinutos: l.tempoMinutos! }
    : { quantidadeMilesimos: paraMilesimos(Number(l.quantidade)) };

/** Recalcula bruto, desconto e total da linha a partir dos preços e da quantidade. */
export const comTotais = <T extends LinhaItem>(l: T): T => ({
  ...l,
  ...calcularItem(l.precoTabelaCentavos, l.precoUnitarioCentavos, quantidadeDaLinha(l)),
});

const nomeDoItem = (l: { codigo: string; descricao: string }) => `${l.codigo} — ${l.descricao}`;

/**
 * Monta as linhas do rascunho a partir do que a tela enviou.
 * - Item já gravado (`id`): mantém código, descrição e o preço de tabela guardados (a tabela pode ter mudado).
 * - Item novo: precisa estar vendável e ter preço na tabela hoje; o preço de tabela é o de hoje.
 * - `trocouTabela`: todos os itens vão ao preço cheio da nova tabela (a negociação é descartada) e os sem preço
 *   saem do orçamento, com aviso.
 * Quantidade arredondada para cima ao múltiplo; negociação só de material, nunca acima do preço de tabela.
 */
export async function montarItens(
  tx: Tx,
  entrada: ItemOrcamentoDados[],
  gravados: ItemGravado[],
  tabelaPrecoId: string,
  hoje: string,
  trocouTabela: boolean,
): Promise<{ linhas: LinhaItem[]; avisos: string[] }> {
  const avisos: string[] = [];
  const porId = new Map(gravados.map((g) => [g.id, g]));
  const itemDe = (i: ItemOrcamentoDados) => ({ tipo: i.tipo, id: (i.materialId ?? i.servicoId)! });

  const anterior = (i: ItemOrcamentoDados) => {
    const g = i.id ? porId.get(i.id) : undefined;
    return g && g.tipo === i.tipo && (g.materialId ?? g.servicoId) === itemDe(i).id ? g : undefined;
  };
  const novos = entrada.filter((i) => !anterior(i)).map(itemDe);
  const cadastro = await catalogo(tx, novos);
  const repreco = trocouTabela ? entrada.map(itemDe) : novos;
  const precos = await precosDoDia(tx, repreco, tabelaPrecoId, hoje);
  // PMC: congelado ao incluir; a troca de tabela o atualiza junto com o preço (os demais mantêm o gravado).
  const pmcs = await pmcsDosMateriais(
    tx,
    repreco.filter((i) => i.tipo === 'material').map((i) => i.id),
  );

  const linhas: LinhaItem[] = [];
  for (const [n, i] of entrada.entries()) {
    const g = anterior(i);
    const item = itemDe(i);
    const base: Omit<Catalogo, 'vendavel' | 'motivo'> = g
      ? {
          codigo: g.codigo,
          descricao: g.descricao,
          unidade: g.unidade,
          formaPreco: g.formaPreco,
          multiplo: g.multiplo,
          fracionada: g.fracionada,
        }
      : (() => {
          const c = cadastro.get(chave(item.tipo, item.id));
          const rotulo = item.tipo === 'material' ? 'Material' : 'Serviço';
          if (!c) throw new ErroHttp(400, `Item ${n + 1}: ${rotulo.toLowerCase()} não encontrado.`);
          if (!c.vendavel) throw new ErroHttp(400, `${rotulo} ${nomeDoItem(c)} ${c.motivo} e não pode ser vendido.`);
          return c;
        })();

    const precoTabela = g && !trocouTabela ? g.precoTabelaCentavos : precos.get(chave(item.tipo, item.id));
    if (precoTabela == null) {
      if (!trocouTabela)
        throw new ErroHttp(400, `${nomeDoItem(base)} não tem preço na tabela escolhida hoje e não pode ser vendido.`);
      avisos.push(`${nomeDoItem(base)} foi removido: não tem preço na nova tabela.`);
      continue;
    }

    // Quantidade vendável (arredonda para cima ao múltiplo).
    let quantidade: number | null = null;
    let tempoMinutos: number | null = null;
    if (base.formaPreco === 'hora') {
      if (i.tempoMinutos == null) throw new ErroHttp(400, `${nomeDoItem(base)}: informe as horas (ex.: 1:30).`);
      tempoMinutos = arredondarMinutos(i.tempoMinutos, base.multiplo);
      if (tempoMinutos !== i.tempoMinutos)
        avisos.push(
          `${nomeDoItem(base)}: horas arredondadas para ${formatarHoras(tempoMinutos)} ` +
            `(múltiplo de ${formatarHoras(base.multiplo)}).`,
        );
    } else {
      if (i.quantidade == null) throw new ErroHttp(400, `${nomeDoItem(base)}: informe a quantidade.`);
      const q = arredondarQuantidade(i.quantidade, base.multiplo, base.fracionada);
      if (q !== Math.round(i.quantidade * 1000) / 1000)
        avisos.push(
          `${nomeDoItem(base)}: quantidade arredondada para ${formatarQuantidade(q)}` +
            (base.multiplo > 1 ? ` (múltiplo de venda ${base.multiplo}).` : ' (só inteira).'),
        );
      quantidade = q;
    }

    // Negociação: só material e só para baixo. Troca de tabela descarta (volta ao preço cheio).
    let precoUnitario = precoTabela;
    let descontoPercentual: number | null = null;
    const negociouServico =
      item.tipo === 'servico' &&
      !trocouTabela &&
      (!!i.descontoPercentual || (i.precoUnitarioCentavos != null && i.precoUnitarioCentavos !== precoTabela));
    if (negociouServico) throw new ErroHttp(400, `${nomeDoItem(base)}: serviço não aceita negociação de preço.`);
    if (item.tipo === 'material' && !trocouTabela) {
      if (i.descontoPercentual != null) {
        descontoPercentual = Math.round(i.descontoPercentual * 100);
        precoUnitario = precoTabela - descontoPorPercentual(precoTabela, descontoPercentual);
        if (descontoPercentual === 0) descontoPercentual = null;
      } else if (i.precoUnitarioCentavos != null) {
        if (i.precoUnitarioCentavos > precoTabela)
          throw new ErroHttp(
            400,
            `${nomeDoItem(base)}: o preço negociado não pode ficar acima do preço da tabela (${formatarMoeda(precoTabela)}).`,
          );
        precoUnitario = i.precoUnitarioCentavos;
      }
    }

    linhas.push(
      comTotais({
        id: g?.id ?? randomUUID(),
        ordem: linhas.length + 1,
        tipo: item.tipo,
        materialId: item.tipo === 'material' ? item.id : null,
        servicoId: item.tipo === 'servico' ? item.id : null,
        ...base,
        quantidade,
        tempoMinutos,
        precoTabelaCentavos: precoTabela,
        precoUnitarioCentavos: precoUnitario,
        descontoPercentual,
        pmcCentavos: item.tipo !== 'material' ? null : g && !trocouTabela ? g.pmcCentavos : (pmcs.get(item.id) ?? null),
        brutoCentavos: 0,
        descontoCentavos: 0,
        totalCentavos: 0,
      }),
    );
  }
  return { linhas, avisos };
}

/**
 * Rascunho aberto em outro dia: preços do dia na mesma tabela.
 * - Material mais caro: preço de tabela novo, mas o cliente mantém o valor que tinha (desconto até ele).
 * - Material mais barato (ou igual): fica o preço novo, sem desconto além do que já dava.
 *   Nos dois casos, vale o menor entre o valor que o cliente tinha e o preço novo.
 * - Serviço: sempre o preço novo (não há negociação).
 * - Sem preço no dia: o item sai do orçamento.
 */
export async function recalcularDoDia(
  tx: Tx,
  gravados: ItemGravado[],
  tabelaPrecoId: string,
  hoje: string,
): Promise<{ linhas: LinhaItem[]; avisos: string[] }> {
  const precos = await precosDoDia(
    tx,
    gravados.map((g) => ({ tipo: g.tipo, id: (g.materialId ?? g.servicoId)! })),
    tabelaPrecoId,
    hoje,
  );
  // O rascunho de outro dia vai aos preços de hoje: o PMC também é o de hoje (não mistura preço novo e custo antigo).
  const pmcs = await pmcsDosMateriais(
    tx,
    gravados.flatMap((g) => (g.materialId ? [g.materialId] : [])),
  );
  const avisos: string[] = [];
  const linhas: LinhaItem[] = [];
  for (const { tenantId: _t, orcamentoId: _o, ...g } of gravados) {
    const novo = precos.get(chave(g.tipo, (g.materialId ?? g.servicoId)!));
    if (novo == null) {
      avisos.push(`${nomeDoItem(g)} foi removido: não tem mais preço na tabela.`);
      continue;
    }
    const precoUnitario = g.tipo === 'material' ? Math.min(g.precoUnitarioCentavos, novo) : novo;
    if (novo !== g.precoTabelaCentavos || precoUnitario !== g.precoUnitarioCentavos)
      avisos.push(
        `${nomeDoItem(g)}: preço de tabela de ${formatarMoeda(g.precoTabelaCentavos)} para ${formatarMoeda(novo)}` +
          (precoUnitario < novo ? `; mantido ${formatarMoeda(precoUnitario)} com desconto.` : '.'),
      );
    linhas.push(
      comTotais({
        ...g,
        ordem: linhas.length + 1,
        precoTabelaCentavos: novo,
        precoUnitarioCentavos: precoUnitario,
        // O percentual digitado só vale se o preço de tabela não mudou.
        descontoPercentual: novo === g.precoTabelaCentavos ? g.descontoPercentual : null,
        pmcCentavos: g.materialId ? (pmcs.get(g.materialId) ?? null) : null,
      }),
    );
  }
  return { linhas, avisos };
}

/** Troca os itens do rascunho (o trigger orcamento_itens_so_no_rascunho garante que só no rascunho). */
export async function gravarItens(tx: Tx, orcamentoId: string, linhas: LinhaItem[]) {
  await tx.delete(orcamentoItens).where(eq(orcamentoItens.orcamentoId, orcamentoId));
  if (linhas.length) await tx.insert(orcamentoItens).values(linhas.map((l) => ({ ...l, orcamentoId })));
}

export const itensDoOrcamento = (tx: Tx, orcamentoId: string) =>
  tx.select().from(orcamentoItens).where(eq(orcamentoItens.orcamentoId, orcamentoId)).orderBy(orcamentoItens.ordem);

/** Histórico. clock_timestamp: dois eventos da mesma transação ficam na ordem em que aconteceram. */
export const registrar = (tx: Tx, orcamentoId: string, evento: EventoOrcamento, usuarioId: string, detalhe?: string) =>
  tx
    .insert(orcamentosEventos)
    .values({ orcamentoId, evento, usuarioId, detalhe: detalhe || null, criadoEm: sql`clock_timestamp()` });

type PrecoDaLinha = {
  id: string;
  codigo: string;
  descricao: string;
  precoTabelaCentavos: number;
  precoUnitarioCentavos: number;
  /** Centésimos (null = preço digitado ou sem desconto). */
  descontoPercentual?: number | null;
};

/** O mesmo percentual que a alçada avalia (por item). */
const percentualDaLinha = (l: PrecoDaLinha) =>
  percentualDoItem(l.precoTabelaCentavos, l.precoUnitarioCentavos, l.descontoPercentual ?? null);
const rotuloDesconto = (centesimos: number) => (centesimos ? formatarPercentual(centesimos) : 'sem desconto');

/**
 * Quem mexeu no desconto e quando (rastreabilidade da aprovação comercial): descreve os itens cujo desconto mudou
 * entre o que estava gravado e o que foi salvo, e o desconto total. null = nenhum desconto mudou.
 */
export function descreverDescontos(antes: PrecoDaLinha[], depois: (PrecoDaLinha & CalculoItem)[]): string | null {
  const anteriores = new Map(antes.map((l) => [l.id, percentualDaLinha(l)]));
  const mudancas = depois.flatMap((l) => {
    const de = anteriores.get(l.id) ?? 0;
    const para = percentualDaLinha(l);
    return de === para ? [] : [`${nomeDoItem(l)}: ${rotuloDesconto(de)} → ${rotuloDesconto(para)}`];
  });
  if (!mudancas.length) return null;
  const totais = somarItens(depois);
  return `${mudancas.join('; ')}. Desconto total: ${rotuloDesconto(percentualDeDesconto(totais.subtotalCentavos, totais.descontoCentavos))}.`;
}
