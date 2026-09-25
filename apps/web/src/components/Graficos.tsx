import type { ReactNode } from 'react';

// Gráficos simples em SVG/HTML próprio (sem biblioteca): poucos, para responder perguntas do painel.
// As cores vêm dos tokens (var(--cor-...)), então acompanham o tema.

export type Fatia = { rotulo: string; valor: number; cor: string; detalhe?: string };

/** Rosca com o total no centro e a legenda ao lado. Sem dados, mostra `vazio`. */
export function GraficoRosca({ fatias, centro, vazio }: { fatias: Fatia[]; centro: ReactNode; vazio: ReactNode }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (!total) return <p className="py-6 text-center text-sm text-texto-suave">{vazio}</p>;
  const raio = 15.915; // circunferência 100: cada % vira 1 unidade de traço
  let acumulado = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r={raio} fill="none" stroke="var(--cor-superficie-alt)" strokeWidth="4" />
          {fatias
            .filter((f) => f.valor > 0)
            .map((f) => {
              const parte = (f.valor / total) * 100;
              const traco = (
                <circle
                  key={f.rotulo}
                  cx="18"
                  cy="18"
                  r={raio}
                  fill="none"
                  stroke={f.cor}
                  strokeWidth="4"
                  strokeDasharray={`${parte} ${100 - parte}`}
                  strokeDashoffset={-acumulado}
                />
              );
              acumulado += parte;
              return traco;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{centro}</div>
      </div>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {fatias.map((f) => (
          <li key={f.rotulo} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} aria-hidden />
            <span className="flex-1 text-texto-suave">{f.rotulo}</span>
            <span className="font-medium tabular-nums">{f.valor.toLocaleString('pt-BR')}</span>
            {f.detalhe && <span className="w-24 text-right text-xs text-texto-suave tabular-nums">{f.detalhe}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras horizontais proporcionais ao maior valor (ranking). */
export function GraficoBarras({
  barras,
  vazio,
}: {
  barras: { rotulo: string; valor: number; texto: string; detalhe?: string }[];
  vazio: ReactNode;
}) {
  const maior = Math.max(0, ...barras.map((b) => b.valor));
  if (!barras.length || !maior) return <p className="py-6 text-center text-sm text-texto-suave">{vazio}</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {barras.map((b) => (
        <li key={b.rotulo}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="truncate text-texto">{b.rotulo}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {b.texto}
              {b.detalhe && <span className="ml-1.5 text-xs font-normal text-texto-suave">{b.detalhe}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-superficie-alt">
            <div className="h-full rounded-full bg-primaria" style={{ width: `${(b.valor / maior) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
