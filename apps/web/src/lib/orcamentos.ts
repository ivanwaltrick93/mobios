import { hojeIso, type Orcamento, type TabelaParaOrcamento, type VendedorParaOrcamento } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { usePerfilOrcamento } from './sessao';

/**
 * Orçamento pelo id. Rascunho de outro dia é recalculado ao abrir (uma vez), por quem pode editar: a API aplica os
 * preços do dia e devolve os avisos do que mudou.
 */
export function useOrcamento(id: string) {
  const podeEditar = usePerfilOrcamento().podeAlterar;
  const queryClient = useQueryClient();
  const [avisos, setAvisos] = useState<string[]>([]);
  const orcamento = useQuery({ queryKey: ['orcamentos', id], queryFn: () => api<Orcamento>(`/orcamentos/${id}`) });
  const recalcular = useMutation({
    mutationFn: () => api<Orcamento>(`/orcamentos/${id}/recalcular`, { method: 'POST' }),
    onSuccess: (o) => {
      queryClient.setQueryData(['orcamentos', id], o);
      queryClient.invalidateQueries({ queryKey: ['orcamentos'], refetchType: 'none' });
      setAvisos(o.avisos);
    },
  });
  const o = orcamento.data;
  const precisaRecalcular = podeEditar && o?.status === 'rascunho' && o.precosEm < hojeIso();
  const { mutate, isIdle } = recalcular;
  useEffect(() => {
    if (precisaRecalcular && isIdle) mutate();
  }, [precisaRecalcular, isIdle, mutate]);
  return { orcamento, recalculando: recalcular.isPending, erroRecalculo: recalcular.error, avisos, setAvisos };
}

export const useVendedoresOrcamento = () =>
  useQuery({
    queryKey: ['orcamentos', 'apoio', 'vendedores'],
    queryFn: () => api<VendedorParaOrcamento[]>('/orcamentos/apoio/vendedores'),
  });

export const useTabelasOrcamento = (habilitado = true) =>
  useQuery({
    queryKey: ['orcamentos', 'apoio', 'tabelas'],
    queryFn: () => api<TabelaParaOrcamento[]>('/orcamentos/apoio/tabelas'),
    enabled: habilitado,
  });
