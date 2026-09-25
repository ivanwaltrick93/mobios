import { createContext, useContext, useEffect } from 'react';

/** Último elemento da trilha (breadcrumb) definido pela página: o nome do registro aberto (ex.: o cliente). */
export const ContextoTrilha = createContext<(rotulo: string | null) => void>(() => {});

/** Na página de detalhe: `useTrilha(cliente?.nome)` completa a trilha do topo ("Clientes › Maria Silva"). */
export function useTrilha(rotulo: string | null | undefined) {
  const definir = useContext(ContextoTrilha);
  useEffect(() => {
    definir(rotulo ?? null);
    return () => definir(null);
  }, [rotulo, definir]);
}
