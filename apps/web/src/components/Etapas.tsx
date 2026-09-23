import { Check } from 'lucide-react';

/**
 * Indicador de etapas do cadastro. No cadastro novo só dá para voltar às etapas já feitas;
 * na edição (`livre`), qualquer etapa pode ser aberta.
 */
export function Etapas({
  titulos,
  atual,
  aoIr,
  livre = false,
  comErro = [],
}: {
  titulos: string[];
  atual: number;
  aoIr: (i: number) => void;
  livre?: boolean;
  comErro?: number[];
}) {
  return (
    <ol className="flex items-start">
      {titulos.map((titulo, i) => {
        const feita = !livre && i < atual;
        const clicavel = livre || i < atual;
        const erro = comErro.includes(i);
        const circulo = erro
          ? 'border-perigo bg-perigo-suave text-perigo'
          : i === atual
            ? 'border-primaria bg-primaria text-sobre-primaria'
            : feita
              ? 'border-primaria bg-primaria-suave text-primaria'
              : 'border-borda-forte bg-superficie text-texto-suave';
        return (
          <li key={titulo} className="flex flex-1 items-start last:flex-none">
            <button
              type="button"
              disabled={!clicavel}
              onClick={() => aoIr(i)}
              aria-current={i === atual ? 'step' : undefined}
              className="group flex flex-col items-center gap-1.5 disabled:cursor-default"
            >
              <span
                className={`flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${circulo} ${clicavel && i !== atual ? 'group-hover:border-primaria' : ''}`}
              >
                {feita && !erro ? <Check className="size-4" aria-hidden /> : i + 1}
              </span>
              <span
                className={`text-center text-xs ${i === atual ? 'font-semibold text-texto' : 'text-texto-suave'} max-sm:sr-only`}
              >
                {titulo}
              </span>
            </button>
            {i < titulos.length - 1 && (
              <span
                className={`mx-2 mt-[18px] h-0.5 flex-1 rounded ${feita ? 'bg-primaria' : 'bg-borda'}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
