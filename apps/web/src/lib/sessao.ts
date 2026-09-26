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

/**
 * Papel no módulo de orçamentos (docs/modulos/ORCAMENTOS.md §5): o Administrador vê e altera todos; o vendedor ativo,
 * só os próprios (com o vendedor fixo nele); os demais só consultam. A API aplica as mesmas regras.
 */
/** O.S. (docs/modulos/ORDENS_SERVICO.md §7): a tela só esconde o que a API também bloqueia. */
export function usePerfilOs() {
  const sessao = useSessao().data;
  const admin = !!sessao?.usuario.admin;
  return {
    podeVer: admin || !!sessao?.vendedorId || temAcesso(sessao?.acessos, 'os'),
    podeAbrir: admin || temAcesso(sessao?.acessos, 'os', 'editar'),
    mecanico: !!sessao?.mecanico,
  };
}

export function usePerfilOrcamento() {
  const sessao = useSessao().data;
  const vendedorId = sessao?.vendedorId ?? null;
  const admin = !!sessao?.usuario.admin;
  return {
    vendedorId,
    podeVer: admin || !!vendedorId || temAcesso(sessao?.acessos, 'orcamentos'),
    podeAlterar: admin || !!vendedorId,
    podeAprovar: temAcesso(sessao?.acessos, 'aprovar_orcamentos', 'editar'),
  };
}
