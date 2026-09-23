import { temAcesso, type ModuloId, type Nivel, type Sessao } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const chaveSessao = ['sessao'] as const;

export const useSessao = () =>
  useQuery({ queryKey: chaveSessao, queryFn: () => api<Sessao>('/auth/sessao'), retry: false, staleTime: 5 * 60_000 });

/**
 * `usePode()('clientes', 'editar')`: esconde da tela o que a API bloquearia.
 * Níveis vêm das funções do usuário (Configurações → Funções e permissões).
 */
export function usePode() {
  const acessos = useSessao().data?.acessos;
  return (modulo: ModuloId, nivel: Nivel = 'consultar') => temAcesso(acessos, modulo, nivel);
}

/** Usuários, funções e configurações são exclusivos da função Administrador. */
export const useAdmin = () => !!useSessao().data?.usuario.admin;
