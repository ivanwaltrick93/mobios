import { ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Selo } from './base';

/** Cabeçalho de página (PageHeader): título, contexto opcional e ações à direita. */
export const CabecalhoPagina = ({
  titulo,
  subtitulo,
  acoes,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-texto">{titulo}</h1>
      {subtitulo && <p className="mt-0.5 text-sm text-texto-suave">{subtitulo}</p>}
    </div>
    {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
  </div>
);

/** Linha de ações ou controles lado a lado (Toolbar). */
export const BarraFerramentas = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
);

/** Estado de carregamento padrão (LoadingState). */
export const Carregando = ({ texto = 'Carregando…' }: { texto?: string }) => (
  <div role="status" className="flex items-center gap-2 py-6 text-sm text-texto-suave">
    <Loader2 className="size-4 animate-spin" aria-hidden />
    {texto}
  </div>
);

/** Par rótulo/valor de leitura (atributo de um registro). Valor vazio vira "—". */
export const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="truncate text-sm text-texto">{children || '—'}</dd>
  </div>
);

/**
 * Indicador (KPI Card): título, número grande, detalhe e variação contra o período anterior.
 * `valor` null = módulo que fornece o dado ainda não existe ("Em breve"; nunca número inventado).
 */
export function CartaoKpi({
  titulo,
  valor,
  detalhe,
  variacao,
  para,
  compacto = false,
}: {
  titulo: string;
  valor: string | null;
  detalhe?: string;
  /** Variação em % (null = sem base de comparação). */
  variacao?: number | null;
  para?: string;
  /** Indicador de apoio: número menor, para não disputar atenção com os principais. */
  compacto?: boolean;
}) {
  const subiu = (variacao ?? 0) >= 0;
  const conteudo = (
    <div
      className={`flex h-full flex-col gap-1 rounded-md border border-borda bg-superficie shadow-sm ${compacto ? 'p-2.5' : 'p-3'} ${
        para ? 'transition hover:border-primaria' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-texto-suave">{titulo}</span>
        {valor === null && <Selo>Em breve</Selo>}
      </div>
      <span
        className={`break-words ${compacto ? 'text-base' : 'text-xl'} font-semibold tabular-nums ${
          valor === null ? 'text-texto-suave' : 'text-texto'
        }`}
      >
        {valor ?? '—'}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-texto-suave">
        {variacao != null && (
          <span className={`inline-flex items-center font-medium ${subiu ? 'text-sucesso' : 'text-perigo'}`}>
            {subiu ? (
              <ArrowUpRight className="size-3.5" aria-hidden />
            ) : (
              <ArrowDownRight className="size-3.5" aria-hidden />
            )}
            {Math.abs(variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          </span>
        )}
        {detalhe}
      </span>
    </div>
  );
  return para ? (
    <Link to={para} className="block focus-visible:outline-2 focus-visible:outline-primaria">
      {conteudo}
    </Link>
  ) : (
    conteudo
  );
}

/**
 * Cabeçalho de registro (ObjectHeader) das páginas de detalhe: ícone/avatar, nome, selos, atributos principais em
 * linha e ações. `children`: avisos curtos logo abaixo (ex.: cadastro incompleto). As abas vêm em seguida.
 */
export function CabecalhoObjeto({
  icone,
  titulo,
  selos,
  atributos,
  acoes,
  children,
}: {
  icone?: ReactNode;
  titulo: ReactNode;
  selos?: ReactNode;
  atributos?: { rotulo: string; valor: ReactNode }[];
  acoes?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-md border border-borda bg-superficie p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        {icone}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-texto">{titulo}</h1>
            {selos}
          </div>
          {atributos && atributos.length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
              {atributos.map((a) => (
                <Dado key={a.rotulo} rotulo={a.rotulo}>
                  {a.valor}
                </Dado>
              ))}
            </dl>
          )}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children && <div className="mt-3 space-y-2">{children}</div>}
    </section>
  );
}

/** Bloco de conteúdo com título (Section): agrupa informações numa página de detalhe ou no Início. */
export const Bloco = ({
  titulo,
  acao,
  children,
  className = '',
}: {
  titulo: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`rounded-md border border-borda bg-superficie shadow-sm ${className}`}>
    <div className="flex items-center justify-between gap-2 border-b border-borda px-4 py-2.5">
      <h2 className="text-sm font-semibold text-texto">{titulo}</h2>
      {acao}
    </div>
    <div className="p-4">{children}</div>
  </section>
);
