import { useId } from 'react';

// Marca do produto MobiOS (engrenagem com "M" vazado). Os mesmos traços estão em public/favicon.svg.
const ENGRENAGEM = 'M12.39 4.34L13.13 1.07L18.87 1.07L19.61 4.34A12.2 12.2 0 0 1 21.69 5.21L24.52 3.42L28.58 7.48L26.79 10.31A12.2 12.2 0 0 1 27.66 12.39L30.93 13.13L30.93 18.87L27.66 19.61A12.2 12.2 0 0 1 26.79 21.69L28.58 24.52L24.52 28.58L21.69 26.79A12.2 12.2 0 0 1 19.61 27.66L18.87 30.93L13.13 30.93L12.39 27.66A12.2 12.2 0 0 1 10.31 26.79L7.48 28.58L3.42 24.52L5.21 21.69A12.2 12.2 0 0 1 4.34 19.61L1.07 18.87L1.07 13.13L4.34 12.39A12.2 12.2 0 0 1 5.21 10.31L3.42 7.48L7.48 3.42L10.31 5.21A12.2 12.2 0 0 1 12.39 4.34Z';
const LETRA_M = 'M10.6 21.2V11.4L16 17.2L21.4 11.4V21.2';

/** Símbolo da marca. Usa currentColor: segue a cor do texto em volta (ex.: text-primaria do tema da oficina). */
export function MarcaMobiOS({ className = 'size-8', titulo }: { className?: string; titulo?: string }) {
  const mascara = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} role={titulo ? 'img' : undefined} aria-hidden={titulo ? undefined : true}>
      {titulo && <title>{titulo}</title>}
      <mask id={mascara}>
        <rect width="32" height="32" fill="white" />
        <path d={LETRA_M} fill="none" stroke="black" strokeWidth={2.9} strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <path d={ENGRENAGEM} fill="currentColor" mask={`url(#${mascara})`} />
    </svg>
  );
}

/**
 * Símbolo + nome, para quando a oficina ainda não enviou o próprio logo.
 * `herdarCor`: usa a cor do texto em volta (no menu lateral, garante contraste com o fundo do menu).
 */
export function LogoMobiOS({ tamanho = 'md', herdarCor = false }: { tamanho?: 'md' | 'lg'; herdarCor?: boolean }) {
  const [icone, texto] = tamanho === 'lg' ? ['size-10', 'text-2xl'] : ['size-7', 'text-lg'];
  const destaque = herdarCor ? '' : 'text-primaria';
  return (
    <span className="inline-flex items-center gap-2">
      <MarcaMobiOS className={`${icone} ${destaque}`} />
      <span className={`${texto} font-bold`}>
        Mobi<span className={destaque}>OS</span>
      </span>
    </span>
  );
}

/** Rodapé do produto, em todas as telas. */
export function Rodape() {
  return (
    <footer className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-texto-suave">
      <MarcaMobiOS className="size-4" />
      <span>{new Date().getFullYear()} - MobiOS Oficina - Sistema de Gestão Empresarial</span>
    </footer>
  );
}
