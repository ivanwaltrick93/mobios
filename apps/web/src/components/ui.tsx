/*
 * Componentes base do style guide. Use sempre estes em vez de classes soltas:
 * cores só por tokens (bg-primaria, text-texto-suave...), definidos em src/index.css.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

const base =
  'block w-full rounded-md border border-borda-forte bg-superficie px-3 py-2 text-sm text-texto shadow-sm placeholder:text-texto-suave focus:border-primaria focus:outline-none focus:ring-1 focus:ring-primaria disabled:bg-superficie-alt';

type CampoProps = { rotulo: string; erro?: { message?: string }; dica?: string; children: ReactNode };

export function Campo({ rotulo, erro, dica, children }: CampoProps) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-texto">{rotulo}</span>
      {children}
      {erro?.message ? <span className="text-xs text-perigo">{erro.message}</span> : dica && <span className="text-xs text-texto-suave">{dica}</span>}
    </label>
  );
}

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`${base} ${className}`} {...props} />
);
export const Select = ({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`${base} ${className}`} {...props} />
);

type Variante = 'primario' | 'secundario' | 'perigo';

const coresBotao: Record<Variante, string> = {
  primario: 'bg-primaria text-sobre-primaria hover:bg-primaria-hover',
  secundario: 'border border-borda-forte bg-superficie text-texto hover:bg-superficie-alt',
  perigo: 'bg-perigo text-sobre-perigo hover:bg-perigo-hover',
};

export const classesBotao = (variante: Variante = 'primario', className = '') =>
  `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition disabled:opacity-50 ${coresBotao[variante]} ${className}`;

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante };

export const Botao = ({ variante = 'primario', className = '', ...props }: BotaoProps) => (
  <button className={classesBotao(variante, className)} {...props} />
);

/** Ação discreta em texto (ex.: "Editar" numa linha de tabela). */
export const BotaoLink = ({ perigo, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { perigo?: boolean }) => (
  <button className={`text-sm hover:underline ${perigo ? 'text-perigo' : 'text-primaria'} ${className}`} {...props} />
);

export const Alerta = ({ children }: { children: ReactNode }) =>
  children ? <div className="rounded-md bg-perigo-suave px-3 py-2 text-sm text-perigo">{children}</div> : null;

/** `className` substitui o padding padrão (p-6), evitando classes de padding conflitantes. */
export const Cartao = ({ children, className = 'p-6' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-lg border border-borda bg-superficie shadow-sm ${className}`}>{children}</div>
);

export const Titulo = ({ children, acao }: { children: ReactNode; acao?: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <h1 className="text-2xl font-semibold text-texto">{children}</h1>
    {acao}
  </div>
);

export const TextoSuave = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-sm text-texto-suave ${className}`}>{children}</p>
);

type Tom = 'sucesso' | 'neutro' | 'primario';

const coresSelo: Record<Tom, string> = {
  sucesso: 'bg-sucesso-suave text-sucesso',
  neutro: 'bg-superficie-alt text-texto-suave',
  primario: 'bg-primaria-suave text-primaria',
};

export const Selo = ({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${coresSelo[tom]}`}>{children}</span>
);

// ---------- Tabela ----------

export const Tabela = ({ children }: { children: ReactNode }) => (
  <Cartao className="overflow-x-auto">
    <table className="w-full text-left text-sm">{children}</table>
  </Cartao>
);

export const Cabecalho = ({ children }: { children: ReactNode }) => (
  <thead className="border-b border-borda bg-superficie-alt text-texto-suave">
    <tr>{children}</tr>
  </thead>
);

export const Th = ({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={`whitespace-nowrap px-4 py-3 font-medium ${className}`} {...props} />
);

export const Linha = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <tr className={`border-b border-borda last:border-0 ${className}`}>{children}</tr>
);

export const Td = ({ suave, className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement> & { suave?: boolean }) => (
  <td className={`px-4 py-3 ${suave ? 'text-texto-suave' : ''} ${className}`} {...props} />
);

export const LinhaVazia = ({ colunas, children }: { colunas: number; children: ReactNode }) => (
  <tr>
    <td colSpan={colunas} className="px-4 py-8 text-center text-texto-suave">
      {children}
    </td>
  </tr>
);
