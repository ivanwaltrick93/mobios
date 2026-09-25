import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Suspenso } from './acoes';
import { BotaoLink, CampoBusca } from './base';

/**
 * Barra de filtros das listas (FilterBar): busca, filtros principais em linha e o resto em "Mais filtros".
 * `ativosEmMais`: quantos filtros de "Mais filtros" estão diferentes do padrão (aparece no botão).
 * `total`: registros encontrados (fica à direita).
 */
export function BarraFiltros({
  busca,
  children,
  mais,
  ativosEmMais = 0,
  aoLimpar,
  total,
}: {
  busca: { rotulo: string; placeholder: string; valor: string; aoMudar: (valor: string) => void };
  children?: ReactNode;
  mais?: ReactNode;
  ativosEmMais?: number;
  aoLimpar?: () => void;
  total?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-72 lg:w-80">
        <CampoBusca rotulo={busca.rotulo} placeholder={busca.placeholder} valor={busca.valor} aoMudar={busca.aoMudar} />
      </div>
      {children}
      {mais && (
        <Suspenso
          alinhar="esquerda"
          largura="w-[min(36rem,calc(100vw-2rem))]"
          gatilho={({ aberto, alternar }) => (
            <button
              type="button"
              aria-expanded={aberto}
              onClick={alternar}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm ${
                ativosEmMais ? 'border-primaria text-primaria' : 'border-borda-forte text-texto'
              } bg-superficie hover:bg-superficie-alt`}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Mais filtros
              {ativosEmMais > 0 && (
                <span className="rounded-full bg-primaria px-1.5 text-xs text-sobre-primaria">{ativosEmMais}</span>
              )}
              <ChevronDown className={`size-4 transition ${aberto ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          )}
        >
          {() => <div className="grid gap-3 p-3 sm:grid-cols-2">{mais}</div>}
        </Suspenso>
      )}
      {aoLimpar && <BotaoLink onClick={aoLimpar}>Limpar filtros</BotaoLink>}
      {total != null && (
        <span className="ml-auto text-xs text-texto-suave">{total.toLocaleString('pt-BR')} registro(s)</span>
      )}
    </div>
  );
}

/** Filtro compacto em linha (FilterField): rótulo curto ao lado do seletor. */
export const FiltroSelect = ({
  rotulo,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string }) => (
  <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-borda-forte bg-superficie pl-2.5 text-sm focus-within:border-primaria focus-within:ring-1 focus-within:ring-primaria">
    <span className="whitespace-nowrap text-xs text-texto-suave">{rotulo}</span>
    <select
      className={`h-full rounded-md bg-transparent pr-2 pl-1 text-sm text-texto focus:outline-none ${className}`}
      {...props}
    />
  </label>
);

export type Ordem<C extends string> = { campo: C; direcao: 'asc' | 'desc' };

/** Cabeçalho de coluna que ordena a lista ao clicar (alterna crescente/decrescente). */
export function ThOrdenavel<C extends string>({
  campo,
  ordem,
  aoOrdenar,
  children,
  className = '',
}: {
  campo: C;
  ordem: Ordem<C>;
  aoOrdenar: (ordem: Ordem<C>) => void;
  children: ReactNode;
  className?: string;
}) {
  const ativa = ordem.campo === campo;
  const Icone = !ativa ? ArrowUpDown : ordem.direcao === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}
      aria-sort={ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => aoOrdenar({ campo, direcao: ativa && ordem.direcao === 'asc' ? 'desc' : 'asc' })}
        className={`inline-flex items-center gap-1 hover:text-texto ${ativa ? 'text-texto' : ''}`}
      >
        {children}
        <Icone className={`size-3.5 ${ativa ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </th>
  );
}
