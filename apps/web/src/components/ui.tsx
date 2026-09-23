/*
 * Componentes base do style guide. Use sempre estes em vez de classes soltas:
 * cores só por tokens (bg-primaria, text-texto-suave...), definidos em src/index.css.
 */
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TdHTMLAttributes, TextareaHTMLAttributes, ThHTMLAttributes } from 'react';

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
/**
 * Campo com máscara aplicada enquanto se digita (CPF, CNPJ, telefone, CEP, placa...).
 * Use com `register`: `<InputMascara registro={form.register('telefone')} mascara={mascaraTelefone} />`.
 * A máscara só formata; quem valida e tira a pontuação é o schema.
 */
export const InputMascara = ({ registro, mascara, ...props }: InputHTMLAttributes<HTMLInputElement> & { registro: UseFormRegisterReturn; mascara: (v: string) => string }) => (
  <Input
    autoComplete="off"
    {...props}
    {...registro}
    onChange={(e) => {
      e.target.value = mascara(e.target.value);
      registro.onChange(e);
    }}
  />
);

export const AreaTexto = ({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} className={`${base} ${className}`} {...props} />
);

/** Caixa de seleção com rótulo ao lado (use com `register`). */
export const Marcador = ({ rotulo, ...props }: InputHTMLAttributes<HTMLInputElement> & { rotulo: ReactNode }) => (
  <label className="flex items-center gap-2 text-sm text-texto">
    <input type="checkbox" className="size-4 accent-primaria" {...props} />
    {rotulo}
  </label>
);

/** Bloco de formulário com título (ex.: "Contato", "Endereços"). */
export const Secao = ({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) => (
  <section className="space-y-4 border-t border-borda pt-5 first:border-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-texto-suave">{titulo}</h3>
      {acao}
    </div>
    {children}
  </section>
);

type Variante = 'primario' | 'secundario' | 'perigo';

const coresBotao: Record<Variante, string> = {
  primario: 'bg-botao-primario text-botao-primario-texto hover:bg-botao-primario-hover',
  secundario: 'border border-botao-secundario-borda bg-botao-secundario text-botao-secundario-texto hover:bg-botao-secundario-hover',
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

type Tom = 'sucesso' | 'neutro' | 'primario' | 'alerta';

const coresSelo: Record<Tom, string> = {
  sucesso: 'bg-sucesso-suave text-sucesso',
  neutro: 'bg-superficie-alt text-texto-suave',
  primario: 'bg-primaria-suave text-primaria',
  alerta: 'bg-alerta-suave text-alerta',
};

export const Selo = ({ tom = 'neutro', titulo, children }: { tom?: Tom; titulo?: string; children: ReactNode }) => (
  <span title={titulo} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${coresSelo[tom]}`}>
    {children}
  </span>
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

// ---------- Abas ----------

/** Abas de uma página (ex.: perfil do cliente). `contagem` aparece ao lado do rótulo. */
export function Abas<T extends string>({ abas, atual, aoTrocar }: { abas: { id: T; rotulo: string; contagem?: number }[]; atual: T; aoTrocar: (id: T) => void }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-borda" role="tablist">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={a.id === atual}
          onClick={() => aoTrocar(a.id)}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
            a.id === atual ? 'border-primaria font-medium text-primaria' : 'border-transparent text-texto-suave hover:text-texto'
          }`}
        >
          {a.rotulo}
          {a.contagem != null && (
            <span className={`rounded-full px-1.5 text-xs ${a.id === atual ? 'bg-primaria-suave' : 'bg-superficie-alt'}`}>{a.contagem}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** Estado vazio amigável: ícone, mensagem e ação opcional. */
export const Vazio = ({ icone, titulo, children, acao }: { icone: ReactNode; titulo: string; children?: ReactNode; acao?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-borda-forte px-6 py-12 text-center">
    <span className="text-texto-suave [&>svg]:size-10">{icone}</span>
    <p className="font-medium text-texto">{titulo}</p>
    {children && <p className="max-w-md text-sm text-texto-suave">{children}</p>}
    {acao && <div className="mt-2">{acao}</div>}
  </div>
);
