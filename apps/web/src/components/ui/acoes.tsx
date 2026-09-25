import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Painel suspenso (menu, "Mais filtros"): abre abaixo do botão e fecha ao clicar fora, com Esc ou ao escolher.
 * `alinhar`: lado do botão em que o painel se apoia.
 */
export function Suspenso({
  gatilho,
  alinhar = 'direita',
  largura = 'w-56',
  children,
}: {
  gatilho: (props: { aberto: boolean; alternar: () => void }) => ReactNode;
  alinhar?: 'direita' | 'esquerda';
  largura?: string;
  children: (fechar: () => void) => ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  return (
    <div ref={caixa} className="relative inline-block">
      {gatilho({ aberto, alternar: () => setAberto((a) => !a) })}
      {aberto && (
        <div
          className={`absolute top-full z-30 mt-1 ${largura} rounded-md border border-borda bg-superficie p-1 shadow-lg ${
            alinhar === 'direita' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setAberto(false))}
        </div>
      )}
    </div>
  );
}

/** Botão só com ícone (IconButton). O rótulo vira dica e nome acessível. */
export const BotaoIcone = ({
  rotulo,
  icone: Icone,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; icone: LucideIcon }) => (
  <button
    type="button"
    title={rotulo}
    aria-label={rotulo}
    className={`inline-flex items-center justify-center rounded-md p-1.5 text-texto-suave hover:bg-superficie-alt hover:text-texto disabled:opacity-40 ${className}`}
    {...props}
  >
    <Icone className="size-4" aria-hidden />
  </button>
);

export type AcaoMenu = {
  rotulo: string;
  icone?: LucideIcon;
  /** Link (navega) ou ação (clique). */
  para?: string;
  aoClicar?: () => void;
  perigo?: boolean;
  /** Link externo (WhatsApp, e-mail): abre em nova aba. */
  externo?: boolean;
};

/** Ações de um registro num menu "⋯" (ActionMenu). Itens `false`/`null` são ignorados (ex.: sem permissão). */
export function MenuAcoes({
  acoes,
  rotulo = 'Mais ações',
}: {
  acoes: (AcaoMenu | false | null | undefined)[];
  rotulo?: string;
}) {
  const visiveis = acoes.filter(Boolean) as AcaoMenu[];
  if (!visiveis.length) return null;
  return (
    <Suspenso
      gatilho={({ aberto, alternar }) => (
        <BotaoIcone rotulo={rotulo} icone={MoreHorizontal} aria-expanded={aberto} onClick={alternar} />
      )}
    >
      {(fechar) => (
        <ul role="menu" className="text-sm">
          {visiveis.map(({ rotulo: r, icone: Icone, para, aoClicar, perigo, externo }) => {
            const classe = `flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-superficie-alt ${
              perigo ? 'text-perigo' : 'text-texto'
            }`;
            const conteudo = (
              <>
                {Icone && <Icone className="size-4 shrink-0 opacity-80" aria-hidden />}
                {r}
              </>
            );
            return (
              <li key={r} role="none">
                {para && externo ? (
                  <a role="menuitem" href={para} target="_blank" rel="noopener noreferrer" className={classe}>
                    {conteudo}
                  </a>
                ) : para ? (
                  <Link role="menuitem" to={para} className={classe} onClick={fechar}>
                    {conteudo}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={classe}
                    onClick={() => {
                      fechar();
                      aoClicar?.();
                    }}
                  >
                    {conteudo}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Suspenso>
  );
}
