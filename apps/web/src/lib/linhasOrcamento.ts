import {
  arredondarMinutos,
  arredondarQuantidade,
  calcularItem,
  descontoPorPercentual,
  formatarHoras,
  formatarQuantidade,
  horasParaMinutos,
  mascaraMoeda,
  moedaParaCentavos,
  paraMilesimos,
  percentualDoItem,
  percentualParaNumero,
  quantidadeParaNumero,
  type ItemOrcamento,
  type ItemOrcamentoInput,
  type ItemVendavel,
} from '@mobios/shared';

// Linha do orçamento como a pessoa digita (docs/modulos/ORCAMENTOS.md §2): conversões e contas puras, sem React.

/** Item na tela: quantidade, horas e negociação como texto (como a pessoa digita). */
export type LinhaTela = {
  chave: string;
  id?: string;
  tipo: ItemOrcamento['tipo'];
  itemId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  formaPreco: ItemOrcamento['formaPreco'];
  multiplo: number;
  fracionada: boolean;
  precoTabelaCentavos: number;
  quantidade: string;
  horas: string;
  modo: 'percentual' | 'preco';
  percentual: string;
  preco: string;
  nota?: string;
};

export const linhaDoItem = (i: ItemOrcamento): LinhaTela => ({
  chave: i.id,
  id: i.id,
  tipo: i.tipo,
  itemId: (i.materialId ?? i.servicoId)!,
  codigo: i.codigo,
  descricao: i.descricao,
  unidade: i.unidade,
  formaPreco: i.formaPreco,
  multiplo: i.multiplo,
  fracionada: i.fracionada,
  precoTabelaCentavos: i.precoTabelaCentavos,
  quantidade: i.quantidade != null ? formatarQuantidade(i.quantidade) : '',
  horas: i.tempoMinutos != null ? formatarHoras(i.tempoMinutos) : '',
  modo: i.descontoPercentual == null && i.precoUnitarioCentavos < i.precoTabelaCentavos ? 'preco' : 'percentual',
  percentual: i.descontoPercentual ? String(i.descontoPercentual).replace('.', ',') : '',
  preco:
    i.descontoPercentual == null && i.precoUnitarioCentavos < i.precoTabelaCentavos
      ? mascaraMoeda(String(i.precoUnitarioCentavos))
      : '',
});

export const linhaNova = (v: ItemVendavel): LinhaTela => ({
  chave: crypto.randomUUID(),
  tipo: v.tipo,
  itemId: v.id,
  codigo: v.codigo,
  descricao: v.descricao,
  unidade: v.unidade,
  formaPreco: v.formaPreco,
  multiplo: v.multiplo,
  fracionada: v.fracionada,
  precoTabelaCentavos: v.precoCentavos!,
  // Começa pela menor quantidade vendável: o múltiplo (caixa master) ou as horas do serviço.
  quantidade: v.formaPreco === 'hora' ? '' : formatarQuantidade(v.formaPreco ? 1 : v.multiplo),
  horas: v.formaPreco === 'hora' ? formatarHoras(v.multiplo) : '',
  modo: 'percentual',
  percentual: '',
  preco: '',
});

/** Preço negociado da linha (só material) e erro, se o preço digitado passar do de tabela. */
export function precoDaLinha(l: LinhaTela): { unitario: number; percentual: number | null; erro?: string } {
  if (l.tipo === 'servico') return { unitario: l.precoTabelaCentavos, percentual: null };
  if (l.modo === 'percentual') {
    const p = percentualParaNumero(l.percentual);
    if (!p) return { unitario: l.precoTabelaCentavos, percentual: null };
    const centesimos = Math.round(p * 100);
    return {
      unitario: l.precoTabelaCentavos - descontoPorPercentual(l.precoTabelaCentavos, centesimos),
      percentual: p,
    };
  }
  const preco = moedaParaCentavos(l.preco);
  if (preco == null) return { unitario: l.precoTabelaCentavos, percentual: null };
  if (preco > l.precoTabelaCentavos) return { unitario: preco, percentual: null, erro: 'Acima do preço da tabela' };
  return { unitario: preco, percentual: null };
}

const quantidadeDaLinha = (l: LinhaTela) =>
  l.formaPreco === 'hora'
    ? { tempoMinutos: horasParaMinutos(l.horas) || 0 }
    : { quantidadeMilesimos: paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0) };

/** Percentual de desconto do item (centésimos), o mesmo que a alçada avalia na emissão (por item). */
export const percentualDaLinha = (l: LinhaTela) => {
  const { unitario, percentual } = precoDaLinha(l);
  return percentualDoItem(l.precoTabelaCentavos, unitario, percentual == null ? null : Math.round(percentual * 100));
};

export const calculoDaLinha = (l: LinhaTela) =>
  calcularItem(l.precoTabelaCentavos, precoDaLinha(l).unitario, quantidadeDaLinha(l));

/** O que a API recebe: o id do item gravado (mantém o preço guardado) e a negociação (só material). */
export function itemParaApi(l: LinhaTela): ItemOrcamentoInput {
  const negociacao = precoDaLinha(l);
  return {
    id: l.id,
    tipo: l.tipo,
    ...(l.tipo === 'material' ? { materialId: l.itemId } : { servicoId: l.itemId }),
    ...(l.formaPreco === 'hora' ? { tempoMinutos: l.horas } : { quantidade: quantidadeParaNumero(l.quantidade) ?? 0 }),
    ...(l.tipo === 'material' &&
      (l.modo === 'percentual'
        ? { descontoPercentual: negociacao.percentual }
        : { precoUnitarioCentavos: moedaParaCentavos(l.preco) })),
  };
}

/**
 * Passo do seletor: o múltiplo de venda do material, as horas do serviço (valor-hora) ou 1 (preço fechado).
 * Sobe ou desce para o próximo múltiplo; nunca abaixo de um múltiplo (para tirar o item, use a lixeira).
 */
export function darPasso(l: LinhaTela, direcao: 1 | -1): LinhaTela {
  const proximo = (atual: number, passo: number) =>
    direcao > 0 ? (Math.floor(atual / passo) + 1) * passo : Math.max(passo, (Math.ceil(atual / passo) - 1) * passo);
  if (l.formaPreco === 'hora')
    return { ...l, horas: formatarHoras(proximo(horasParaMinutos(l.horas) || 0, l.multiplo)), nota: undefined };
  const atual = paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0);
  return { ...l, quantidade: formatarQuantidade(proximo(atual, l.multiplo * 1000) / 1000), nota: undefined };
}

export const podeDiminuir = (l: LinhaTela) =>
  l.formaPreco === 'hora'
    ? (horasParaMinutos(l.horas) || 0) > l.multiplo
    : paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0) > l.multiplo * 1000;

/** Arredonda ao sair do campo e explica por quê (a API faz o mesmo ao salvar). */
export function arredondar(l: LinhaTela): LinhaTela {
  if (l.formaPreco === 'hora') {
    const minutos = horasParaMinutos(l.horas);
    if (!minutos) return l;
    const certo = arredondarMinutos(minutos, l.multiplo);
    return certo === minutos
      ? { ...l, nota: undefined }
      : {
          ...l,
          horas: formatarHoras(certo),
          nota: `Arredondado para ${formatarHoras(certo)} (múltiplo de ${formatarHoras(l.multiplo)})`,
        };
  }
  const q = quantidadeParaNumero(l.quantidade);
  if (!q) return l;
  const certo = arredondarQuantidade(q, l.multiplo, l.fracionada);
  if (certo === q) return { ...l, nota: undefined };
  return {
    ...l,
    quantidade: formatarQuantidade(certo),
    nota:
      l.multiplo > 1
        ? `Arredondado para ${formatarQuantidade(certo)} (múltiplo de venda ${l.multiplo})`
        : `Arredondado para ${formatarQuantidade(certo)} (só inteiro)`,
  };
}

/** "1 item", "2 itens". */
export const contarItens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/** Filtro da busca por tipo de item (campo `tipo` do catálogo: material ou serviço). */
export const FILTROS_TIPO = { '': 'Todos', material: 'Produtos', servico: 'Serviços' } as const;
export type FiltroTipoItem = keyof typeof FILTROS_TIPO;

/**
 * Linha pronta para gravar: quantidade (ou horas) informada e negociação válida. A gravação automática espera as
 * outras (a API recusaria).
 */
export const linhaValida = (l: LinhaTela) =>
  !precoDaLinha(l).erro &&
  (l.formaPreco === 'hora' ? !!horasParaMinutos(l.horas) : !!quantidadeParaNumero(l.quantidade));

/** Inclui o item escolhido na busca; se já está no orçamento, soma um múltiplo na linha existente. */
export const incluir = (atuais: LinhaTela[], i: ItemVendavel) =>
  atuais.some((l) => l.tipo === i.tipo && l.itemId === i.id)
    ? atuais.map((l) => (l.tipo === i.tipo && l.itemId === i.id ? darPasso(l, 1) : l))
    : [...atuais, linhaNova(i)];
