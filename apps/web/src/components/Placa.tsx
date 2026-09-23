import { formatarPlaca } from '@mobios/shared';

const tamanhos = {
  sm: { faixa: 'text-[7px] leading-[10px]', numero: 'px-2 text-xs' },
  md: { faixa: 'text-[8px] leading-3', numero: 'px-2.5 py-0.5 text-sm' },
  lg: { faixa: 'text-[10px] leading-4', numero: 'px-4 py-1 text-xl' },
} as const;

/** Placa desenhada no padrão Mercosul (faixa azul "BRASIL"), para reconhecer o carro de relance. */
export function Placa({ placa, tamanho = 'md' }: { placa: string; tamanho?: keyof typeof tamanhos }) {
  const t = tamanhos[tamanho];
  return (
    <span className="inline-flex flex-col overflow-hidden rounded-md border-2 border-placa-borda bg-placa-fundo text-center shadow-sm" aria-label={`Placa ${formatarPlaca(placa)}`}>
      <span className={`bg-placa-faixa font-bold tracking-[0.2em] text-placa-faixa-texto ${t.faixa}`} aria-hidden>
        BRASIL
      </span>
      <span className={`font-mono font-bold tracking-wider whitespace-nowrap text-placa-texto ${t.numero}`}>{formatarPlaca(placa)}</span>
    </span>
  );
}
