import type { ReactNode } from 'react';
import { Link } from 'react-router';

// Gráficos simples em SVG/HTML próprio (sem biblioteca): poucos, para responder perguntas do painel.
// As cores vêm dos tokens (var(--cor-...)), então acompanham o tema.

/** `para`: a linha da legenda leva à lista filtrada (ex.: orçamentos daquela situação). */
export type Fatia = { rotulo: string; valor: number; cor: string; detalhe?: string; para?: string };

const pct = (parte: number, total: number) =>
  `${((parte / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;

/** Rosca com o total no centro e a legenda em tabela ao lado (quantidade, % e detalhe). Sem dados, mostra `vazio`. */
export function GraficoRosca({ fatias, centro, vazio }: { fatias: Fatia[]; centro: ReactNode; vazio: ReactNode }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (!total) return <p className="py-6 text-center text-sm text-texto-suave">{vazio}</p>;
  const raio = 15.915; // circunferência 100: cada % vira 1 unidade de traço
  let acumulado = 0;
  return (
    <div className="flex flex-col items-center gap-x-6 gap-y-4 sm:flex-row sm:flex-wrap">
      <div className="relative mx-auto size-36 shrink-0 sm:mx-0">
        <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r={raio} fill="none" stroke="var(--cor-superficie-alt)" strokeWidth="3.5" />
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
                  strokeWidth="3.5"
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
      <ul className="w-full divide-y divide-borda text-sm sm:w-auto sm:min-w-56 sm:flex-1">
        {fatias.map((f) => {
          const linha = (
            <>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-texto" title={f.rotulo}>
                {f.rotulo}
              </span>
              <span className="w-8 text-right font-semibold tabular-nums">{f.valor.toLocaleString('pt-BR')}</span>
              <span className="w-10 text-right text-xs text-texto-suave tabular-nums">{pct(f.valor, total)}</span>
              {f.detalhe && <span className="w-24 text-right text-xs text-texto-suave tabular-nums">{f.detalhe}</span>}
            </>
          );
          return (
            <li key={f.rotulo}>
              {f.para ? (
                <Link
                  to={f.para}
                  className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-superficie-alt focus-visible:outline-2 focus-visible:outline-primaria"
                >
                  {linha}
                </Link>
              ) : (
                <div className="flex items-center gap-2 py-1.5">{linha}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Ranking em linhas compactas: nome, barra proporcional ao maior valor, valor e detalhe (ex.: quantidade). Em telas
 * estreitas, a barra desce para baixo do nome.
 */
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
    <ul className="divide-y divide-borda text-sm">
      {barras.map((b) => (
        <li
          key={b.rotulo}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
        >
          <span className="truncate font-medium text-texto">{b.rotulo}</span>
          <div className="order-last col-span-2 h-1.5 rounded-full bg-superficie-alt sm:order-none sm:col-span-1">
            <div className="h-full rounded-full bg-primaria" style={{ width: `${(b.valor / maior) * 100}%` }} />
          </div>
          <span className="text-right whitespace-nowrap tabular-nums">
            <span className="font-semibold">{b.texto}</span>
            {b.detalhe && <span className="ml-2 text-xs text-texto-suave">{b.detalhe}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
