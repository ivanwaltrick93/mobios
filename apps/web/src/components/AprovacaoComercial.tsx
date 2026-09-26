import {
  dentroDaAlcada,
  STATUS_APROVACAO_COMERCIAL,
  type AprovacaoComercial,
  type AprovacaoComercialResumo,
  type StatusAprovacaoComercial,
} from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { usePode, useSessao } from '../lib/sessao';
import { useMinhaAlcada } from './Orcamento';
import { AreaTexto, Botao, Campo, Confirmacao, Selo, useNotificar, type Tom } from './ui';

const TOM_STATUS: Record<StatusAprovacaoComercial, Tom> = {
  pendente: 'alerta',
  aprovada: 'sucesso',
  reprovada: 'perigo',
  cancelada: 'neutro',
};

export const SeloAprovacao = ({ status }: { status: StatusAprovacaoComercial }) => (
  <Selo ponto tom={TOM_STATUS[status]}>
    {STATUS_APROVACAO_COMERCIAL[status]}
  </Selo>
);

/**
 * O usuário pode decidir esta solicitação? Na lista, calculado aqui com a mesma regra da API (pendente, não é o
 * solicitante, permissão e alçada suficiente); no detalhe, vem pronto da API (`podeDecidir`).
 */
export function usePodeDecidir() {
  const pode = usePode();
  const usuarioId = useSessao().data?.usuario.id;
  const alcada = useMinhaAlcada().data;
  return (a: AprovacaoComercialResumo) =>
    'podeDecidir' in a
      ? (a as AprovacaoComercial).podeDecidir
      : a.status === 'pendente' &&
        a.solicitanteId !== usuarioId &&
        pode('aprovacao_comercial', 'editar') &&
        !!alcada &&
        dentroDaAlcada(a.percentual, alcada.percentual);
}

/** Botões Aprovar (verde) e Reprovar (vermelho, pede a justificativa), com a versão lida da solicitação. */
export function AcoesDecisao({ aprovacao }: { aprovacao: AprovacaoComercialResumo }) {
  const queryClient = useQueryClient();
  const notificar = useNotificar();
  const [decidindo, setDecidindo] = useState<'aprovar' | 'reprovar' | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const decidir = useMutation({
    mutationFn: (acao: 'aprovar' | 'reprovar') =>
      api<AprovacaoComercial>(`/aprovacoes-comerciais/${aprovacao.id}/${acao}`, {
        method: 'POST',
        body: { versao: aprovacao.versao, ...(acao === 'reprovar' ? { justificativa } : {}) },
      }),
    onSuccess: (resultado, acao) => {
      setDecidindo(null);
      setJustificativa('');
      queryClient.setQueryData(['aprovacoes-comerciais', aprovacao.id], resultado);
      queryClient.invalidateQueries({ queryKey: ['aprovacoes-comerciais'] });
      queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      notificar(
        acao === 'aprovar'
          ? `${aprovacao.documentoNumero} aprovado comercialmente e emitido.`
          : `${aprovacao.documentoNumero} reprovado comercialmente.`,
      );
    },
  });
  return (
    <>
      <Botao variante="sucesso" onClick={() => setDecidindo('aprovar')}>
        <CheckCircle2 className="mr-1.5 size-4" aria-hidden /> Aprovar
      </Botao>
      <Botao variante="perigo" onClick={() => setDecidindo('reprovar')}>
        <XCircle className="mr-1.5 size-4" aria-hidden /> Reprovar
      </Botao>
      {decidindo && (
        <Confirmacao
          titulo={decidindo === 'aprovar' ? 'Aprovar desconto' : 'Reprovar desconto'}
          mensagem={
            decidindo === 'aprovar'
              ? `${aprovacao.documentoNumero} (versão ${aprovacao.documentoVersao}) será emitido. Ficam registrados o seu usuário, a sua função e a sua alçada.`
              : `${aprovacao.documentoNumero} (versão ${aprovacao.documentoVersao}) fica reprovado comercialmente. Para corrigir o desconto, o vendedor gera uma nova versão.`
          }
          rotuloConfirmar={decidindo === 'aprovar' ? 'Aprovar' : 'Reprovar'}
          perigo={decidindo === 'reprovar'}
          carregando={decidir.isPending}
          erro={decidir.isError && decidir.error.message}
          aoConfirmar={() => decidir.mutate(decidindo)}
          aoFechar={() => {
            setDecidindo(null);
            decidir.reset();
          }}
        >
          {decidindo === 'reprovar' && (
            <Campo rotulo="Motivo da reprovação">
              <AreaTexto
                rows={3}
                maxLength={500}
                required
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: desconto acima da política comercial vigente."
              />
            </Campo>
          )}
        </Confirmacao>
      )}
    </>
  );
}
