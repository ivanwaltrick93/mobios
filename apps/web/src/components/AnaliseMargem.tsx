import {
  formatarMoeda,
  formatarPercentual,
  formatarQuantidade,
  percentualDoItem,
  type SnapshotComercial,
  type ValoresMargem,
} from '@mobios/shared';
import { Bloco, Cabecalho, Dado, Linha, Tabela, Td, TextoSuave, Th } from './ui';

// Análise de margem da aprovação comercial (docs/modulos/APROVACAO_COMERCIAL.md §Margem): indicador de apoio ao
// aprovador, lido do retrato da solicitação (PMC congelado). Só para quem tem "Custos e margem" (a API também só
// devolve a margem a eles). Sem faixas de "boa" ou "ruim": só os números.

/** Custo e margem podem ter frações de centavo (custo exato): arredonda só para exibir. */
const moeda = (centavos: number) => formatarMoeda(Math.round(centavos));
const percentual = (p: number | null) =>
  p == null ? 'Não calculada' : `${p.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const Comparativo = ({ sem, com }: { sem: ValoresMargem; com: ValoresMargem }) => (
  <Tabela>
    <Cabecalho>
      <Th>Impacto da negociação</Th>
      <Th className="text-right">Sem desconto</Th>
      <Th className="text-right">Com desconto</Th>
    </Cabecalho>
    <tbody>
      {(
        [
          ['Receita', moeda(sem.receitaCentavos), moeda(com.receitaCentavos)],
          ['Custo (PMC)', moeda(sem.custoCentavos), moeda(com.custoCentavos)],
          ['Margem R$', moeda(sem.margemCentavos), moeda(com.margemCentavos)],
          ['Margem %', percentual(sem.margemPercentual), percentual(com.margemPercentual)],
        ] as const
      ).map(([rotulo, a, b]) => (
        <Linha key={rotulo}>
          <Td suave>{rotulo}</Td>
          <Td className="text-right tabular-nums">{a}</Td>
          <Td className="text-right font-medium tabular-nums">{b}</Td>
        </Linha>
      ))}
    </tbody>
  </Tabela>
);

export function AnaliseMargem({ snapshot }: { snapshot: SnapshotComercial }) {
  const m = snapshot.margem;
  if (!m)
    return (
      <Bloco titulo="Análise de margem">
        <TextoSuave>Análise de margem não disponível (pedido anterior à margem).</TextoSuave>
      </Bloco>
    );
  const servicos = m.servicosExcluidos;
  return (
    <Bloco titulo="Análise de margem">
      <div className="space-y-4">
        {m.comDesconto ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Dado rotulo="Venda líquida dos produtos">{moeda(m.comDesconto.receitaCentavos)}</Dado>
            <Dado rotulo="Custo total (PMC)">{moeda(m.comDesconto.custoCentavos)}</Dado>
            <Dado rotulo="Margem">{moeda(m.comDesconto.margemCentavos)}</Dado>
            <Dado rotulo="Margem %">{percentual(m.comDesconto.margemPercentual)}</Dado>
          </dl>
        ) : (
          <p className="text-sm">
            <strong>Margem consolidada: não disponível.</strong>{' '}
            {m.produtosSemPmc
              ? `${m.produtosSemPmc} ${m.produtosSemPmc === 1 ? 'produto não possui' : 'produtos não possuem'} PMC válido.`
              : 'Nenhum produto no orçamento.'}
          </p>
        )}
        <TextoSuave className="text-xs">
          {m.produtosConsiderados} {m.produtosConsiderados === 1 ? 'produto considerado' : 'produtos considerados'}
          {servicos > 0 && ` · ${servicos} ${servicos === 1 ? 'serviço não considerado' : 'serviços não considerados'}`}
          {m.produtosSemPmc > 0 && ` · ${m.produtosSemPmc} sem PMC`} · Serviços ficam fora da margem; o total do
          orçamento ({moeda(snapshot.totalCentavos)}) os inclui. Calculada em{' '}
          {new Date(m.calculadoEm).toLocaleString('pt-BR')}.
        </TextoSuave>

        {m.comDesconto && m.semDesconto && <Comparativo sem={m.semDesconto} com={m.comDesconto} />}

        <Tabela>
          <Cabecalho>
            <Th>Item</Th>
            <Th className="text-right">Qtd.</Th>
            <Th className="text-right">Preço tabela</Th>
            <Th className="text-right">Desconto</Th>
            <Th className="text-right">Preço líquido</Th>
            <Th className="text-right">PMC</Th>
            <Th className="text-right">Venda líquida</Th>
            <Th className="text-right">Custo</Th>
            <Th className="text-right">Margem</Th>
            <Th className="text-right">Margem %</Th>
          </Cabecalho>
          <tbody>
            {m.itens.map((mi) => {
              const i = snapshot.itens[mi.indice]!;
              const desconto = i.percentual ?? percentualDoItem(i.precoTabelaCentavos, i.precoUnitarioCentavos, null);
              return (
                <Linha key={mi.indice}>
                  <Td className="min-w-40">
                    <div className="font-medium">{i.descricao}</div>
                    <div className="font-mono text-xs text-texto-suave">{i.codigo}</div>
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">
                    {i.quantidade != null ? formatarQuantidade(i.quantidade) : '—'}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">{formatarMoeda(i.precoTabelaCentavos)}</Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">
                    {desconto ? formatarPercentual(desconto) : '—'}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular-nums">
                    {formatarMoeda(i.precoUnitarioCentavos)}
                  </Td>
                  {mi.considerado && mi.comDesconto ? (
                    <>
                      <Td className="text-right whitespace-nowrap tabular-nums">{moeda(mi.pmcCentavos!)}</Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">
                        {moeda(mi.comDesconto.receitaCentavos)}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">
                        {moeda(mi.comDesconto.custoCentavos)}
                      </Td>
                      <Td className="text-right font-medium whitespace-nowrap tabular-nums">
                        {moeda(mi.comDesconto.margemCentavos)}
                      </Td>
                      <Td className="text-right font-medium whitespace-nowrap tabular-nums">
                        {percentual(mi.comDesconto.margemPercentual)}
                      </Td>
                    </>
                  ) : (
                    <Td colSpan={5} suave className="text-right text-xs">
                      {mi.motivo === 'servico'
                        ? `Não considerado no cálculo de margem (serviço · ${formatarMoeda(i.totalCentavos)})`
                        : 'PMC: não disponível · Margem: não calculada'}
                    </Td>
                  )}
                </Linha>
              );
            })}
          </tbody>
        </Tabela>
      </div>
    </Bloco>
  );
}
