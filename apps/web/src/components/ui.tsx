import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';


const base = 'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-marca-600 focus:outline-none focus:ring-1 focus:ring-marca-600';

type CampoProps = { rotulo: string; erro?: { message?: string }; children: ReactNode };

export function Campo({ rotulo, erro, children }: CampoProps) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{rotulo}</span>
      {children}
      {erro?.message && <span className="text-xs text-red-600">{erro.message}</span>}
    </label>
  );
}

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`${base} ${className}`} {...props} />
);
export const Select = ({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`${base} ${className}`} {...props} />
);

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' };

export function Botao({ variante = 'primario', className = '', ...props }: BotaoProps) {
  const cores = {
    primario: 'bg-marca-600 text-white hover:bg-marca-700',
    secundario: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    perigo: 'bg-red-600 text-white hover:bg-red-700',
  }[variante];
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition disabled:opacity-50 ${cores} ${className}`}
      {...props}
    />
  );
}

export const Alerta = ({ children }: { children: ReactNode }) =>
  children ? <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div> : null;

/** `className` substitui o padding padrão (p-6), evitando classes de padding conflitantes. */
export const Cartao = ({ children, className = 'p-6' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
);
