import { formatarHoras, formatarMoeda, formatarPercentual, formatarQuantidade, somarItens } from '@mobios/shared';
import type { ReactNode } from 'react';
import { CardCliente } from './ContextoCliente';
import {
  calculoDaLinha,
  contarItens,
  CONTORNO_ACIMA_DA_ALCADA,
  NomeDoItem,
  percentualDaLinha,
  precoDaLinha,
  useItensAcimaDaAlcada,
  type LinhaTela,
} from './ItensOrcamento';
import { dicaItemAcimaDaAlcada, IndicadorAlcada, PrecoNegociado, Totais } from './Orcamento';
import { Bloco, Cabecalho, Dado, Dica, Linha, Tabela, Td, Th } from './ui';

// Resumo e revisão do orçamento: leem o mesmo estado das etapas (cliente, itens, condições), sem modelo à parte.

export const totaisDasLinhas = (linhas: LinhaTela[]) => somarItens(linhas.map(calculoDaLinha));

/**
 * Resumo do orçamento em faixa (entre as etapas e os itens, para a tabela usar a largura toda): cliente, itens,
 * subtotal, descontos e o total em destaque, o aviso de alçada e, em `situacao`, o estado da gravação.
 */
export function FaixaResumo({
  cliente,
  linhas,
  situacao,
}: {
  cliente: string | null;
  linhas: LinhaTela[];
  situacao?: ReactNode;
}) {
  const t = totaisDasLinhas(linhas);
  return (
    <section
      aria-label="Resumo do orçamento"
      className="rounded-lg border border-borda bg-superficie px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-texto-suave uppercase">Resumo do orçamento</h2>
        {situacao}
      </div>
      <dl className="mt-2 grid grid-cols-2 items-end gap-x-6 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="col-span-2 min-w-0 sm:col-span-4 lg:col-span-1">
          <dt className="text-xs text-texto-suave">Cliente</dt>
          <dd className="truncate font-medium">{cliente ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-texto-suave">Itens</dt>
          <dd className="tabular-nums">{linhas.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-texto-suave">Subtotal</dt>
          <dd className="tabular-nums">{formatarMoeda(t.subtotalCentavos)}</dd>
        </div>
        <div>
          <dt className="text-xs text-texto-suave">Descontos</dt>
          <dd className={`tabular-nums ${t.descontoCentavos ? 'text-sucesso' : ''}`}>
            {t.descontoCentavos ? `−${formatarMoeda(t.descontoCentavos)}` : formatarMoeda(0)}
          </dd>
        </div>
        <div className="sm:text-right">
          <dt className="text-xs font-semibold tracking-wide text-texto-suave uppercase">Total</dt>
          <dd className="text-2xl font-semibold text-texto tabular-nums">{formatarMoeda(t.totalCentavos)}</dd>
        </div>
      </dl>
      <div className="mt-1">
        <IndicadorAlcada percentuais={linhas.map(percentualDaLinha)} />
      </div>
    </section>
  );
}

const quantidadeDaLinha = (l: LinhaTela) =>
  l.formaPreco === 'hora'
    ? `${l.horas || formatarHoras(0)} h`
    : `${l.quantidade || formatarQuantidade(0)} ${l.unidade}`;

/** Etapa "Revisão": cliente, itens, condições comerciais e valores, como serão salvos. */
export function RevisaoOrcamento({
  cliente,
  linhas,
  condicoes,
}: {
  cliente: { id: string; nome: string; ativo: boolean; pendencias: string[] };
  linhas: LinhaTela[];
  /** `largo`: ocupa a linha toda e quebra o texto (ex.: observações). */
  condicoes: { rotulo: string; valor: ReactNode; largo?: boolean }[];
}) {
  const t = totaisDasLinhas(linhas);
  const { alcada, acima } = useItensAcimaDaAlcada();
  return (
    <div className="space-y-4">
      <Bloco titulo="Cliente">
        <CardCliente cliente={cliente} acao={null} />
      </Bloco>
      <Bloco titulo={`Itens · ${contarItens(linhas.length)}`}>
        <Tabela>
          <Cabecalho>
            <Th>Produto</Th>
            <Th className="text-right">Qtd.</Th>
            <Th className="text-right">Unitário</Th>
            <Th className="text-right">Negociação</Th>
            <Th className="text-right">Total</Th>
          </Cabecalho>
          <tbody>
            {linhas.map((l) => {
              const unitario = precoDaLinha(l).unitario;
              const desconto = percentualDaLinha(l);
              return (
                <Linha key={l.chave} className={acima(l) == null ? '' : CONTORNO_ACIMA_DA_ALCADA}>
                  <Td>
                    <NomeDoItem
                      l={l}
                      aviso={
                        acima(l) != null &&
                        alcada != null && (
                          <Dica
                            alerta
                            rotulo={`${l.descricao}: passará por aprovação comercial`}
                            texto={dicaItemAcimaDaAlcada(acima(l)!, alcada)}
                          />
                        )
                      }
                    />
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">{quantidadeDaLinha(l)}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums">
                    <PrecoNegociado
                      precoTabelaCentavos={l.precoTabelaCentavos}
                      precoUnitarioCentavos={unitario}
                      descontoPercentual={desconto / 100}
                    />
                  </Td>
                  <Td suave className="whitespace-nowrap text-right tabular-nums">
                    {desconto ? formatarPercentual(desconto) : '—'}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                    {formatarMoeda(calculoDaLinha(l).totalCentavos)}
                  </Td>
                </Linha>
              );
            })}
          </tbody>
        </Tabela>
      </Bloco>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Condições comerciais">
          <dl className="grid grid-cols-2 gap-3">
            {condicoes.map((c) =>
              c.largo ? (
                <div key={c.rotulo} className="col-span-2">
                  <dt className="text-xs text-texto-suave">{c.rotulo}</dt>
                  <dd className="text-sm whitespace-pre-line text-texto">{c.valor || '—'}</dd>
                </div>
              ) : (
                <Dado key={c.rotulo} rotulo={c.rotulo}>
                  {c.valor}
                </Dado>
              ),
            )}
          </dl>
        </Bloco>
        <Bloco titulo="Valores">
          <div className="space-y-3">
            <Totais subtotal={t.subtotalCentavos} desconto={t.descontoCentavos} total={t.totalCentavos} />
            <IndicadorAlcada percentuais={linhas.map(percentualDaLinha)} />
          </div>
        </Bloco>
      </div>
    </div>
  );
}
