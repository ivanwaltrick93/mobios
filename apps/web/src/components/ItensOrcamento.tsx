import {
  dentroDaAlcada,
  arredondarMinutos,
  arredondarQuantidade,
  calcularItem,
  descontoPorPercentual,
  formatarHoras,
  formatarMoeda,
  formatarQuantidade,
  horasParaMinutos,
  mascaraHoras,
  mascaraMoeda,
  mascaraPercentual,
  mascaraQuantidade,
  moedaParaCentavos,
  paraMilesimos,
  percentualDoItem,
  percentualParaNumero,
  quantidadeParaNumero,
  TIPOS_ITEM_PRECO,
  type ItemOrcamento,
  type ItemOrcamentoInput,
  type ItemVendavel,
} from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Minus, PackageSearch, Plus, Search, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { dicaItemAcimaDaAlcada, PrecoNegociado, useMinhaAlcada } from './Orcamento';
import { Botao, Cabecalho, Dica, Input, Linha, Select, Selo, Tabela, Td, TextoSuave, Th, Vazio } from './ui';

// Itens do orçamento (docs/modulos/ORCAMENTOS.md §2): a linha como a pessoa digita, as contas e a etapa de itens.

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

const linhaNova = (v: ItemVendavel): LinhaTela => ({
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

/** Itens acima da alçada de quem está logado: `acima(l)` devolve o percentual do item se passa, senão null. */
export function useItensAcimaDaAlcada() {
  const alcada = useMinhaAlcada().data?.percentual;
  return {
    alcada,
    acima: (l: LinhaTela) => {
      const p = percentualDaLinha(l);
      return alcada != null && !dentroDaAlcada(p, alcada) ? p : null;
    },
  };
}

/** Contorno laranja da linha (item acima da alçada). */
export const CONTORNO_ACIMA_DA_ALCADA = 'outline-2 -outline-offset-2 outline-alerta';

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
function darPasso(l: LinhaTela, direcao: 1 | -1): LinhaTela {
  const proximo = (atual: number, passo: number) =>
    direcao > 0 ? (Math.floor(atual / passo) + 1) * passo : Math.max(passo, (Math.ceil(atual / passo) - 1) * passo);
  if (l.formaPreco === 'hora')
    return { ...l, horas: formatarHoras(proximo(horasParaMinutos(l.horas) || 0, l.multiplo)), nota: undefined };
  const atual = paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0);
  return { ...l, quantidade: formatarQuantidade(proximo(atual, l.multiplo * 1000) / 1000), nota: undefined };
}

const podeDiminuir = (l: LinhaTela) =>
  l.formaPreco === 'hora'
    ? (horasParaMinutos(l.horas) || 0) > l.multiplo
    : paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0) > l.multiplo * 1000;

const BotaoPasso = ({
  rotulo,
  aoClicar,
  disabled,
  children,
}: {
  rotulo: string;
  aoClicar: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    title={rotulo}
    aria-label={rotulo}
    disabled={disabled}
    onClick={aoClicar}
    className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-borda-forte text-texto-suave hover:bg-superficie-alt hover:text-texto focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none disabled:opacity-40"
  >
    {children}
  </button>
);

/** Arredonda ao sair do campo e explica por quê (a API faz o mesmo ao salvar). */
function arredondar(l: LinhaTela): LinhaTela {
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
export const FILTROS_TIPO = { '': 'Todos', material: 'Materiais', servico: 'Serviços' } as const;
export type FiltroTipoItem = keyof typeof FILTROS_TIPO;

/**
 * Linha pronta para gravar: quantidade (ou horas) informada e negociação válida. A gravação automática espera as
 * outras (a API recusaria).
 */
export const linhaValida = (l: LinhaTela) =>
  !precoDaLinha(l).erro &&
  (l.formaPreco === 'hora' ? !!horasParaMinutos(l.horas) : !!quantidadeParaNumero(l.quantidade));

/** Id do campo de busca (o estado vazio da tabela leva o foco até ele). */
const ID_BUSCA = 'busca-item-orcamento';

/**
 * Busca de material ou serviço com o preço de hoje na tabela e, no material, o estoque livre. Sem preço: aparece,
 * mas não entra. A partir de 2 letras.
 */
function BuscaItem({
  tabelaPrecoId,
  tipo,
  aoEscolher,
}: {
  tabelaPrecoId: string;
  tipo: FiltroTipoItem;
  aoEscolher: (i: ItemVendavel) => void;
}) {
  const [busca, setBusca] = useState('');
  const pronto = busca.trim().length >= 2;
  const resultados = useQuery({
    queryKey: ['orcamentos', 'apoio', 'itens', tabelaPrecoId, tipo, busca],
    queryFn: () =>
      api<ItemVendavel[]>(`/orcamentos/apoio/itens?${new URLSearchParams({ q: busca.trim(), tabelaPrecoId, tipo })}`),
    enabled: pronto,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-suave" aria-hidden />
        <Input
          id={ID_BUSCA}
          className="pl-9"
          aria-label="Buscar material ou serviço"
          placeholder={`Buscar ${tipo === 'material' ? 'material' : tipo === 'servico' ? 'serviço' : 'material ou serviço'} por SKU, código ou descrição… (ao menos 2 letras)`}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {pronto && (
        <ul className="mt-2 max-h-80 divide-y divide-borda overflow-y-auto rounded-md border border-borda shadow-sm">
          {resultados.data?.map((i) => (
            <li key={`${i.tipo}:${i.id}`}>
              <button
                type="button"
                disabled={i.precoCentavos == null}
                className="group flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-primaria-suave disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                onClick={() => {
                  aoEscolher(i);
                  setBusca('');
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-texto">{i.descricao}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-texto-suave">
                    <Selo tom={i.tipo === 'servico' ? 'primario' : 'neutro'}>{TIPOS_ITEM_PRECO[i.tipo]}</Selo>
                    <span className="font-mono">
                      {i.tipo === 'material' ? 'SKU' : 'Código'} {i.codigo}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-texto-suave">
                  {i.precoCentavos == null ? (
                    <span className="text-perigo">Sem preço nesta tabela: não pode ser vendido</span>
                  ) : (
                    <>
                      <span className="block text-sm font-semibold text-texto tabular-nums">
                        {formatarMoeda(i.precoCentavos)}
                        {i.formaPreco === 'hora' ? '/hora' : ''}
                      </span>
                      Preço de tabela
                    </>
                  )}
                  {i.estoque != null && (
                    <span className="block tabular-nums">
                      Estoque: {formatarQuantidade(i.estoque)} {i.unidade}
                    </span>
                  )}
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-texto-suave group-hover:text-primaria group-disabled:invisible"
                  aria-hidden
                />
              </button>
            </li>
          ))}
          {resultados.isFetching && !resultados.data && <TextoSuave className="px-3 py-2">Buscando…</TextoSuave>}
          {resultados.data?.length === 0 && <TextoSuave className="px-3 py-2">Nada encontrado.</TextoSuave>}
        </ul>
      )}
    </div>
  );
}

type PropsLinha = { l: LinhaTela; aoMudar: (chave: string, mudanca: (l: LinhaTela) => LinhaTela) => void };

/**
 * Quantidade da linha: − / campo / + (passo = múltiplo de venda ou horas do serviço) e a unidade. Material e preço
 * fechado mostram o código da unidade; serviço por hora, uma dica com a unidade de cobrança e o múltiplo.
 */
function ControleQuantidade({ l, aoMudar }: PropsLinha) {
  const porHora = l.formaPreco === 'hora';
  const mudar = (mudanca: Partial<LinhaTela>) => aoMudar(l.chave, (x) => ({ ...x, ...mudanca }));
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <BotaoPasso
          rotulo={`Diminuir ${porHora ? 'horas' : 'quantidade'} de ${l.descricao}`}
          disabled={!podeDiminuir(l)}
          aoClicar={() => aoMudar(l.chave, (x) => darPasso(x, -1))}
        >
          <Minus className="size-4" aria-hidden />
        </BotaoPasso>
        {porHora ? (
          <Input
            aria-label={`Horas de ${l.descricao}`}
            className="w-24 text-center tabular-nums"
            inputMode="numeric"
            placeholder="0:00"
            value={l.horas}
            onChange={(e) => mudar({ horas: mascaraHoras(e.target.value), nota: undefined })}
            onBlur={() => aoMudar(l.chave, arredondar)}
          />
        ) : (
          <Input
            aria-label={`Quantidade de ${l.descricao}`}
            className="w-24 text-center tabular-nums"
            inputMode="decimal"
            value={l.quantidade}
            onChange={(e) => mudar({ quantidade: mascaraQuantidade(e.target.value, l.fracionada), nota: undefined })}
            onBlur={() => aoMudar(l.chave, arredondar)}
          />
        )}
        <BotaoPasso
          rotulo={`Aumentar ${porHora ? 'horas' : 'quantidade'} de ${l.descricao}`}
          aoClicar={() => aoMudar(l.chave, (x) => darPasso(x, 1))}
        >
          <Plus className="size-4" aria-hidden />
        </BotaoPasso>
        {porHora ? (
          <Dica
            rotulo={`Unidade de cobrança de ${l.descricao}`}
            texto={`Unidade de cobrança: hora · tempo em horas:minutos, em múltiplos de ${formatarHoras(l.multiplo)}`}
          />
        ) : (
          <span className="min-w-8 text-xs font-medium text-texto-suave" title="Unidade">
            {l.unidade}
          </span>
        )}
      </div>
      {l.multiplo > 1 && !porHora && (
        <span className="mt-1 block text-xs text-texto-suave">Múltiplo de {l.multiplo}</span>
      )}
      {l.nota && <span className="mt-1 block text-xs text-alerta">{l.nota}</span>}
    </div>
  );
}

/** Preço de tabela e negociado; no serviço por hora, "/h" discreto embaixo. */
const PrecoDaLinha = ({ l }: { l: LinhaTela }) => (
  <>
    <PrecoNegociado
      precoTabelaCentavos={l.precoTabelaCentavos}
      precoUnitarioCentavos={precoDaLinha(l).unitario}
      descontoPercentual={percentualDaLinha(l) / 100}
    />
    {l.formaPreco === 'hora' && <span className="block text-xs text-texto-suave">/h</span>}
  </>
);

/** Negociação (só material): por percentual ou preço digitado, nunca acima do de tabela. */
function CampoNegociacao({ l, aoMudar }: PropsLinha) {
  if (l.tipo === 'servico')
    return (
      <span className="text-xs text-texto-suave" title="Serviço não aceita negociação de preço">
        — Não negociável
      </span>
    );
  const negociacao = precoDaLinha(l);
  const mudar = (mudanca: Partial<LinhaTela>) => aoMudar(l.chave, (x) => ({ ...x, ...mudanca }));
  // Grade de duas colunas: o seletor (% ou R$) com a largura fixa da primeira, o campo com o resto. Os dois são
  // w-full (classe base do kit), e cada um preenche a sua célula: mesma posição em todas as linhas.
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-1.5">
      <Select
        aria-label={`Forma de negociação de ${l.descricao}`}
        value={l.modo}
        onChange={(e) => mudar({ modo: e.target.value as LinhaTela['modo'], percentual: '', preco: '' })}
      >
        <option value="percentual">%</option>
        <option value="preco">R$</option>
      </Select>
      <div className="min-w-0">
        {l.modo === 'percentual' ? (
          <Input
            aria-label={`Desconto em % de ${l.descricao}`}
            className="tabular-nums"
            inputMode="decimal"
            placeholder="0"
            value={l.percentual}
            onChange={(e) => mudar({ percentual: mascaraPercentual(e.target.value) })}
          />
        ) : (
          <Input
            aria-label={`Preço negociado de ${l.descricao}`}
            className="tabular-nums"
            inputMode="numeric"
            placeholder={mascaraMoeda(String(l.precoTabelaCentavos))}
            value={l.preco}
            onChange={(e) => mudar({ preco: mascaraMoeda(e.target.value) })}
          />
        )}
        {negociacao.erro && <span className="mt-1 block text-xs text-perigo">{negociacao.erro}</span>}
      </div>
    </div>
  );
}

/** Total da linha, com o bruto riscado quando há desconto. */
function TotalDaLinha({ l }: { l: LinhaTela }) {
  const calculo = calculoDaLinha(l);
  return (
    <>
      {calculo.descontoCentavos > 0 && (
        <s className="block text-xs font-normal text-texto-suave">{formatarMoeda(calculo.brutoCentavos)}</s>
      )}
      {formatarMoeda(calculo.totalCentavos)}
    </>
  );
}

const BotaoRemover = ({ l, aoRemover }: { l: LinhaTela; aoRemover: (chave: string) => void }) => (
  <button
    type="button"
    title="Remover item"
    aria-label={`Remover ${l.descricao}`}
    className="inline-flex size-9 items-center justify-center rounded-md text-texto-suave hover:bg-superficie-alt hover:text-perigo"
    onClick={() => aoRemover(l.chave)}
  >
    <Trash2 className="size-4" aria-hidden />
  </button>
);

/** Descrição e código; `aviso`: ícone discreto ao lado (ex.: passará por aprovação comercial). */
export const NomeDoItem = ({ l, aviso }: { l: LinhaTela; aviso?: ReactNode }) => (
  <>
    <div className="flex items-start gap-1">
      <span className="min-w-0 font-medium">{l.descricao}</span>
      {aviso && <span className="-my-2 shrink-0">{aviso}</span>}
    </div>
    <div className="font-mono text-xs text-texto-suave">
      {l.tipo === 'material' ? 'SKU' : 'Código'} {l.codigo}
    </div>
  </>
);

/**
 * Itens do orçamento: tabela a partir de 768 px; abaixo, um cartão por item (item, quantidade, preço, negociação,
 * total, remover), sem rolagem lateral. Os mesmos campos e contas nos dois formatos.
 */
function TabelaItens({
  linhas,
  aoMudar,
  aoRemover,
}: {
  linhas: LinhaTela[];
  aoMudar: PropsLinha['aoMudar'];
  aoRemover: (chave: string) => void;
}) {
  const { alcada, acima } = useItensAcimaDaAlcada();
  const aviso = (l: LinhaTela) => {
    const p = acima(l);
    return p == null || alcada == null ? undefined : (
      <Dica
        alerta
        rotulo={`${l.descricao}: passará por aprovação comercial`}
        texto={dicaItemAcimaDaAlcada(p, alcada)}
      />
    );
  };
  return (
    <>
      <div className="hidden md:block">
        <Tabela>
          <Cabecalho>
            <Th>Item</Th>
            <Th className="w-[13rem]">Quantidade</Th>
            <Th className="text-right">Preço</Th>
            <Th className="w-[12rem]">Negociação</Th>
            <Th className="w-[7rem] text-right">Total</Th>
            <Th className="w-12" />
          </Cabecalho>
          <tbody>
            {linhas.map((l) => (
              <Linha key={l.chave} className={acima(l) == null ? '' : CONTORNO_ACIMA_DA_ALCADA}>
                <Td className="min-w-40">
                  <NomeDoItem l={l} aviso={aviso(l)} />
                </Td>
                <Td className="min-w-[13rem]">
                  <ControleQuantidade l={l} aoMudar={aoMudar} />
                </Td>
                <Td className="text-right whitespace-nowrap tabular-nums">
                  <PrecoDaLinha l={l} />
                </Td>
                <Td className="min-w-[12rem]">
                  <CampoNegociacao l={l} aoMudar={aoMudar} />
                </Td>
                <Td className="text-right font-semibold whitespace-nowrap tabular-nums">
                  <TotalDaLinha l={l} />
                </Td>
                <Td className="text-right">
                  <BotaoRemover l={l} aoRemover={aoRemover} />
                </Td>
              </Linha>
            ))}
          </tbody>
        </Tabela>
      </div>
      <ul className="space-y-2 md:hidden">
        {linhas.map((l) => (
          <li
            key={l.chave}
            className={`space-y-3 rounded-md border p-3 ${acima(l) == null ? 'border-borda' : 'border-alerta ring-1 ring-alerta'}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <NomeDoItem l={l} aviso={aviso(l)} />
              </div>
              <BotaoRemover l={l} aoRemover={aoRemover} />
            </div>
            <ControleQuantidade l={l} aoMudar={aoMudar} />
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-xs text-texto-suave">Preço</span>
              <span className="text-right tabular-nums">
                <PrecoDaLinha l={l} />
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-texto-suave">Negociação</span>
              <CampoNegociacao l={l} aoMudar={aoMudar} />
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-borda pt-2">
              <span className="text-xs text-texto-suave">Total</span>
              <span className="text-right font-semibold tabular-nums">
                <TotalDaLinha l={l} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Inclui o item escolhido na busca; se já está no orçamento, soma um múltiplo na linha existente. */
const incluir = (atuais: LinhaTela[], i: ItemVendavel) =>
  atuais.some((l) => l.tipo === i.tipo && l.itemId === i.id)
    ? atuais.map((l) => (l.tipo === i.tipo && l.itemId === i.id ? darPasso(l, 1) : l))
    : [...atuais, linhaNova(i)];

/**
 * Etapa "Produtos e serviços" do orçamento: busca, tabela de itens (quantidade por múltiplo, negociação só de
 * material, remover) e o estado vazio. Os cálculos são os do shared; a API recalcula ao salvar.
 */
export function ItensOrcamento({
  linhas,
  aoMudarLinhas,
  tabelaPrecoId,
  tipo,
  aoMudarTipo,
}: {
  linhas: LinhaTela[];
  aoMudarLinhas: (mudanca: (atuais: LinhaTela[]) => LinhaTela[]) => void;
  tabelaPrecoId: string;
  /** Filtro da busca (Todos, Materiais, Serviços): só da tela, não é gravado. */
  tipo: FiltroTipoItem;
  aoMudarTipo: (tipo: FiltroTipoItem) => void;
}) {
  return (
    <section aria-labelledby="titulo-itens" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="titulo-itens" className="text-base font-semibold text-texto">
            Produtos e serviços
          </h2>
          <p className="text-sm text-texto-suave">Adicione os produtos e serviços que farão parte deste orçamento.</p>
        </div>
        <span className="text-xs text-texto-suave">{contarItens(linhas.length)}</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Tipo de item na busca"
        className="inline-flex rounded-md border border-borda-forte p-0.5"
      >
        {Object.entries(FILTROS_TIPO).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={tipo === valor}
            onClick={() => aoMudarTipo(valor as FiltroTipoItem)}
            className={`rounded px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none ${
              tipo === valor ? 'bg-primaria text-sobre-primaria' : 'text-texto-suave hover:bg-superficie-alt'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <BuscaItem
        tabelaPrecoId={tabelaPrecoId}
        tipo={tipo}
        aoEscolher={(i) => aoMudarLinhas((atuais) => incluir(atuais, i))}
      />
      {linhas.length === 0 ? (
        <Vazio
          icone={<PackageSearch />}
          titulo="Nenhum item adicionado"
          acao={
            <Botao type="button" variante="secundario" onClick={() => document.getElementById(ID_BUSCA)?.focus()}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar item
            </Botao>
          }
        >
          Pesquise um produto ou serviço para começar.
        </Vazio>
      ) : (
        <TabelaItens
          linhas={linhas}
          aoMudar={(chave, mudanca) =>
            aoMudarLinhas((atuais) => atuais.map((l) => (l.chave === chave ? mudanca(l) : l)))
          }
          aoRemover={(chave) => aoMudarLinhas((atuais) => atuais.filter((l) => l.chave !== chave))}
        />
      )}
    </section>
  );
}
