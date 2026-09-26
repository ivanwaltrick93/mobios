import {
  dentroDaAlcada,
  formatarDataIso,
  formatarMoeda,
  formatarPercentual,
  formatarPlaca,
  percentualDeDesconto,
  percentualDoDesconto,
  SITUACOES_ORCAMENTO,
  type AprovacaoDoDocumento,
  type MinhaAlcada,
  type Orcamento,
  type SituacaoOrcamento,
} from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CheckCircle2, TriangleAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { Selo, type Tom } from './ui';

const TOM_SITUACAO: Record<SituacaoOrcamento, Tom> = {
  rascunho: 'neutro',
  aguardando_aprovacao_comercial: 'alerta',
  reprovado_comercialmente: 'perigo',
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

/**
 * Atributos do cabeçalho do orçamento (Resumo e edição): emissão, validade, tabela, veículo e vendedor.
 * `comCliente`: inclui o cliente (na edição, onde o título é o número).
 */
export function atributosDoOrcamento(o: Orcamento, comCliente = false) {
  return [
    ...(comCliente ? [{ rotulo: 'Cliente', valor: <ClienteDoOrcamento cliente={o.cliente} /> }] : []),
    { rotulo: 'Emissão', valor: o.emitidoEm ? new Date(o.emitidoEm).toLocaleDateString('pt-BR') : 'Não emitido' },
    { rotulo: 'Validade', valor: o.validadeAte ? formatarDataIso(o.validadeAte) : 'Definida na emissão' },
    { rotulo: 'Tabela de preço', valor: o.tabela.nome },
    {
      rotulo: 'Veículo',
      valor: o.veiculo ? `${formatarPlaca(o.veiculo.placa)} — ${o.veiculo.marca} ${o.veiculo.modelo}` : 'Sem veículo',
    },
    { rotulo: 'Vendedor', valor: `${o.vendedor.nome}${o.vendedor.ativo ? '' : ' (inativo)'}` },
  ];
}

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR');

/**
 * Aprovação comercial dentro do orçamento (docs/modulos/APROVACAO_COMERCIAL.md §Indicador): por que está
 * aguardando, quem reprovou e por quê, ou quem aprovou e com qual alçada, sem precisar abrir outra tela.
 */
export function AvisoAprovacaoComercial({ aprovacao }: { aprovacao: AprovacaoDoDocumento | null }) {
  const pode = usePode();
  if (!aprovacao) return null;
  const a = aprovacao;
  const motivo =
    `Desconto de ${formatarPercentual(a.percentual)} excede a alçada de ${formatarPercentual(a.alcadaSolicitante)}` +
    `${a.solicitanteFuncao ? ` (${a.solicitanteFuncao})` : ''}.`;
  const decisor = `${a.decisor ?? '—'}${a.decisorFuncao ? ` (${a.decisorFuncao}` : ''}${
    a.alcadaDecisor != null ? `, alçada de ${formatarPercentual(a.alcadaDecisor)})` : a.decisorFuncao ? ')' : ''
  }`;
  const link = pode('aprovacao_comercial') && (
    <Link to={`/aprovacoes-comerciais/${a.id}`} className="font-medium underline">
      Ver aprovação
    </Link>
  );
  const caixa = (tom: string, icone: ReactNode, titulo: string, texto: ReactNode) => (
    <div role="status" className={`flex gap-2.5 rounded-md px-3 py-2.5 text-sm ${tom}`}>
      {icone}
      <div className="space-y-0.5">
        <p className="font-semibold">{titulo}</p>
        <p>{texto}</p>
        {link && <p>{link}</p>}
      </div>
    </div>
  );
  if (a.status === 'pendente')
    return caixa(
      'bg-alerta-suave text-alerta',
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />,
      'Aguardando aprovação comercial',
      `Motivo: ${motivo} Pedido por ${a.solicitante} em ${dataHora(a.criadoEm)}. Será emitido quando aprovado.`,
    );
  if (a.status === 'reprovada')
    return caixa(
      'bg-perigo-suave text-perigo',
      <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />,
      'Reprovado comercialmente',
      `${motivo} Reprovado por ${decisor} em ${dataHora(a.decididoEm!)}: ${a.justificativa ?? ''} ` +
        'Para corrigir o desconto, gere uma nova versão.',
    );
  if (a.status === 'aprovada')
    return caixa(
      'bg-sucesso-suave text-sucesso',
      <BadgeCheck className="mt-0.5 size-5 shrink-0" aria-hidden />,
      'Aprovado comercialmente',
      `Desconto de ${formatarPercentual(a.percentual)} aprovado por ${decisor} em ${dataHora(a.decididoEm!)}.`,
    );
  return (
    <p className="text-xs text-texto-suave">
      Pedido de aprovação comercial cancelado em {dataHora(a.decididoEm!)}. Ao emitir de novo, o desconto é reavaliado.
    </p>
  );
}

/** Alçada do usuário logado (a maior entre as funções ativas). */
export const useMinhaAlcada = () =>
  useQuery({ queryKey: ['alcadas', 'minha'], queryFn: () => api<MinhaAlcada>('/alcadas/minha'), staleTime: 60_000 });

/**
 * Desconto total × alçada de quem está logado (a mesma regra da emissão, docs/modulos/APROVACAO_COMERCIAL.md): dentro
 * da alçada ou "aprovação comercial necessária ao emitir". Sem desconto, nada. Não decide nada: só antecipa.
 */
export function IndicadorAlcada({ subtotal, desconto }: { subtotal: number; desconto: number }) {
  const alcada = useMinhaAlcada().data;
  const percentual = percentualDeDesconto(subtotal, desconto);
  if (!alcada || !percentual) return null;
  const dentro = dentroDaAlcada(percentual, alcada.percentual);
  const Icone = dentro ? CheckCircle2 : TriangleAlert;
  return (
    <p role="status" className={`flex items-start gap-1.5 text-xs ${dentro ? 'text-sucesso' : 'text-alerta'}`}>
      <Icone className="mt-px size-4 shrink-0" aria-hidden />
      <span>
        Desconto total de {formatarPercentual(percentual)}:{' '}
        {dentro
          ? `dentro da sua alçada (${formatarPercentual(alcada.percentual)}).`
          : `aprovação comercial necessária ao emitir (sua alçada é ${formatarPercentual(alcada.percentual)}).`}
      </span>
    </p>
  );
}
