import type { Sessao } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const chaveSessao = ['sessao'] as const;

export const useSessao = () =>
  useQuery({ queryKey: chaveSessao, queryFn: () => api<Sessao>('/auth/sessao'), retry: false, staleTime: 5 * 60_000 });
