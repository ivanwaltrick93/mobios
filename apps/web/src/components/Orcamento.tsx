import { formatarMoeda, percentualDoDesconto, SITUACOES_ORCAMENTO, type SituacaoOrcamento } from '@mobios/shared';
import { TriangleAlert } from 'lucide-react';
import { Selo } from './ui';

const TOM_SITUACAO: Record<SituacaoOrcamento, 'sucesso' | 'neutro' | 'primario' | 'alerta'> = {
  rascunho: 'neutro',
  emitido: 'primario',
  enviado: 'primario',
  aprovado: 'sucesso',
  recusado: 'alerta',
  vencido: 'alerta',
  cancelado: 'neutro',
};

export const SeloSituacao = ({ situacao }: { situacao: SituacaoOrcamento }) => (
  <Selo tom={TOM_SITUACAO[situacao]}>{SITUACOES_ORCAMENTO[situacao]}</Selo>
);

/** Nome do cliente com o ícone de alerta quando está inativo ou com cadastro incompleto (não impede o orçamento). */
export function ClienteDoOrcamento({ cliente }: { cliente: { nome: string; ativo: boolean; pendencias: string[] } }) {
  const alertas = [
    !cliente.ativo && 'Cliente inativo',
    cliente.pendencias.length > 0 && `Cadastro incompleto: falta ${cliente.pendencias.join(', ')}`,
  ].filter(Boolean) as string[];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium text-texto">{cliente.nome}</span>
      {alertas.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs text-alerta" title={alertas.join('. ')}>
          <TriangleAlert className="size-4" aria-hidden />
          {alertas.join(' · ')}
        </span>
      )}
    </span>
  );
}

/** Preço do item: negociado com o de tabela riscado e o percentual ao lado (~~R$ 125,00~~ R$ 112,50 −10%). */
export function PrecoNegociado({
  precoTabelaCentavos,
  precoUnitarioCentavos,
  descontoPercentual,
}: {
  precoTabelaCentavos: number;
  precoUnitarioCentavos: number;
  descontoPercentual?: number | null;
}) {
  if (precoUnitarioCentavos >= precoTabelaCentavos) return <>{formatarMoeda(precoUnitarioCentavos)}</>;
  const percentual = descontoPercentual ?? percentualDoDesconto(precoTabelaCentavos, precoUnitarioCentavos);
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
      <s className="text-xs text-texto-suave">{formatarMoeda(precoTabelaCentavos)}</s>
      <span className="font-medium">{formatarMoeda(precoUnitarioCentavos)}</span>
      <span className="text-xs text-sucesso">−{percentual.toLocaleString('pt-BR')}%</span>
    </span>
  );
}

/** Subtotal (preço de tabela), descontos e total. */
export const Totais = ({ subtotal, desconto, total }: { subtotal: number; desconto: number; total: number }) => (
  <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
    <div className="flex justify-between">
      <dt className="text-texto-suave">Subtotal</dt>
      <dd>{formatarMoeda(subtotal)}</dd>
    </div>
    <div className="flex justify-between">
      <dt className="text-texto-suave">Descontos</dt>
      <dd className={desconto ? 'text-sucesso' : ''}>{desconto ? `−${formatarMoeda(desconto)}` : formatarMoeda(0)}</dd>
    </div>
    <div className="flex justify-between border-t border-borda pt-1 text-base font-semibold">
      <dt>Total</dt>
      <dd>{formatarMoeda(total)}</dd>
    </div>
  </dl>
);
