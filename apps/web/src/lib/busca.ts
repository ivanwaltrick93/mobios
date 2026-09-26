import { useEffect, useState } from 'react';

/** Espera depois da última tecla antes de buscar: digitar "fernando" faz uma busca, não oito. */
export const ESPERA_BUSCA_MS = 300;

/** O valor, mas só depois de `espera` ms sem mudar (o texto da busca que vai para a API). */
export function useValorAdiado<T>(valor: T, espera = ESPERA_BUSCA_MS): T {
  const [adiado, setAdiado] = useState(valor);
  useEffect(() => {
    const temporizador = setTimeout(() => setAdiado(valor), espera);
    return () => clearTimeout(temporizador);
  }, [valor, espera]);
  return adiado;
}
